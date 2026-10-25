// src/lib/thermalPrint/escposRepairReceipt.ts
//
// Repair / service receipt printed DIRECTLY on the Bluetooth thermal printer
// (same ESC/POS approach as escposReceipt.ts used for estimates / invoices).
//
// Self-contained on purpose: escposReceipt.ts does not export its helpers,
// so the few small ones needed here are repeated. Keep WIDTH in sync with
// escposReceipt.ts (58mm -> 32, 80mm -> 48).

import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { RepairReceiptData, RepairShopInfo } from '../repairReceipt';

const WIDTH = 32;
const LABEL_W = Math.floor(WIDTH * 0.5);
const VALUE_W = WIDTH - LABEL_W - 2;

// ---- ESC/POS commands ----
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

// ---- helpers ----
const num = (n: unknown) => Number(n) || 0;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fixed2 = (n: unknown) => num(n).toFixed(2);
const fixed3 = (n: unknown) => num(n).toFixed(3);

// Thermal printers only reliably print plain ASCII
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

// "Label           : value" (value must fit the value column)
function row(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, VALUE_W);
  return `${lbl}: ${val}${LF}`;
}

const boldRow = (label: string, value: string) => BOLD_ON + row(label, value) + BOLD_OFF;

// Short values -> aligned row. Long values (receipt no, date, name, item text)
// -> label on its own line, value wrapped underneath, so nothing is cut off.
function field(label: string, value: string, bold = false): string {
  const v = clean(value);
  if (v.length <= VALUE_W) return bold ? boldRow(label, v) : row(label, v);
  const body = clean(label) + ':' + LF + left(v);
  return bold ? BOLD_ON + body + BOLD_OFF : body;
}

// ===========================================================
// Main
// ===========================================================

export async function printRepairReceiptDirect(
  device: BluetoothDevice,
  receipt: RepairReceiptData,
  shop: RepairShopInfo
) {
  const finalPaid = num(receipt.finalPaid);
  const outstanding = round2(Math.max(0, num(receipt.charge) - num(receipt.advance) - finalPaid));
  const isDelivered = !!receipt.deliveredText;
  const discount = isDelivered ? outstanding : 0;
  const balance = isDelivered ? 0 : outstanding;

  let out = INIT;

  // ---- Shop header ----
  out += ALIGN_CENTER + BOLD_ON;
  out += wrap((shop.name || 'Shop').toUpperCase()).map((l) => l + LF).join('');
  out += BOLD_OFF + ALIGN_LEFT;
  if (shop.address) out += center(shop.address);

  out += ALIGN_CENTER + BOLD_ON + 'REPAIR / SERVICE RECEIPT' + LF + BOLD_OFF + ALIGN_LEFT;
  out += dashed();

  // ---- Receipt / customer ----
  out += field('Receipt No', receipt.receiptNo, true);
  out += field('Date', receipt.dateText);
  if (receipt.deliveredText) out += field('Delivered', receipt.deliveredText, true);
  out += field('Name', receipt.customerName, true);
  if (receipt.phone) out += field('Phone', receipt.phone);
  out += dashed();

  // ---- Item ----
  out += field('For Repair', receipt.item, true);
  if (receipt.weight != null && receipt.weight > 0) {
    out += row('Weight', `${fixed3(receipt.weight)} gms`);
  }
  out += dashed();

  // ---- Amounts ----
  out += row('Repair Charge', fixed2(receipt.charge));
  out += row('Advance Paid', fixed2(receipt.advance));
  if (finalPaid > 0) out += row('Paid on Delivery', fixed2(finalPaid));
  if (discount > 0) out += row('Discount', fixed2(discount));
  out += tightDash();
  out += boldRow('Balance Due', fixed2(balance));

  // ---- Remarks ----
  if (receipt.remarks?.trim()) {
    out += dashed();
    out += 'Remarks:' + LF + left(receipt.remarks);
  }

  // ---- Footer ----
  out += LF + dashed();
  if (shop.phone) out += footerLine(`CONTACT :${shop.phone}`);
  out += footerLine(receipt.deliveredText ? 'Thank You Visit again!' : 'Bring this receipt to collect item');
  out += footerLine('Thank you!');

  // Feed paper past the tear bar, then cut
  out += LF + LF + LF + LF;
  out += CUT_PAPER;

  await device.write(out);
}