// src/lib/orderEstimate.ts
//
// Builds a combined BILL for one or more customer jewel orders using the
// SAME logic as the New Invoice screen:
//   - each order becomes an invoice item priced with recalcItem()
//   - totals come from invoiceTotals() (GST, making, value added, discount)
//   - old gold is listed and subtracted ONCE from the bill
//   - the slip lines are the same rows the invoice estimate shares/prints
//
// Nothing here touches invoices. It only builds the bill so the order
// screens can preview, share and print it.

import { listMetals, listPurities, listCategories } from './api/settings';
import { getCurrentRate, getMakingChargeRule, getDefaultTaxSetting } from './api/invoices';
import { invoiceTotals, recalcItem, withoutGst } from './invoiceCalc';
import { displayNetWeight, sumExchangeTotal } from './exchangeGold';
import type { SlipLine } from './estimateSlip';
import type { CustomerOrder } from './api/customerOrders';
import type { InvoiceItem, ExchangeItem } from '../types/invoices';

// ---------------------------------------------------------
// Same constants / helpers as app/(tabs)/invoices/new.tsx
// ---------------------------------------------------------

export const VA_CHARGE = 'Value Added Charge';
export const STONE_CHARGE = 'Stone Charge';
const DIAMOND_CHARGE_PREFIX = 'Diamond';
const isDiamondCharge = (name: unknown) => String(name ?? '').startsWith(DIAMOND_CHARGE_PREFIX);
const diamondWeightText = (name: unknown) => String(name ?? '').replace(/^Diamond\s*/i, '').trim();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => n.toFixed(2);
const plain = (n: number) => String(Number(n.toFixed(2)));
const withRate = (label: string, rate?: number | null) =>
  rate != null && rate > 0 ? `${label} @ ${Number(rate.toFixed(2))}%` : label;

const genId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------

/** Everything that does NOT change when GST / discount are toggled. */
export interface OrderBill {
  orders: CustomerOrder[]; // oldest first
  items: InvoiceItem[]; // one per order, same order as `orders`
  exchangeItems: ExchangeItem[];
  exchangeTotal: number;
  advanceTotal: number;
  paymentModes: string[];
}

export interface BillOptions {
  gst: boolean; // the "Apply GST" switch of the invoice screen
  discount: number;
}

export interface ComputedBill {
  billItems: InvoiceItem[];
  totals: ReturnType<typeof invoiceTotals>;
  netFinalAmount: number; // after old gold
  balance: number; // after advance
}

export interface OrderEstimate {
  lines: SlipLine[];
  netAmount: number;
}

// ---------------------------------------------------------
// 1) Order -> priced invoice item
// ---------------------------------------------------------

type MakingRule = Awaited<ReturnType<typeof getMakingChargeRule>>;
type TaxSetting = Awaited<ReturnType<typeof getDefaultTaxSetting>>;

// Names the "fixed amount" making-charge type could have in recalcItem.
// The first one that reproduces the saved amount is used.
const FIXED_MAKING_TYPES = ['fixed', 'flat', 'fixed_amount', 'amount'];

