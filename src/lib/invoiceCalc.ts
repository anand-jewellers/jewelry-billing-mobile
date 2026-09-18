// src/lib/invoiceCalc.ts
import type { InvoiceItem, ValueAddedChargeLine, Product } from '../types/invoices';
import type { CalculationType, TaxSetting, MakingChargeRule } from '../types/settings';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
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
// ---------------------------------------------------------
export function buildInvoiceItemFromProduct(
  product: Product,
  rate: number,
  makingRule: MakingChargeRule | null,
  taxSetting: TaxSetting | null
): InvoiceItem {
  const netWeight = round3(product.gross_weight - product.stone_weight - (product.other_weight ?? 0));
  const makingType = makingRule?.calculation_type ?? 'per_gram';
  const makingValue = makingRule?.value ?? 0;

  const calc = recalcItem({
    netWeight,
    rate,
    quantity: 1,
    makingType,
    makingValue,
    vaCharges: [],
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
    value_added_charges: [],
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
  const vaTotal = round2(items.reduce((s, i) => s + i.value_added_charges.reduce((a, c) => a + c.amount, 0), 0));
  const cgstTotal = round2(items.reduce((s, i) => s + (i.taxable_amount * i.cgst_percentage) / 100, 0));
  const sgstTotal = round2(items.reduce((s, i) => s + (i.taxable_amount * i.sgst_percentage) / 100, 0));
  const igstTotal = round2(items.reduce((s, i) => s + (i.taxable_amount * i.igst_percentage) / 100, 0));
  const taxTotal = round2(items.reduce((s, i) => s + i.tax_amount, 0));
  const taxableTotal = round2(items.reduce((s, i) => s + i.taxable_amount, 0));

  const preRoundTotal = round2(taxableTotal + taxTotal - invoiceDiscount);
  const grandTotal = Math.round(preRoundTotal);
  const roundOff = round2(grandTotal - preRoundTotal);

  const paid = round2(paidAmount);
  const balanceDue = round2(Math.max(grandTotal - paid, 0));

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

  return {
    metalTotal, makingTotal, vaTotal, cgstTotal, sgstTotal, igstTotal, taxTotal, taxableTotal,
    cgstRate, sgstRate, igstRate,
    discount: round2(invoiceDiscount), roundOff, grandTotal, paid, balanceDue,
  };
}