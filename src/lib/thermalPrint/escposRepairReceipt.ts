// src/lib/thermalPrint/escposRepairReceipt.ts
//
// Repair / service receipt printed DIRECTLY on the Bluetooth thermal printer.
// Layout, header and footer match escposReceipt.ts (new invoice / estimate).

import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { RepairReceiptData, RepairShopInfo } from '../repairReceipt';

// ===========================================================
// PAPER (same as escposReceipt.ts)  58mm -> 32 | 80mm -> 48
// ===========================================================
const WIDTH = 48;
const LABEL_W = 20;   // was Math.floor(WIDTH * 0.5)
const SMALL_CHARS = Math.floor((WIDTH * 4) / 3);      // Font B chars per line
const PAPER_DOTS = WIDTH <= 32 ? 384 : 576;
const DASH_CHARS = 48;                                // full-width dash line

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
const SIZE_NORMAL = `${GS}!\x00`;
const STRIKE_ON = `${ESC}G\x01`;
const STRIKE_OFF = `${ESC}G\x00`;


// Option A: ESC 7 n1 n2 n3 (heating dots, heating time, interval). Common on 58/80mm printers.
// Higher n2 = darker. Default is usually 80 (0x50); try 120-160.
const DENSITY_DARK = `${ESC}7\x07\x78\x02`;   // dots=7, time=120, interval=2

// Option B: GS ( K  (newer printers, density 0-8, default usually 8 (normal))
const DENSITY_DARK_B = `${GS}(K\x02\x00\x31\x08`;

// ---- HEADER STYLE (identical to invoice) ----
const HEADER_FONT = FONT_A;
const HEADER_SIZE = SIZE_NORMAL;
const HEADER_SPACING = 4;
const SPACING_ON = `${ESC} ${String.fromCharCode(HEADER_SPACING)}`;
const SPACING_OFF = `${ESC} \x00`;
const HEADER_LINE_DOTS = 40;
const LINE_HEADER = `${ESC}3${String.fromCharCode(HEADER_LINE_DOTS)}`;
const LINE_RESET = `${ESC}2`;
const HEADER_CHARS = Math.floor(PAPER_DOTS / (12 + HEADER_SPACING));

// ---- FOOTER STYLE (identical to invoice) ----
const FOOTER_FONT = FONT_A;
const FOOTER_SPACING = 0;
const FOOTER_SPACING_ON = `${ESC} ${String.fromCharCode(FOOTER_SPACING)}`;
const FOOTER_SPACING_OFF = `${ESC} \x00`;
const FOOTER_CHARS = Math.floor(PAPER_DOTS / (12 + FOOTER_SPACING));

// ---- Detail rows are moved 60 dots right (same as invoice item rows) ----
const ITEM_SHIFT_DOTS = 60;
const SHIFT_ITEM = `${ESC}\\${String.fromCharCode(ITEM_SHIFT_DOTS, 0)}`;
const ITEM_VALUE_CHARS = Math.floor((PAPER_DOTS - ITEM_SHIFT_DOTS) / 12) - LABEL_W - 2;
// Total chars available on a shifted line
const ITEM_LINE_CHARS = Math.floor((PAPER_DOTS - ITEM_SHIFT_DOTS) / 12);

// ===========================================================
// Helpers
// ===========================================================
const num = (n: unknown) => Number(n) || 0;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fixed2 = (n: unknown) => num(n).toFixed(2);
const fixed3 = (n: unknown) => num(n).toFixed(3);
// 4 -> "4", 4.5 -> "4.5", 4.125 -> "4.125"
const trimNum = (n: number) => String(round3(n));

function clean(text: unknown): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs')
    .replace(/[×✕]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
}

const dashed = () => '-'.repeat(DASH_CHARS) + LF;
const tightDash = () => dashed();