async function buildItemFromOrder(
  order: CustomerOrder,
  ctx: {
    metals: Awaited<ReturnType<typeof listMetals>>;
    purities: Awaited<ReturnType<typeof listPurities>>;
    categories: Awaited<ReturnType<typeof listCategories>>;
    cache: Map<string, { rate: number; makingRule: MakingRule; taxSetting: TaxSetting }>;
  }
): Promise<InvoiceItem> {
  const metal = ctx.metals.find((m) => m.name.toLowerCase() === order.metal.toLowerCase());
  const purity = ctx.purities.find((p) => p.name.toLowerCase() === order.purity.toLowerCase());
  const category = ctx.categories.find((c) => c.name.toLowerCase() === order.category.toLowerCase());

  if (!metal || !purity) {
    throw new Error(`Could not find rate for ${order.metal} (${order.purity}).`);
  }

  const key = `${metal.id}:${purity.id}:${category?.id ?? ''}`;
  if (!ctx.cache.has(key)) {
    const [rate, makingRule, taxSetting] = await Promise.all([
      getCurrentRate(metal.id, purity.id),
      getMakingChargeRule(metal.id, purity.id, category?.id ?? null),
      getDefaultTaxSetting(),
    ]);
    ctx.cache.set(key, { rate, makingRule, taxSetting });
  }
  const { rate, makingRule, taxSetting } = ctx.cache.get(key)!;

  if (!rate) {
    throw new Error(`Today's rate is not set for ${order.metal} (${order.purity}).`);
  }

  // Same weight rule as the invoice prefill: max weight when given, else min
  const netWeight = order.weight_max != null && order.weight_max > 0 ? order.weight_max : order.weight_min;
  const stoneWeight = order.stone_weight ?? 0;

  // Value added % and stone charge saved on the order
  const metalValue = round2(netWeight * rate);
  const vaCharges: any[] = [];
  if (order.vac_percent) {
    vaCharges.push({
      id: genId(),
      name: VA_CHARGE,
      calculation_type: 'percentage',
      value: order.vac_percent,
      amount: round2((metalValue * order.vac_percent) / 100),
    });
  }
  if (order.stone_charge) {
    vaCharges.push({
      id: genId(),
      name: STONE_CHARGE,
      calculation_type: 'fixed',
      value: order.stone_charge,
      amount: order.stone_charge,
    });
  }

  const baseInput = {
    netWeight,
    rate,
    quantity: 1,
    vaCharges,
    itemDiscount: 0,
    taxSetting,
  };

  // Making charge: the fixed amount saved on the order wins; otherwise the
  // master making-charge rule (exactly what the invoice screen uses).
  const savedMaking = order.making_charge ?? 0;
  let makingType: any = makingRule?.calculation_type ?? 'per_gram';
  let makingValue: number = makingRule?.value ?? 0;
  let calc = recalcItem({ ...baseInput, makingType, makingValue } as any);

  if (savedMaking > 0) {
    let applied = false;
    for (const t of FIXED_MAKING_TYPES) {
      const attempt = recalcItem({ ...baseInput, makingType: t, makingValue: savedMaking } as any);
      if (Math.abs(attempt.making_charge_amount - savedMaking) < 0.01) {
        makingType = t;
        makingValue = savedMaking;
        calc = attempt;
        applied = true;
        break;
      }
    }
    if (!applied) {
      console.warn('Order making charge could not be applied as a fixed amount; using the master rule.');
    }
  }

  return {
    id: `order-${order.id}`,
    product_id: null,
    product_code: null,
    name: `${order.category} (${order.order_number})`,
    metal_id: metal.id,
    purity_id: purity.id,
    category_id: category?.id ?? null,
    quantity: 1,
    gross_weight: netWeight + stoneWeight,
    stone_weight: stoneWeight,
    other_weight: 0,
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
    huid: null,
  } as InvoiceItem;
}

// ---------------------------------------------------------
// 2) Orders -> bill (items + old gold + advance)
// ---------------------------------------------------------

export async function buildOrderBill(orders: CustomerOrder[]): Promise<OrderBill> {
  if (orders.length === 0) throw new Error('No orders selected.');

  // Oldest first, so ORD-001 is ITEM 1
  const sorted = [...orders].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const [metals, purities, categories] = await Promise.all([
    listMetals(),
    listPurities(),
    listCategories(),
  ]);
  const cache = new Map<string, { rate: number; makingRule: MakingRule; taxSetting: TaxSetting }>();

  const items: InvoiceItem[] = [];
  for (const o of sorted) {
    items.push(await buildItemFromOrder(o, { metals, purities, categories, cache }));
  }

  // Old gold of every order is combined and subtracted once
  const exchangeItems = sorted.flatMap((o) => o.exchange_items ?? []);
  const exchangeTotal = exchangeItems.length > 0 ? sumExchangeTotal(exchangeItems) : 0;

  // Advances of every order are added up
  let advanceTotal = 0;
  const modes = new Set<string>();
  for (const o of sorted) {
    if (o.advance_amount && o.advance_amount > 0) {
      advanceTotal = round2(advanceTotal + o.advance_amount);
      if (o.payment_mode) modes.add(o.payment_mode);
    }
  }

  return {
    orders: sorted,
    items,
    exchangeItems,
    exchangeTotal,
    advanceTotal,
    paymentModes: Array.from(modes),
  };
}

// ---------------------------------------------------------
// 3) Totals — identical to the invoice screen
// ---------------------------------------------------------

export function computeBill(bill: OrderBill, opts: BillOptions): ComputedBill {
  // "Apply GST" unticked -> every item is stripped of tax
  const billItems = opts.gst ? bill.items : bill.items.map(withoutGst);
  const totals = invoiceTotals(billItems, opts.discount || 0, 0);
  const netFinalAmount = round2(Math.max(0, totals.grandTotal - bill.exchangeTotal));
  const balance = round2(Math.max(0, netFinalAmount - bill.advanceTotal));
  return { billItems, totals, netFinalAmount, balance };
}

// ---------------------------------------------------------
// 4) Slip lines — same rows as the invoice estimate slip
// ---------------------------------------------------------

