// src/lib/orderEstimate.ts
//
// Turns a customer jewel order into SlipLine[] for the shared
// "ROUGH ESTIMATE" slip (see estimateSlip.ts). The PDF layout and the
// WhatsApp sharing are NOT done here: this file only builds the lines.
// The estimate is GST-free.

import { listMetals, listPurities } from './api/settings';
import { getCurrentRate } from './api/invoices';
import type { SlipLine } from './estimateSlip';
import type { CustomerOrder } from './api/customerOrders';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => n.toFixed(2);
const plain = (n: number) => String(Number(n.toFixed(2)));

export interface OrderEstimate {
  lines: SlipLine[];
  netAmount: number; // total estimate (before advance)
}

/**
 * Builds the estimate slip lines for a customer order.
 * - Rate: today's rate for the order's metal + purity.
 * - Weight: if the order has a weight range, the MAX weight is used (worst case).
 * - Value added: vac_percent applied on the metal value.
 * - Making / stone charge: the fixed amounts saved on the order.
 * - No GST.
 * - Advance: shown as a deduction with a BALANCE line when present.
 */
export async function buildOrderEstimate(order: CustomerOrder): Promise<OrderEstimate> {
  const [metals, purities] = await Promise.all([listMetals(), listPurities()]);

  const metal = metals.find((m) => m.name.toLowerCase() === order.metal.toLowerCase());
  const purity = purities.find((p) => p.name.toLowerCase() === order.purity.toLowerCase());
  if (!metal || !purity) {
    throw new Error(`Could not find rate for ${order.metal} (${order.purity}).`);
  }

  const rate = await getCurrentRate(metal.id, purity.id);
  if (!rate) {
    throw new Error(`Today's rate is not set for ${order.metal} (${order.purity}).`);
  }

  const netWeight = order.weight_max ?? order.weight_min;
  const stoneWeight = order.stone_weight ?? 0;
  const grossWeight = netWeight + stoneWeight;

  const metalValue = round2(netWeight * rate);
  const vaAmount = order.vac_percent ? round2((metalValue * order.vac_percent) / 100) : 0;
  const making = order.making_charge ?? 0;
  const stoneCharge = order.stone_charge ?? 0;
  const total = round2(metalValue + vaAmount + making + stoneCharge);

  const advance = order.advance_amount && order.advance_amount > 0 ? order.advance_amount : 0;
  const balance = round2(Math.max(0, total - advance));

  // ---- Slip lines (same style as the invoice-page estimate) ----
  const L: SlipLine[] = [];
  const row = (label: string, value: string, bold = false) =>
    L.push({ type: 'row', label, value, bold });
  const thin = () => L.push({ type: 'divider', thin: true });
  const full = () => L.push({ type: 'divider' });

  L.push({ type: 'heading', text: `ORDER ${order.order_number}: ${order.category}` });
  thin();
  row('Metal', `${order.metal} (${order.purity})`);
  row('Weight', `${grossWeight.toFixed(3)} gms`);
  row('Stone/Less(wt)', stoneWeight.toFixed(3));
  row('Nett Weight', netWeight.toFixed(3));
  row('Rate/gm', plain(rate));
  if (order.vac_percent) row('V.ADNV', `${order.vac_percent.toFixed(1)} %`);
  thin();

  if (making > 0) row('MC', plain(making));
  if (stoneCharge > 0) row('Stone Charges', plain(stoneCharge));
  thin();

  row('Gross', money(total), true);

  full();
  row('Nett RS', money(total), true);

  if (advance > 0) {
    full();
    row('Advance', `-${money(advance)}`);
    if (order.payment_mode) row('Paid By', order.payment_mode);
    row('BALANCE', money(balance), true);
  }

  return { lines: L, netAmount: total };
}