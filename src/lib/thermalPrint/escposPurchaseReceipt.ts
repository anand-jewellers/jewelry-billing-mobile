// src/lib/thermalPrint/escposPurchaseReceipt.ts
//
// Cash purchase ("Adagu Nagai") receipt printed DIRECTLY on the Bluetooth
// thermal printer (same ESC/POS approach as escposReceipt.ts).
// Keep WIDTH in sync with escposReceipt.ts (58mm -> 32, 80mm -> 48).

import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { PurchaseReceiptData } from '../purchaseReceipt';
import type { RepairShopInfo } from '../repairReceipt';
import { displayNetWeight } from '../exchangeGold';

const WIDTH = 32;
const LABEL_W = Math.floor(WIDTH * 0.5);
const VALUE_W = WIDTH - LABEL_W - 2;

const ESC = '\x1B';
const GS = '\x1D';
const INIT = `${ESC}@`;
const BOLD_ON = `${ESC}E\x01`;
const BOLD_OFF = `${ESC}E\x00`;
const ALIGN_CENTER = `${ESC}a\x01`;
const ALIGN_LEFT = `${ESC}a\x00`;
const FONT_A = `${ESC}M\x00`;
const FONT_B = `${ESC}M\x01`;
const CUT_PAPER = `${GS}V\x00`;
const LF = '\n';

const num = (n: unknown) => Number(n) || 0;
const fixed2 = (n: unknown) => num(n).toFixed(2);
const fixed3 = (n: unknown) => num(n).toFixed(3);
const plain = (n: unknown) => String(Number(num(n).toFixed(2)));

function clean(text: unknown): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs')
    .replace(/[×✕]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
}

const dashed = () => '-'.repeat(WIDTH) + LF;
const tightDash = () => ' '.repeat(LABEL_W + 2) + '-'.repeat(WIDTH - LABEL_W - 2) + LF;

function wrap(text: string, width = WIDTH): string[] {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > width) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      continue;
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const center = (text: string) => wrap(text).map((l) => ALIGN_CENTER + l + LF).join('') + ALIGN_LEFT;
const left = (text: string) => wrap(text).map((l) => l + LF).join('');
const footerLine = (text: string) => FONT_B + clean(text) + LF + FONT_A;

function row(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, VALUE_W);
  return `${lbl}: ${val}${LF}`;
}
const boldRow = (label: string, value: string) => BOLD_ON + row(label, value) + BOLD_OFF;

// long values -> label on its own line, value wrapped underneath
function field(label: string, value: string, bold = false): string {
  const v = clean(value);
  if (v.length <= VALUE_W) return bold ? boldRow(label, v) : row(label, v);
  const body = clean(label) + ':' + LF + left(v);
  return bold ? BOLD_ON + body + BOLD_OFF : body;
}

export async function printPurchaseReceiptDirect(
  device: BluetoothDevice,
  data: PurchaseReceiptData,
  shop: RepairShopInfo
) {
  let out = INIT;

  // ---- Shop header ----
  out += ALIGN_CENTER + BOLD_ON;
  out += wrap((shop.name || 'Shop').toUpperCase()).map((l) => l + LF).join('');
  out += BOLD_OFF + ALIGN_LEFT;
  if (shop.address) out += center(shop.address);
  out += ALIGN_CENTER + BOLD_ON + 'CASH PURCHASE RECEIPT' + LF + BOLD_OFF + ALIGN_LEFT;
  out += dashed();

  // ---- Receipt / customer ----
  out += field('Receipt No', data.receiptNo, true);
  out += field('Date', data.dateText);
  out += field('Name', data.customerName, true);
  if (data.phone) out += field('Phone', data.phone);
  out += dashed();

  // ---- Items (same layout as the OLD ITEM block on the invoice slip) ----
  data.items.forEach((it, idx) => {
    const stone = num(it.stone_weight);

    out += BOLD_ON;
    out += wrap(`ITEM ${idx + 1}: ${String(it.name).toUpperCase()}`).map((l) => l + LF).join('');
    out += BOLD_OFF;
    out += '-'.repeat(6) + LF;

    out += field('Metal', `${it.metal_name} ${it.purity_name}`.trim());
    out += row('Weight', `${fixed3(it.gross_weight)} gms`);
    if (stone > 0) {
      out += row('Dust/Stone', fixed3(stone));
      out += row('Net Weight', fixed3(displayNetWeight(it)));
    }
    out += row('Old Percentage', `${fixed2(it.old_percent)}%`);
    out += row('Rate/Gm', plain(it.rate_per_gram));
    out += tightDash();
    out += boldRow('Amount', fixed2(it.amount));
    out += LF;
  });

  // ---- Totals ----
  out += dashed();
  out += row('Net Amount', fixed2(data.netAmount));
  out += boldRow('AMOUNT PAID', fixed2(data.paidAmount));
  out += row('Paid by', data.paymentLabel);

  if (data.remarks?.trim()) {
    out += dashed();
    out += 'Remarks:' + LF + left(data.remarks);
  }

  // ---- Signature + footer ----
  out += LF + LF + LF;
  out += '_'.repeat(WIDTH) + LF;
  // out += center('Customer signature');
  out += LF;
  out += footerLine('Thank you!');

  out += LF + LF + LF + LF;
  out += CUT_PAPER;

  await device.write(out);
}