export function buildBillSlipLines(bill: OrderBill, computed: ComputedBill): SlipLine[] {
  const { billItems, totals, netFinalAmount, balance } = computed;
  const { exchangeItems, exchangeTotal, advanceTotal, paymentModes } = bill;

  const L: SlipLine[] = [];
  const row = (label: string, value: string, bold = false) =>
    L.push({ type: 'row', label, value, bold });
  const full = () => L.push({ type: 'divider' });
  const thin = () => L.push({ type: 'divider', thin: true });

  billItems.forEach((item, idx) => {
    const gross = item.gross_weight * item.quantity;
    const less = (item.stone_weight + item.other_weight) * item.quantity;
    const net = item.net_weight * item.quantity;

    const vaLine = item.value_added_charges.find((c) => c.name === VA_CHARGE);
    const stoneLine = item.value_added_charges.find((c) => c.name === STONE_CHARGE);
    const diamondLines = item.value_added_charges.filter((c) => isDiamondCharge(c.name) && c.amount > 0);
    const otherLines = item.value_added_charges.filter(
      (c) => c.name !== VA_CHARGE && c.name !== STONE_CHARGE && !isDiamondCharge(c.name)
    );

    const cgst = item.cgst_percentage > 0 ? round2((item.taxable_amount * item.cgst_percentage) / 100) : 0;
    const sgst = item.sgst_percentage > 0 ? round2((item.taxable_amount * item.sgst_percentage) / 100) : 0;
    const igst =
      item.cgst_percentage === 0 && item.sgst_percentage === 0 && item.igst_percentage > 0
        ? round2((item.taxable_amount * item.igst_percentage) / 100)
        : 0;
    const hasTax = cgst > 0 || sgst > 0 || igst > 0 || item.tax_amount > 0;

    if (idx > 0) full();
    L.push({
      type: 'heading',
      text: `ITEM ${idx + 1}: ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`,
    });
    thin();

    row('Weight', `${gross.toFixed(3)} gms`);
    row('Stone/Less(wt)', less.toFixed(3));
    row('Nett Weight', net.toFixed(3));
    row('Rate/gm', plain(item.metal_rate));
    if (vaLine) {
      row(
        'V.ADNV',
        vaLine.calculation_type === 'percentage'
          ? `${vaLine.value.toFixed(1)} %`
          : plain(vaLine.amount * item.quantity)
      );
    }
    thin();

    if (item.making_charge_amount > 0) row('MC', plain(item.making_charge_amount));
    if ((item as any).stone_name) row('Stone Name', String((item as any).stone_name));
    if (stoneLine) row('Stone Charges', plain(stoneLine.amount * item.quantity));
    diamondLines.forEach((c) => {
      row('Diamond Wt', `${diamondWeightText(c.name)} ct`);
      row('Diamond Amt', plain(c.amount * item.quantity));
    });
    otherLines.forEach((c) => row(c.name, plain(c.amount * item.quantity)));
    thin();

    if (hasTax) {
      row('Total', money(item.taxable_amount), true);
      thin();
    }
    if (cgst > 0) row(withRate('CGST', item.cgst_percentage), money(cgst));
    if (sgst > 0) row(withRate('SGST', item.sgst_percentage), money(sgst));
    if (igst > 0) row(withRate('GST', item.igst_percentage), money(igst));
    if (cgst === 0 && sgst === 0 && igst === 0 && item.tax_amount > 0) {
      row('Tax', money(item.tax_amount));
    }
    row('Gross', money(item.total_amount), true);
  });

  if (exchangeItems.length > 0) {
    full();
    exchangeItems.forEach((e, idx) => {
      L.push({ type: 'heading', text: `OLD ITEM ${idx + 1}: ${e.description}` });
      thin();
      row('Weight', e.gross_weight.toFixed(3));
      if (e.stone_weight > 0) {
        row('Dust/Stone', e.stone_weight.toFixed(3));
        row('Gross Weight', displayNetWeight(e).toFixed(3));
      }
      row('Old Percentage', `* ${e.old_percent.toFixed(2)}%`);
      row('Old Rate/Gm', `* ${plain(e.rate_per_gram)}`);
      thin();
      row('Gross', money(e.amount), true);
      if (idx < exchangeItems.length - 1) thin();
    });
    thin();
    row('OLD TOTAL', money(exchangeTotal), true);
  }

  full();
  if (totals.discount > 0) {
    row('Discount', `-${money(totals.discount)}`, true);
    full();
  }
  row('Nett RS', money(netFinalAmount), true);

  // Advance already paid on the orders
  if (advanceTotal > 0) {
    full();
    row('Advance', `-${money(advanceTotal)}`);
    if (paymentModes.length > 0) row('Paid By', paymentModes.join(', '));
    row('BALANCE', money(balance), true);
  }

  return L;
}

// ---------------------------------------------------------
// 5) Convenience wrappers used by the share buttons
// ---------------------------------------------------------

/** Bill + slip lines for one or more orders (GST on by default, like the invoice screen). */
export async function buildCombinedOrderEstimate(
  orders: CustomerOrder[],
  opts: Partial<BillOptions> = {}
): Promise<OrderEstimate> {
  const bill = await buildOrderBill(orders);
  const computed = computeBill(bill, { gst: opts.gst ?? true, discount: opts.discount ?? 0 });
  return { lines: buildBillSlipLines(bill, computed), netAmount: computed.netFinalAmount };
}

/** Single-order estimate (same slip, one item). */
export async function buildOrderEstimate(
  order: CustomerOrder,
  opts: Partial<BillOptions> = {}
): Promise<OrderEstimate> {
  return buildCombinedOrderEstimate([order], opts);
}