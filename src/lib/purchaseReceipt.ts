// src/lib/purchaseReceipt.ts
//
// Cash purchase ("Adagu Nagai") receipt: data type + HTML for print / PDF share.

import type { PurchaseItem } from './api/cashPurchases';
import type { RepairShopInfo } from './repairReceipt';
import { displayNetWeight } from './exchangeGold';

export interface PurchaseReceiptData {
  receiptNo: string;
  dateText: string;
  customerName: string;
  phone: string;
  items: PurchaseItem[];
  total: number;
  paymentLabel: string;
  remarks: string;
}

export const PURCHASE_PAY_MODES = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
];
export const purchaseModeLabel = (id: string | null) =>
  PURCHASE_PAY_MODES.find((m) => m.id === id)?.label ?? id ?? '';

/** CP-YYYYMMDD-HHMMSS (local time) */
export function generatePurchaseReceiptNo(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `CP-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

/** expo-print cannot measure content height, so the PDF needs an estimate. */
export function estimatePurchaseReceiptHeightPt(data: PurchaseReceiptData): number {
  const extra = Math.ceil((data.remarks.length || 0) / 32) * 14;
  return 380 + data.items.length * 200 + extra;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export function buildPurchaseReceiptHtml(data: PurchaseReceiptData, shop: RepairShopInfo): string {
  const row = (label: string, value: string, bold = false) => `
    <tr><td class="k">${label}</td><td class="v${bold ? ' b' : ''}">${value}</td></tr>`;

  const shopLines = [
    shop.address ? `<div class="sub">${escapeHtml(shop.address)}</div>` : '',
    shop.phone ? `<div class="sub">Ph: ${escapeHtml(shop.phone)}</div>` : '',
  ].join('');

  const itemsHtml = data.items
    .map((it, idx) => {
      const stone = Number(it.stone_weight) || 0;
      return `
    <div class="item">ITEM ${idx + 1}: ${escapeHtml(it.name)}</div>
    <table>
      ${row('Metal', escapeHtml(`${it.metal_name} ${it.purity_name}`.trim()))}
      ${row('Weight', `${Number(it.gross_weight).toFixed(3)} gms`)}
      ${stone > 0 ? row('Dust/Stone', stone.toFixed(3)) : ''}
      ${stone > 0 ? row('Net Weight', displayNetWeight(it).toFixed(3)) : ''}
      ${row('Old Percentage', `${Number(it.old_percent).toFixed(2)}%`)}
      ${row('Rate/Gm', money(it.rate_per_gram))}
      ${row('Amount', money(it.amount), true)}
    </table>
    <hr class="rule" />`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; }
  .slip { max-width: 300px; margin: 0 auto; padding: 14px 12px 18px; box-sizing: border-box; }
  .center { text-align: center; }
  .shop { font-size: 17px; font-weight: 800; }
  .sub { font-size: 11px; color: #444; margin-top: 2px; }
  .title { margin: 10px 0 2px; font-size: 13px; font-weight: 700; letter-spacing: .4px; }
  .rule { border: 0; border-top: 1px dashed #777; margin: 10px 0; }
  .item { font-size: 12px; font-weight: 800; margin: 2px 0 4px; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; font-size: 12px; vertical-align: top; }
  td.k { width: 40%; color: #555; }
  td.v { text-align: right; word-break: break-word; }
  td.b { font-weight: 700; }
  .total td { font-size: 14px; font-weight: 800; padding-top: 5px; }
  .remarks { font-size: 12px; margin-top: 2px; word-break: break-word; }
  .label { font-size: 11px; color: #555; }
  .sign { margin-top: 34px; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; color: #444; text-align: center; }
  .foot { font-size: 11px; color: #444; margin-top: 10px; }
</style>
</head>
<body>
  <div class="slip">
    <div class="center">
      <div class="shop">${escapeHtml(shop.name)}</div>
      ${shopLines}
      <div class="title">CASH PURCHASE RECEIPT</div>
    </div>

    <hr class="rule" />

    <table>
      ${row('Receipt No', escapeHtml(data.receiptNo), true)}
      ${row('Date', escapeHtml(data.dateText))}
      ${row('Name', escapeHtml(data.customerName), true)}
      ${data.phone ? row('Phone', escapeHtml(data.phone)) : ''}
    </table>

    <hr class="rule" />

    ${itemsHtml}

    <table>
      <tr class="total"><td class="k" style="color:#111">TOTAL PAID</td><td class="v">${money(data.total)}</td></tr>
      ${row('Paid by', escapeHtml(data.paymentLabel))}
    </table>

    ${
      data.remarks
        ? `<hr class="rule" />
           <div class="label">Remarks</div>
           <div class="remarks">${escapeHtml(data.remarks)}</div>`
        : ''
    }

    <div class="sign">Customer signature</div>
    <div class="center foot">Thank you!</div>
  </div>
</body>
</html>`;
}