function wrap(text: string, width = WIDTH): string[] {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > width) {
      if (cur) { lines.push(cur); cur = ''; }
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      continue;
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Header text: centered, bold, spaced, airy (same as invoice)
const centerHead = (text: string) =>
  LINE_HEADER +
  wrap(text, HEADER_CHARS)
    .map(
      (l) =>
        ALIGN_CENTER + BOLD_ON + STRIKE_ON + HEADER_FONT + HEADER_SIZE + SPACING_ON + l + LF +
        SPACING_OFF + SIZE_NORMAL + FONT_A + STRIKE_OFF + BOLD_OFF
    )
    .join('') +
  ALIGN_LEFT +
  LINE_RESET;

// Footer: every note on ONE line, cut if too long (same as invoice)
const footerLine = (text: string) => {
  const t = clean(text).trim();
  if (!t) return LF;
  return (
    BOLD_ON + STRIKE_ON +
    FOOTER_FONT + FOOTER_SPACING_ON + t.slice(0, FOOTER_CHARS) + LF +
    FOOTER_SPACING_OFF + FONT_A +
    STRIKE_OFF + BOLD_OFF
  );
};

// Short timestamp "13-11-26 12:39 PM" (same format as the invoice).
// If the text cannot be parsed as a date, it is printed as it is.
function timeShort(text?: string): string {
  const raw = clean(text ?? '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)} ${p(h12)}:${p(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

// "REPAIR ITEM :                    13-11-26 12:39 PM"
// Title on the left, timestamp at the right end of the SAME line (Font B).
function titleWithRight(title: string, right?: string): string {
  const r = clean(right ?? '').trim();
  if (!r) return FONT_B + title + LF + FONT_A;
  const first = title.padEnd(SMALL_CHARS - r.length, ' ') + r;
  return FONT_B + first + LF + FONT_A;
}

// "Label           : value" shifted right like invoice item rows
function itemRow(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, ITEM_VALUE_CHARS);
  return `${SHIFT_ITEM}${lbl}: ${val}${LF}`;
}
const itemBoldRow = (label: string, value: string) => BOLD_ON + itemRow(label, value) + BOLD_OFF;

// Short value -> aligned row. Long value (receipt no, name) ->
// label on its own line, value wrapped underneath (all shifted), nothing cut.
function itemField(label: string, value: string, bold = false): string {
  const v = clean(value);
  if (v.length <= ITEM_VALUE_CHARS) return bold ? itemBoldRow(label, v) : itemRow(label, v);
  const body =
    `${SHIFT_ITEM}${clean(label)}:${LF}` +
    wrap(v, ITEM_LINE_CHARS).map((l) => `${SHIFT_ITEM}${l}${LF}`).join('');
  return bold ? BOLD_ON + body + BOLD_OFF : body;
}

// A free text line shifted right (wraps if too long)
const itemLine = (text: string) =>
  wrap(text, ITEM_LINE_CHARS).map((l) => `${SHIFT_ITEM}${l}${LF}`).join('');

// "gold ring" -> "Gold Ring"
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// -------------------------------------------------------
// Split "gold ring : 4gm | gold chain : 4gm" into separate items
// -------------------------------------------------------
interface RepairLine {
  text: string;      // printed line, e.g. "Gold Ring : 4gms"
  weight: number;    // 0 when no weight could be read
}

function parseRepairItems(raw: unknown): RepairLine[] {
  return String(raw ?? '')
    .split(/\||\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      // name : 4gm   |   name - 4.5 gms   |   name : 4
      const m = part.match(/^(.*?)\s*[:\-]\s*([\d.]+)\s*(?:gms?|grams?|g)?\s*$/i);
      if (!m) return { text: titleCase(clean(part)), weight: 0 };
      const w = parseFloat(m[2]) || 0;
      const name = titleCase(clean(m[1]).trim() || 'Item');
      return { text: `${name} : ${trimNum(w)}gms`, weight: w };
    });
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

  const repairLines = parseRepairItems(receipt.item);
  const summedWeight = round3(repairLines.reduce((s, l) => s + l.weight, 0));
  const totalWeight = num(receipt.weight) > 0 ? num(receipt.weight) : summedWeight;
  const hasLineWeights = repairLines.some((l) => l.weight > 0);

  let out = INIT + DENSITY_DARK;

  // -------------------------------------------------------
  // Shop header (same as invoice)
  // -------------------------------------------------------
  out += centerHead((shop.name || 'Shop').toUpperCase());
  if (shop.address) out += centerHead(shop.address);
  if (shop.phone) out += centerHead(`Ph: ${shop.phone}`);
  out += centerHead('REPAIR / SERVICE RECEIPT');
  out += dashed();

  // -------------------------------------------------------
  // Receipt / delivered date / customer
  // (normal Date row removed - only the Delivered date is shown)
  // -------------------------------------------------------
  out += itemField('Receipt No', receipt.receiptNo, true);
  if (receipt.deliveredText) {
    out += itemBoldRow('Delivered', timeShort(receipt.deliveredText));
  }
  out += itemField('Name', receipt.customerName, true);
  if (receipt.phone) out += itemField('Phone', receipt.phone);
  out += dashed();

  // -------------------------------------------------------
  // Repair items: title + timestamp on the SAME line, then one item per line
  //
  //   REPAIR ITEM :                  13-11-26 12:39 PM
  //       Gold Ring : 4gms
  //       Gold Chain : 4gms
  //
  //       Weight          : 8 gms
  // -------------------------------------------------------
  out += titleWithRight('REPAIR ITEM :', timeShort(receipt.dateText));
  out += LF;

  if (repairLines.length > 0) {
    for (const l of repairLines) out += itemLine(l.text);
  }

  if (totalWeight > 0 && (repairLines.length > 1 || !hasLineWeights)) {
    out += LF;
    out += itemRow('Weight', `${trimNum(totalWeight)} gms`);
  }
  out += tightDash();

  // -------------------------------------------------------
  // Amounts
  // -------------------------------------------------------
  out += itemRow('Repair Charge', fixed2(receipt.charge));
  out += itemRow('Advance Paid', fixed2(receipt.advance));
  if (finalPaid > 0) out += itemRow('Paid on Delivery', fixed2(finalPaid));
  if (discount > 0) out += itemRow('Discount', `-${fixed2(discount)}`);
  if (balance > 0) {
    out += tightDash();
    out += itemBoldRow('Balance Due', fixed2(balance));
    out += LF;
  }

  // -------------------------------------------------------
  // Remarks
  // -------------------------------------------------------
  if (receipt.remarks?.trim()) {
    out += dashed();
    out += BOLD_ON + 'Remarks:' + BOLD_OFF + LF;
    out += wrap(receipt.remarks).map((l) => l + LF).join('');
  }

  // -------------------------------------------------------
  // Footer (same as invoice: Font A, one line each, no wrapping)
  // -------------------------------------------------------
  out += LF + dashed();

  out += footerLine(shop.phone ? `CONTACT :${shop.phone}` : '');

  if (isDelivered) {
    out += footerLine('Thank you! Visit again');
  } else {
    out += footerLine('Bring this receipt to collect item');
    out += footerLine('Thank you!');
  }
  out += footerLine('Join Our Monthly Savings Scheme !!');

  // Feed paper past the tear bar, then cut
  out += LF + LF + LF + LF;
  out += CUT_PAPER;

  await device.write(out);
}