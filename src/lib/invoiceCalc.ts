// src/lib/invoiceCalc.ts
import type { InvoiceItem, ValueAddedChargeLine } from '../types/invoices';
import type { CalculationType, TaxSetting, MakingChargeRule } from '../types/settings';
import type { ProductWithCharges } from './api/invoices';

// Diamond rows from a product are added to the invoice item as fixed-amount
// charge lines named "Diamond <size>" (e.g. "Diamond 0.136"). Because they
// are ordinary value_added_charges lines, they are included in the taxable
// amount, saved with the invoice, and shown wherever charges are listed.
export const DIAMOND_CHARGE_PREFIX = 'Diamond';

// true  -> product_diamonds.amount is the RATE per carat;
//          diamond charge = carat weight (product_diamonds.size) × rate
// false -> product_diamonds.amount is the flat diamond charge (old behaviour)
export const DIAMOND_AMOUNT_IS_RATE_PER_CARAT = true;

export function isDiamondCharge(name: string): boolean {
  return name.startsWith(DIAMOND_CHARGE_PREFIX);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

// "0.136" / "0.136 ct" / "0.25ct" -> 0.136 / 0.136 / 0.25 ; anything unreadable -> 0
export function parseCarat(size: string | number | null | undefined): number {
  const n = parseFloat(String(size ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Diamond charge for one product_diamonds row.
// If the carat weight can't be read from `size`, falls back to the flat amount
// so a diamond is never silently billed at ₹0.
export function diamondChargeAmount(size: string | number | null | undefined, amountOrRate: number): number {
  const value = Number(amountOrRate) || 0;
  if (!DIAMOND_AMOUNT_IS_RATE_PER_CARAT) return round2(value);
  const carat = parseCarat(size);
  return carat > 0 ? round2(carat * value) : round2(value);
}

// ---------------------------------------------------------
// Value-added charge line amount
// ---------------------------------------------------------
export function recalcVaLineAmount(
  calcType: CalculationType,
  value: number,
  netWeight: number,
  metalValue: number
): number {
  switch (calcType) {
    case 'per_gram':
      return round2(value * netWeight);
    case 'percentage':
      return round2((value / 100) * metalValue);
    case 'fixed':
    default:
      return round2(value);
  }
}

// ---------------------------------------------------------
// Core per-item calculation — this is where weight × metal
// rate (fetched for that metal+purity pair) becomes an amount
// ---------------------------------------------------------
interface RecalcItemInput {
  netWeight: number;
  rate: number;            // ₹/gram — from getCurrentRate(metalId, purityId), fetched fresh
  quantity: number;
  makingType: CalculationType;
  makingValue: number;
  vaCharges: ValueAddedChargeLine[]; // already has .amount computed per line
  itemDiscount: number;
  taxSetting: TaxSetting | null;
}

export function recalcItem(input: RecalcItemInput) {
  const { netWeight, rate, quantity, makingType, makingValue, vaCharges, itemDiscount, taxSetting } = input;

  // Metal value = weight × today's rate for this metal+purity × quantity
  const metal_value = round2(netWeight * rate * quantity);

  let making_charge_amount = 0;
  if (makingType === 'per_gram') {
    making_charge_amount = round2(makingValue * netWeight * quantity);
  } else if (makingType === 'percentage') {
    making_charge_amount = round2((makingValue / 100) * metal_value);
  } else {
    making_charge_amount = round2(makingValue * quantity); // fixed, per piece
  }

  const va_total = round2(vaCharges.reduce((s, c) => s + c.amount, 0) * quantity);

  const taxable_amount = round2(metal_value + making_charge_amount + va_total - itemDiscount);

  const tax_percentage = taxSetting?.tax_percentage ?? 0;
  const cgst_percentage = taxSetting?.cgst ?? 0;
  const sgst_percentage = taxSetting?.sgst ?? 0;
  const igst_percentage = taxSetting?.igst ?? 0;
  const tax_amount = round2((taxable_amount * tax_percentage) / 100);
  const total_amount = round2(taxable_amount + tax_amount);

  return {
    metal_value,
    making_charge_amount,
    taxable_amount,
    tax_percentage,
    cgst_percentage,
    sgst_percentage,
    igst_percentage,
    tax_amount,
    total_amount,
  };
}

// ---------------------------------------------------------
// Build an invoice item straight from a scanned/looked-up product
//
// Priority order:
//   Making Charge  -> product's own saved fixed ₹ value, else makingRuleFallback
//   Stone Charge   -> product's own saved fixed ₹ value, added as its own
//                      value_added_charges line (0 if none saved)
//   Diamonds       -> one line per saved diamond row:
//                      carat weight × rate per carat (see DIAMOND_AMOUNT_IS_RATE_PER_CARAT)
//   Value Added %  -> product's own saved % value, added as its own
//                      value_added_charges line (0 if none saved)
//   GST            -> product's own saved tax_settings row, else taxSettingFallback
// ---------------------------------------------------------
export function buildInvoiceItemFromProduct(
  product: ProductWithCharges,
  rate: number,
  makingRuleFallback: MakingChargeRule | null,
  taxSettingFallback: TaxSetting | null
): InvoiceItem {
  const netWeight = round3(product.gross_weight - product.stone_weight - (product.other_weight ?? 0));

  const savedCharges = product.product_value_added_charges ?? [];
  const makingCharge = savedCharges.find((c) => c.charge_name === 'Making Charge' && c.value > 0);
  const stoneCharge = savedCharges.find((c) => c.charge_name === 'Stone Charge' && c.value > 0);
  const vacCharge = savedCharges.find((c) => c.charge_name === 'Value Added Charge' && c.value > 0);

  const makingType: CalculationType = makingCharge
    ? 'fixed'
    : (makingRuleFallback?.calculation_type ?? 'per_gram');
  const makingValue = makingCharge ? makingCharge.value : (makingRuleFallback?.value ?? 0);

  // metal_value with quantity=1, used only to size the % Value Added Charge
  // line before recalcItem runs (recalcItem recomputes the authoritative
  // metal_value itself — this must match it since quantity is 1 here).
  const metalValueForVac = round2(netWeight * rate);

  const vaCharges: ValueAddedChargeLine[] = [];
  if (stoneCharge) {
    vaCharges.push({
      id: `local-stone-${Date.now()}`,
      charge_type_id: stoneCharge.charge_type_id ?? '',
      name: 'Stone Charge',
      calculation_type: 'fixed',
      value: stoneCharge.value,
      amount: recalcVaLineAmount('fixed', stoneCharge.value, netWeight, metalValueForVac),
    });
  }

  // One line per diamond row, in the order they were entered.
  // charge = carat weight × rate per carat. The line is stored as a 'fixed'
  // charge holding the computed ₹ amount, so editing the item later in the
  // item sheet keeps working exactly like any other fixed charge.
  const diamondRows = [...(product.product_diamonds ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  diamondRows.forEach((d, idx) => {
    const charge = diamondChargeAmount(d.size, d.amount);
    if (charge <= 0) return;
    vaCharges.push({
      id: `local-diamond-${d.id ?? idx}-${Date.now()}`,
      charge_type_id: '',
      name: `${DIAMOND_CHARGE_PREFIX} ${String(d.size).trim()}`,
      calculation_type: 'fixed',
      value: charge,
      amount: recalcVaLineAmount('fixed', charge, netWeight, metalValueForVac),
    });
  });

  if (vacCharge) {
    vaCharges.push({
      id: `local-vac-${Date.now()}`,
      charge_type_id: vacCharge.charge_type_id ?? '',
      name: 'Value Added Charge',
      calculation_type: 'percentage',
      value: vacCharge.value,
      amount: recalcVaLineAmount('percentage', vacCharge.value, netWeight, metalValueForVac),
    });
  }

  const taxSetting: TaxSetting | null = product.tax_settings
    ? {
        id: product.tax_settings.id,
        tax_name: product.tax_settings.tax_name,
        tax_percentage: product.tax_settings.tax_percentage,
        cgst: product.tax_settings.cgst,
        sgst: product.tax_settings.sgst,
        igst: product.tax_settings.igst,
        is_active: true,
      }
    : taxSettingFallback;

  const calc = recalcItem({
    netWeight,
    rate,
    quantity: 1,
    makingType,
    makingValue,
    vaCharges,
    itemDiscount: 0,
    taxSetting,
  });

  return {
    id: `local-${Date.now()}`,
    product_id: product.id,
    product_code: product.product_code,
    name: product.product_name,
    metal_id: product.metal_id,
    purity_id: product.purity_id,
    category_id: product.category_id,
    quantity: 1,
    gross_weight: product.gross_weight,
    stone_weight: product.stone_weight,
    other_weight: product.other_weight ?? 0,
    net_weight: netWeight,
    metal_rate: rate,
    metal_value: calc.metal_value,
    making_charge_type: makingType,
    making_charge_value: makingValue,
    making_charge_amount: calc.making_charge_amount,
    value_added_charges: vaCharges,
    item_discount: 0,
    taxable_amount: calc.taxable_amount,
    tax_setting_id: taxSetting?.id ?? null,
    tax_percentage: calc.tax_percentage,
    cgst_percentage: calc.cgst_percentage,
    sgst_percentage: calc.sgst_percentage,
    igst_percentage: calc.igst_percentage,
    tax_amount: calc.tax_amount,
    total_amount: calc.total_amount,
    huid: product.huid ?? null,
  };
}

// ---------------------------------------------------------
// Invoice-level totals
// ---------------------------------------------------------
export function invoiceTotals(items: InvoiceItem[], invoiceDiscount: number, paidAmount: number) {
  const metalTotal = round2(items.reduce((s, i) => s + i.metal_value, 0));
  const makingTotal = round2(items.reduce((s, i) => s + i.making_charge_amount, 0));
  const vaTotal = round2(
    items.reduce((s, i) => s + i.value_added_charges.reduce((a, c) => a + c.amount, 0) * i.quantity, 0)
  );
  const cgstTotal = round2(items.reduce((s, i) => s + (i.taxable_amount * i.cgst_percentage) / 100, 0));
  const sgstTotal = round2(items.reduce((s, i) => s + (i.taxable_amount * i.sgst_percentage) / 100, 0));
  const igstTotal = round2(
    items.reduce(
      (s, i) => s + (i.cgst_percentage > 0 && i.sgst_percentage > 0 ? 0 : (i.taxable_amount * i.igst_percentage) / 100),
      0
    )
  );
  const taxTotal = round2(items.reduce((s, i) => s + i.tax_amount, 0));
  const taxableTotal = round2(items.reduce((s, i) => s + i.taxable_amount, 0));

  const preRoundTotal = round2(taxableTotal + taxTotal - invoiceDiscount);
  const grandTotal = Math.round(preRoundTotal);
  const roundOff = round2(grandTotal - preRoundTotal);

  const paid = round2(paidAmount);
  const balanceDue = round2(Math.max(grandTotal - paid, 0));

  // Whole-rupee amount incl. GST, before any invoice discount
  // (the slip's "Gross" / "Nett RS" lines).
  const grossTotal = Math.round(taxableTotal + taxTotal);

  // Slip weights: per-unit weight × quantity (same basis as metal_value).
  // "Less" = stone + other weight, so Weight − Less = Nett Weight.
  const grossWeightTotal = round3(items.reduce((s, i) => s + i.gross_weight * i.quantity, 0));
  const lessWeightTotal = round3(items.reduce((s, i) => s + (i.stone_weight + i.other_weight) * i.quantity, 0));
  const netWeightTotal = round3(items.reduce((s, i) => s + i.net_weight * i.quantity, 0));

  // Single Rate/Gm only when every item uses the same rate, otherwise null (row hidden).
  const metalRate =
    items.length > 0 && items.every((i) => i.metal_rate === items[0].metal_rate) ? items[0].metal_rate : null;

  // Uniform tax rate across all items -> show a single "%"; mixed rates -> omit the "%"
  // rather than showing a misleading blended figure.
  const uniformRate = <K extends 'cgst_percentage' | 'sgst_percentage' | 'igst_percentage'>(key: K) => {
    if (items.length === 0) return 0;
    const first = items[0][key];
    return items.every((i) => i[key] === first) ? first : null;
  };

  const cgstRate = uniformRate('cgst_percentage');
  const sgstRate = uniformRate('sgst_percentage');
  const igstRate = uniformRate('igst_percentage');

  // Broken down by charge_name (e.g. "Stone Charge", "Value Added Charge",
  // "Diamond 0.136", plus anything a manually-added item used) so the
  // payment summary can show each kind separately instead of one lumped
  // "Value Added Charges" figure. Making Charge is intentionally NOT part of
  // this — it's already its own top-level total via makingTotal above.
  //
  // vaRates: the % for each charge name when every line of that charge is
  // percentage-based with the same value; null if it's flat/per-gram or the
  // rates differ between items.
  const vaBreakdown: Record<string, number> = {};
  const vaRates: Record<string, number | null> = {};
  for (const item of items) {
    for (const c of item.value_added_charges) {
      vaBreakdown[c.name] = round2((vaBreakdown[c.name] ?? 0) + c.amount * item.quantity);

      const rate = c.calculation_type === 'percentage' ? c.value : null;
      if (!(c.name in vaRates)) {
        vaRates[c.name] = rate;
      } else if (vaRates[c.name] !== rate) {
        vaRates[c.name] = null;
      }
    }
  }

  return {
    metalTotal, makingTotal, vaTotal, vaBreakdown, vaRates, cgstTotal, sgstTotal, igstTotal, taxTotal, taxableTotal,
    cgstRate, sgstRate, igstRate,
    grossTotal, grossWeightTotal, lessWeightTotal, netWeightTotal, metalRate,
    discount: round2(invoiceDiscount), roundOff, grandTotal, paid, balanceDue,
  };
}

// Returns a copy of the item with all GST stripped out.
// Used when GST is switched off for an item.
export function withoutGst(item: InvoiceItem): InvoiceItem {
  return {
    ...item,
    gst_enabled: false,
    tax_percentage: 0,
    cgst_percentage: 0,
    sgst_percentage: 0,
    igst_percentage: 0,
    tax_amount: 0,
    total_amount: item.taxable_amount,
  };
}