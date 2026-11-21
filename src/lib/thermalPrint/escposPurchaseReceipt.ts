// src/lib/thermalPrint/escposPurchaseReceipt.ts
//
// Cash purchase ("Adagu Nagai") receipt printed DIRECTLY on the Bluetooth
// thermal printer. Layout, header and footer match escposRepairReceipt.ts.

import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { PurchaseReceiptData } from '../purchaseReceipt';
import type { RepairShopInfo } from '../repairReceipt';
import { displayNetWeight } from '../exchangeGold';

// ===========================================================
// PAPER (same as escposRepairReceipt.ts)  58mm -> 32 | 80mm -> 48
// ===========================================================
const WIDTH = 48;
const LABEL_W = 20;
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

// Print density (same as repair receipt)
const DENSITY_DARK = `${ESC}7\x07\x78\x02`;

// ---- HEADER STYLE (identical to repair receipt) ----
const HEADER_FONT = FONT_A;
const HEADER_SIZE = SIZE_NORMAL;
const HEADER_SPACING = 4;
const SPACING_ON = `${ESC} ${String.fromCharCode(HEADER_SPACING)}`;
const SPACING_OFF = `${ESC} \x00`;
const HEADER_LINE_DOTS = 40;
const LINE_HEADER = `${ESC}3${String.fromCharCode(HEADER_LINE_DOTS)}`;
const LINE_RESET = `${ESC}2`;
const HEADER_CHARS = Math.floor(PAPER_DOTS / (12 + HEADER_SPACING));

// ---- FOOTER STYLE (identical to repair receipt) ----
const FOOTER_FONT = FONT_A;
const FOOTER_SPACING = 0;
const FOOTER_SPACING_ON = `${ESC} ${String.fromCharCode(FOOTER_SPACING)}`;
const FOOTER_SPACING_OFF = `${ESC} \x00`;
const FOOTER_CHARS = Math.floor(PAPER_DOTS / (12 + FOOTER_SPACING));

// ---- Detail rows are moved 60 dots right ----
const ITEM_SHIFT_DOTS = 60;
const SHIFT_ITEM = `${ESC}\\${String.fromCharCode(ITEM_SHIFT_DOTS, 0)}`;
const ITEM_VALUE_CHARS = Math.floor((PAPER_DOTS - ITEM_SHIFT_DOTS) / 12) - LABEL_W - 2;
const ITEM_LINE_CHARS = Math.floor((PAPER_DOTS - ITEM_SHIFT_DOTS) / 12);

// ===========================================================
// Helpers
// ===========================================================
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

// Header text: centered, bold, spaced, airy (same as repair receipt)
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

// Footer: bold + double-strike, one line each (same as repair receipt)
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

// Short timestamp "13-11-26 12:39 PM". Unparseable text is printed as it is.
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

// Title on the left, timestamp at the right end of the SAME line (Font B).
function titleWithRight(title: string, right?: string): string {
  const r = clean(right ?? '').trim();
  if (!r) return FONT_B + title + LF + FONT_A;
  const first = title.padEnd(SMALL_CHARS - r.length, ' ') + r;
  return FONT_B + first + LF + FONT_A;
}

// "Label           : value" shifted right
function itemRow(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, ITEM_VALUE_CHARS);
  return `${SHIFT_ITEM}${lbl}: ${val}${LF}`;
}
const itemBoldRow = (label: string, value: string) => BOLD_ON + itemRow(label, value) + BOLD_OFF;

// Short value -> aligned row. Long value -> label on its own line, value wrapped below.
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

// ===========================================================
// Main
// ===========================================================
export async function printPurchaseReceiptDirect(
  device: BluetoothDevice,
  data: PurchaseReceiptData,
  shop: RepairShopInfo
) {
  let out = INIT + DENSITY_DARK;

  // -------------------------------------------------------
  // Shop header (same as repair receipt)
  // -------------------------------------------------------
  out += centerHead((shop.name || 'Shop').toUpperCase());
  if (shop.address) out += centerHead(shop.address);
  if (shop.phone) out += centerHead(`Ph: ${shop.phone}`);
  out += centerHead('CASH PURCHASE RECEIPT');
  out += dashed();

  // -------------------------------------------------------
  // Receipt / customer
  // -------------------------------------------------------
  out += itemField('Receipt No', data.receiptNo, true);
  out += itemField('Name', data.customerName, true);
  if (data.phone) out += itemField('Phone', data.phone);
  out += dashed();

  // -------------------------------------------------------
  // Items: title + timestamp on the SAME line, then each item
  // -------------------------------------------------------
  out += titleWithRight('PURCHASE ITEM :', timeShort(data.dateText));

  data.items.forEach((it, idx) => {
    const stone = num(it.stone_weight);

    out += LF;
    out += BOLD_ON + itemLine(`${idx + 1}. ${String(it.name).toUpperCase()}`) + BOLD_OFF;
    out += itemField('Metal', `${it.metal_name} ${it.purity_name}`.trim());
    out += itemRow('Weight', `${fixed3(it.gross_weight)} gms`);
    if (stone > 0) {
      out += itemRow('Dust/Stone', fixed3(stone));
      out += itemRow('Net Weight', fixed3(displayNetWeight(it)));
    }
    out += itemRow('Old Percentage', `${fixed2(it.old_percent)}%`);
    out += itemRow('Rate/Gm', plain(it.rate_per_gram));
    out += tightDash();
    out += itemBoldRow('Amount', fixed2(it.amount));
  });
  out += dashed();

  // -------------------------------------------------------
  // Totals
  // -------------------------------------------------------
  out += itemRow('Net Amount', fixed2(data.netAmount));
  out += itemBoldRow('AMOUNT PAID', fixed2(data.paidAmount));
  out += itemRow('Paid by', data.paymentLabel);

  // -------------------------------------------------------
  // Remarks
  // -------------------------------------------------------
  if (data.remarks?.trim()) {
    out += dashed();
    out += BOLD_ON + 'Remarks:' + BOLD_OFF + LF;
    out += wrap(data.remarks).map((l) => l + LF).join('');
  }

  // -------------------------------------------------------
  // Footer (same as repair receipt)
  // -------------------------------------------------------
  out += LF + dashed();

  out += footerLine(shop.phone ? `CONTACT :${shop.phone}` : '');
  out += footerLine('Thank you!');
  out += footerLine('Join Our Monthly Savings Scheme !!');

  // Feed paper past the tear bar, then cut
  out += LF + LF + LF + LF;
  out += CUT_PAPER;

  await device.write(out);
}