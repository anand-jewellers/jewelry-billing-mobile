// src/lib/thermalPrint/escposReceipt.ts

import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { InvoiceDetail, InvoiceItemDetail } from '../../types/invoices';
import { slipFigures, isGstInvoice, type ShopDetails } from '../invoicePdf';
import { displayNetWeight } from '../exchangeGold';

// ===========================================================
// PAPER WIDTH  (80mm paper)
// 58mm printer -> WIDTH 32   (576 dots is for 80mm, 384 for 58mm)
// 80mm printer -> WIDTH 48
// ===========================================================

const WIDTH = 48;
const LABEL_W = Math.floor(WIDTH * 0.5); // label column; value column is the rest

// Characters per line in the smaller Font B (64 on 80mm)
const SMALL_CHARS = Math.floor((WIDTH * 4) / 3);

// Printable dots across the paper (58mm = 384, 80mm = 576)
const PAPER_DOTS = WIDTH <= 32 ? 384 : 576;

// ===========================================================
// DASH LINE (the "strike" line between sections)
// Must cover the paper 100%, left edge to right edge.
//   - If the line stops short of the right edge, increase DASH_CHARS by 1.
//   - If the line wraps onto a second row, decrease DASH_CHARS by 1.
// Normal 80mm printers: 48 (576 dots / 12 dots per char).
// Some 80mm printers only print 512 dots: use 42 for those.
// ===========================================================
const DASH_CHARS = 48;

// ===========================================================
// Raw ESC/POS command bytes
// ===========================================================

const ESC = '\x1B';
const GS = '\x1D';

const INIT = `${ESC}@`;
const BOLD_ON = `${ESC}E\x01`;
const BOLD_OFF = `${ESC}E\x00`;
const ALIGN_CENTER = `${ESC}a\x01`;
const ALIGN_LEFT = `${ESC}a\x00`;
const FONT_A = `${ESC}M\x00`; // normal font  (58mm: 32 chars, 80mm: 48 chars)
const FONT_B = `${ESC}M\x01`; // smaller font (58mm: 42 chars, 80mm: 64 chars)
const CUT_PAPER = `${GS}V\x00`;
const LF = '\n';

// Character size (GS ! n): 0x01 = double height, 0x11 = double width + height
const SIZE_NORMAL = `${GS}!\x00`;
const SIZE_TALL = `${GS}!\x01`; // same chars per line, taller text
const SIZE_DOUBLE = `${GS}!\x11`; // half the chars per line, 2x size

const STRIKE_ON = `${ESC}G\x01`;  // double-strike (heavier print)
const STRIKE_OFF = `${ESC}G\x00`;

// ===========================================================
// HEADER STYLE (shop name, phone, ROUGH ESTIMATE, Gold/Silver rate)
//
// ESC/POS cannot print a size between NORMAL and TALL, so the header
// stays SIZE_NORMAL and gets a little bigger/clearer using:
//   1) HEADER_SPACING   -> extra dots between letters (EDIT THIS NUMBER)
//   2) HEADER_LINE_DOTS -> space between header lines (EDIT THIS NUMBER)
//
// HEADER_SPACING:   0 = normal, 1 = small, 2 = clear, 3 = wider
// HEADER_LINE_DOTS: 30 = printer default, 40 = more airy
// ===========================================================
const HEADER_FONT = FONT_A;
const HEADER_SIZE = SIZE_NORMAL; // keep NORMAL (SIZE_TALL is too big)

const HEADER_SPACING = 4;
const SPACING_ON = `${ESC} ${String.fromCharCode(HEADER_SPACING)}`; // ESC SP n
const SPACING_OFF = `${ESC} \x00`;

const HEADER_LINE_DOTS = 40;
const LINE_HEADER = `${ESC}3${String.fromCharCode(HEADER_LINE_DOTS)}`; // ESC 3 n
const LINE_RESET = `${ESC}2`; // back to default line spacing

// Font A letters are 12 dots wide, so fewer fit per line with spacing
const HEADER_CHARS = Math.floor(PAPER_DOTS / (12 + HEADER_SPACING));

// ===========================================================
// FOOTER STYLE (contact, valid only for 1hr, scheme, GST note)
//
// The footer was Font B (small). It is now Font A, which is bigger
// (letters 9 dots -> 12 dots wide). On 80mm paper every footer line
// still fits on ONE line (longest line is 41 characters).
//
// FOOTER_SPACING: extra dots between letters. 0 = normal, 1 = slightly
// wider. Keep it at 1 or less so the longest line still fits one line.
// ===========================================================
const FOOTER_FONT = FONT_A;
const FOOTER_SPACING = 0;
const FOOTER_SPACING_ON = `${ESC} ${String.fromCharCode(FOOTER_SPACING)}`;
const FOOTER_SPACING_OFF = `${ESC} \x00`;
const FOOTER_CHARS = Math.floor(PAPER_DOTS / (12 + FOOTER_SPACING));

// ESC \ nL nH = move the print position right by n dots
// Product detail rows are moved 20 dots to the right
const ITEM_SHIFT_DOTS = 60;
const SHIFT_ITEM = `${ESC}\\${String.fromCharCode(ITEM_SHIFT_DOTS, 0)}`;

// Max value characters so shift + label + ": " + value never passes the paper edge
const ITEM_VALUE_CHARS = Math.floor((PAPER_DOTS - ITEM_SHIFT_DOTS) / 12) - LABEL_W - 2;


// ESC \ nL nH = move the print position right by n dots (10 dots here)
const PAY_SHIFT_DOTS = 10;
const SHIFT_RIGHT = `${ESC}\\${String.fromCharCode(PAY_SHIFT_DOTS, 0)}`;

// ===========================================================
// Small helpers
// ===========================================================

const num = (n: unknown) => Number(n) || 0;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fixed2 = (n: unknown) => num(n).toFixed(2);
const fixed3 = (n: unknown) => num(n).toFixed(3);
const plain = (n: unknown) => String(Number(num(n).toFixed(2)));

// Thermal printers only reliably print plain ASCII. Anything else
// (₹, ×, —, accents, emoji) is replaced so it never prints as garbage.
function clean(text: unknown): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs')
    .replace(/[×✕]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
}

// Dash line: runs the FULL paper width (see DASH_CHARS above)
const dashed = () => '-'.repeat(DASH_CHARS) + LF;
const tightDash = () => dashed();

// Word-wrap text to the given width
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

// Header text: centered, bold, clear font, letter spacing, airy line gap.
// Every header line uses the same style.
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

// Footer note: every note stays on ONE line.
// Text longer than the line is cut instead of wrapping to the next line.
// Empty text prints a blank line.
const footerLine = (text: string) => {
  const t = clean(text).trim();
  if (!t) return LF;
  return (
    FOOTER_FONT + FOOTER_SPACING_ON + t.slice(0, FOOTER_CHARS) + LF +
    FOOTER_SPACING_OFF + FONT_A
  );
};

// "13-11-26 12:39 PM"  (short format so it fits on the item line)
function billingTimeShort(iso: string): string {
  const parsed = new Date(iso);
  const d = isNaN(parsed.getTime()) ? new Date() : parsed;
  const p = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)} ${p(h12)}:${p(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

// "NEW ITEM : 916 Gold Ornaments   13-11-26 12:39 PM"
// Item title on the left, timestamp at the right end of the SAME line.
// If the title is too long, the extra part continues on the next line.
function itemTitleWithTime(label: string, name: string, iso?: string): string {
  // No timestamp: print just the title
  if (!iso) {
    const plainLines = wrap(`${label}${name}`, SMALL_CHARS);
    if (plainLines.length === 0) plainLines.push('');
    return FONT_B + plainLines.map((l) => l + LF).join('') + FONT_A;
  }

  const time = billingTimeShort(iso);
  const firstMax = SMALL_CHARS - time.length - 1;
  const lines = wrap(`${label}${name}`, firstMax);
  if (lines.length === 0) lines.push('');
  const first = lines[0].padEnd(SMALL_CHARS - time.length, ' ') + time;
  const rest = lines.slice(1);
  return FONT_B + [first, ...rest].map((l) => l + LF).join('') + FONT_A;
}

// "Label           : value" — same look as the slip rows
function row(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, WIDTH - LABEL_W - 2);
  return `${lbl}: ${val}${LF}`;
}

const boldRow = (label: string, value: string) => BOLD_ON + row(label, value) + BOLD_OFF;

// Product-detail rows: same as row(), moved 20 dots right (value is 2 chars
// shorter so the line never wraps past the paper edge)
function itemRow(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, ITEM_VALUE_CHARS);
  return `${SHIFT_ITEM}${lbl}: ${val}${LF}`;
}
const itemBoldRow = (label: string, value: string) => BOLD_ON + itemRow(label, value) + BOLD_OFF;

// Summary rows (Discount, Nett RS, Paid): shifted right like the product rows
function summaryRow(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, ITEM_VALUE_CHARS);
  return `${SHIFT_ITEM}${lbl}: ${val}${LF}`;
}

const boldSummaryRow = (label: string, value: string) =>
  BOLD_ON + summaryRow(label, value) + BOLD_OFF;

const VA_CHARGE = 'Value Added Charge';
const STONE_CHARGE = 'Stone Charge';
const DIAMOND_PREFIX = 'Diamond';
const isDiamondCharge = (name: unknown) => String(name ?? '').startsWith(DIAMOND_PREFIX);

// "Diamond 0.25 ct" -> "0.25 ct"  (the size/weight part of the charge name)
const diamondWeightOf = (name: unknown) =>
  String(name ?? '').replace(new RegExp(`^${DIAMOND_PREFIX}\\s*`, 'i'), '').trim() || '-';

// ===========================================================
// Piece-rate (PR) items: GOLD - PR / SILVER - PR
// No weights, rate or making; only the tax split and the amount.
// ===========================================================
const PIECE_RE = /\bPR\b|piece\s*rate/i;

function isPieceItem(item: InvoiceItemDetail): boolean {
  if (PIECE_RE.test(String((item as any).purity_name ?? ''))) return true;
  // Fallback if the purity name is not on the item: no weight, no rate, but an amount
  return (
    num(item.gross_weight) === 0 &&
    num(item.net_weight) === 0 &&
    num(item.metal_rate) === 0 &&
    num(item.total) > 0
  );
}

// Short centered dash line (EDIT PIECE_DASH_CHARS to make it longer / shorter)
const PIECE_DASH_CHARS = 8;
const pieceDash = () => ALIGN_CENTER + '-'.repeat(PIECE_DASH_CHARS) + LF + ALIGN_LEFT;

// Centered text line, e.g. "GOLD PC RATE Item"
const pieceCenter = (text: string) => ALIGN_CENTER + clean(text) + LF + ALIGN_LEFT;

// True only for the pre-save estimate print (see handlePrintEstimate in new.tsx)
const isEstimateInvoice = (invoice: InvoiceDetail) =>
  invoice.id === 'estimate' || invoice.invoice_number === 'ESTIMATE';

const PAY_MODE_LABELS: Record<string, string> = {
  cash: 'CASH',
  card: 'CARD',
  upi: 'UPI',
  bank_transfer: 'BANK TRANSFER',
  cheque: 'CHEQUE',
  credit: 'CREDIT',
};

const PAID_MODE_NAMES: Record<string, string> = {
  cash: 'cash',
  card: 'card',
  upi: 'UPI',
  bank_transfer: 'bank transfer',
  cheque: 'cheque',
};

// Tax amount from invoice.charges (CGST / SGST / IGST|GST)
function taxAmountOf(invoice: InvoiceDetail, kind: 'CGST' | 'SGST' | 'IGST'): number {
  const names = kind === 'IGST' ? ['IGST', 'GST'] : [kind];
  const found = (invoice.charges ?? []).find((c) =>
    names.includes(String(c.charge_name ?? '').trim().toUpperCase())
  )?.amount;
  return round2(num(found));
}

// The advance paid on the customer order (tagged in new.tsx)
const isAdvanceSplit = (s: any) =>
  s?.id === 'advance' || String(s?.reference ?? '').trim().toLowerCase() === 'advance';

// One total per payment mode, EXCLUDING the advance (two cash rows -> one cash figure)
function splitTotalsByMode(invoice: InvoiceDetail): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of invoice.payment_splits ?? []) {
    if (isAdvanceSplit(s)) continue;
    const amt = num(s.amount);
    if (amt <= 0) continue;
    totals[s.mode] = round2((totals[s.mode] ?? 0) + amt);
  }
  return totals;
}

// Advance totals per mode
function advanceTotalsByMode(invoice: InvoiceDetail): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of invoice.payment_splits ?? []) {
    if (!isAdvanceSplit(s)) continue;
    const amt = num(s.amount);
    if (amt <= 0) continue;
    totals[s.mode] = round2((totals[s.mode] ?? 0) + amt);
  }
  return totals;
}

// ===========================================================
// Main
// ===========================================================

export async function printThermalReceiptDirect(
  device: BluetoothDevice,
  invoice: InvoiceDetail,
  shop: ShopDetails,
  display: Record<string, any> = {}
) {
  const f = slipFigures(invoice);
  const gst = isGstInvoice(invoice);
  const isEstimate = isEstimateInvoice(invoice);

  const showWeight = display.show_weight !== false;
  const showMaking = display.show_making_charges !== false;
  const showVa = display.show_value_added_charges !== false;

  let out = INIT;

  // -------------------------------------------------------
  // Shop header (clear bold font, all lines same style)
  //
  //     ANAND JEWELLERS
  //  Ph: 9363780499,7010768696
  //     ROUGH ESTIMATE
  //  Gold : 12695 SIL: 195.00
  // -------------------------------------------------------

  out += centerHead(shop.name.toUpperCase());

  if (isEstimate) {
    // Estimate: phone -> ROUGH ESTIMATE -> Gold / Silver rate
    if (shop.phone) out += centerHead(`Ph: ${shop.phone}`);
    out += centerHead('ROUGH ESTIMATE');

    // Pass display.gold_rate and display.silver_rate to print the rate line
    const goldRate = display.gold_rate;
    const silverRate = display.silver_rate;
    const rateParts = [
      goldRate !== undefined && goldRate !== null && goldRate !== ''
        ? `Gold : ${plain(goldRate)}`
        : '',
      silverRate !== undefined && silverRate !== null && silverRate !== ''
        ? `SIL: ${fixed2(silverRate)}`
        : '',
    ].filter(Boolean);
    if (rateParts.length) out += centerHead(rateParts.join(' '));
  } else {
    // Final bill: address -> phone -> GSTIN + PAN
    const addr = [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
    if (addr) out += centerHead(addr);

    if (shop.phone) out += centerHead(`Ph: ${shop.phone}`);

    const reg = [gst && shop.gstin ? `GSTIN: ${shop.gstin}` : '', shop.pan ? `PAN: ${shop.pan}` : '']
      .filter(Boolean)
      .join(' | ');
    if (reg) out += centerHead(reg);
  }

  out += dashed();

  // -------------------------------------------------------
  // Per-item blocks
  // -------------------------------------------------------
  const subtotalOverall = round2(num(invoice.subtotal));
  const cgstTotal = taxAmountOf(invoice, 'CGST');
  const sgstTotal = taxAmountOf(invoice, 'SGST');
  const igstTotal = taxAmountOf(invoice, 'IGST');
  const hasSplitGst = cgstTotal > 0 && sgstTotal > 0;
  const cgstRate = subtotalOverall > 0 ? (cgstTotal / subtotalOverall) * 100 : 0;
  const sgstRate = subtotalOverall > 0 ? (sgstTotal / subtotalOverall) * 100 : 0;
  const igstRate = subtotalOverall > 0 ? (igstTotal / subtotalOverall) * 100 : 0;

  const itemCount = (invoice.items ?? []).length;

  (invoice.items ?? []).forEach((item: InvoiceItemDetail, idx: number) => {
    const qty = num(item.quantity) || 1;
    const grossWt = round3(num(item.gross_weight) * qty);
    const netWt = round3(num(item.net_weight) * qty);
    const lessWt = round3(Math.max(0, grossWt - netWt));

    const lines = item.value_added_charges ?? [];
    const vaLine = lines.find((c) => c.charge_name === VA_CHARGE);
    const stoneLine = lines.find((c) => c.charge_name === STONE_CHARGE);
    const diamondLines = lines.filter((c) => isDiamondCharge(c.charge_name) && num(c.amount) > 0);
    const otherLines = lines.filter(
      (c) => c.charge_name !== VA_CHARGE && c.charge_name !== STONE_CHARGE && !isDiamondCharge(c.charge_name)
    );

    const itemTaxable = round2(num(item.total) - num(item.tax_amount));
    const itemCgst = hasSplitGst ? round2((itemTaxable * cgstRate) / 100) : 0;
    const itemSgst = hasSplitGst ? round2((itemTaxable * sgstRate) / 100) : 0;
    const itemIgst = !hasSplitGst && igstTotal > 0 ? round2((itemTaxable * igstRate) / 100) : 0;

    // Does this item have any tax line to print? (decides if "Total" shows)
    const itemHasTax =
      (hasSplitGst && (itemCgst > 0 || itemSgst > 0)) ||
      itemIgst > 0 ||
      num(item.tax_amount) > 0;

    // Separator between items (the first item already has the header dashes)
    if (idx > 0) out += dashed();

    // Title + timestamp on the SAME line:
    // "NEW ITEM : 916 Gold Ornaments   13-11-26 12:39 PM"
    const titleLabel = itemCount > 1 ? `NEW ITEM ${idx + 1} : ` : 'NEW ITEM : ';
    out += itemTitleWithTime(
      titleLabel,
      String(item.product_name ?? ''),
      idx === 0 ? invoice.invoice_date : undefined
    );

    // "Qty: 1 Tag:"  (tag left empty for hand writing)
    const tag = clean((item as any).tag_number ?? (item as any).tag ?? '');
    out += `Qty: ${qty} Tag: ${tag}${LF}`;
    out += LF;

    // Piece-rate item: print only the layout from the sample slip
    if (isPieceItem(item)) {
      const metal = String(item.metal_name ?? '').trim().toUpperCase() || 'GOLD';

      out += pieceDash();
      out += pieceCenter(`${metal} PC RATE Item`);
      out += pieceDash();

      let taxPrinted = false;
      if (hasSplitGst) {
        if (itemCgst > 0) { out += itemRow(`CGST @ ${cgstRate.toFixed(1)}%`, fixed2(itemCgst)); taxPrinted = true; }
        if (itemSgst > 0) { out += itemRow(`SGST @ ${sgstRate.toFixed(1)}%`, fixed2(itemSgst)); taxPrinted = true; }
      } else if (itemIgst > 0) {
        out += itemRow(`GST @ ${igstRate.toFixed(1)}%`, fixed2(itemIgst));
        taxPrinted = true;
      } else if (num(item.tax_amount) > 0) {
        out += itemRow('Tax', fixed2(item.tax_amount));
        taxPrinted = true;
      }

      if (taxPrinted) out += pieceDash();
      out += itemRow('Gross', plain(item.total));
      if (itemCount > 1) out += LF; // gap only when more items follow
      return; // skip the weight / rate / charges block below
    }

    // Weights + rate
    if (showWeight) {
      out += itemRow('Weight', `${fixed3(grossWt)} gms`);
      if (lessWt > 0) {
        out += itemRow('Stone/Less(wt)', `${fixed3(lessWt)} gms`);
        out += LF;
        out += itemRow('Nett Weight', `${fixed3(netWt)} gms`);
      }
    }
    out += itemRow('Rate/Gm', plain(item.metal_rate));
    if (showVa && vaLine) {
      out += itemRow(
        'V.ADDN',
        vaLine.calculation_type === 'percentage'
          ? `${num(vaLine.value).toFixed(1)} %`
          : fixed2(num(vaLine.amount) * qty)
      );
    }
    out += tightDash();

    // Charges
    const hasCharges =
      (showMaking && num(item.making_charge_amount) > 0) ||
      (showVa && (stoneLine || diamondLines.length > 0 || otherLines.length > 0));

    if (showMaking && num(item.making_charge_amount) > 0) {
      out += itemRow('MC', plain(item.making_charge_amount));
    }
    if (showVa && stoneLine) {
      out += itemRow('Stone Charges', plain(num(stoneLine.amount) * qty));
    }

    // Diamonds: weight (e.g. "0.25 ct") + amount, one pair of rows per diamond
    if (showVa) {
      for (const c of diamondLines) {
        out += itemRow('Diamond Wt', diamondWeightOf(c.charge_name) + ' ct');
        out += itemRow('Diamond Amt', plain(num(c.amount) * qty));
      }
      for (const c of otherLines) out += itemRow(c.charge_name, plain(num(c.amount) * qty));
    }
    if (hasCharges) out += tightDash();

    // Total BEFORE GST (only when this item has tax)
    if (itemHasTax) {
      out += itemBoldRow('Total', fixed2(itemTaxable));
      out += tightDash();
    }

    // Tax (only exists when GST was applied)
    if (hasSplitGst) {
      if (itemCgst > 0) out += itemRow(`CGST @ ${cgstRate.toFixed(1)}%`, fixed2(itemCgst));
      if (itemSgst > 0) out += itemRow(`SGST @ ${sgstRate.toFixed(1)}%`, fixed2(itemSgst));
    } else if (itemIgst > 0) {
      out += itemRow(`GST @ ${igstRate.toFixed(1)}%`, fixed2(itemIgst));
    } else if (num(item.tax_amount) > 0) {
      out += itemRow('Tax', fixed2(item.tax_amount));
    }

    if (itemHasTax) out += tightDash();
    out += itemBoldRow('Gross', fixed2(item.total));
    out += LF;
  });

  // Sum of all NEW items (before discount), same idea as OLD TOTAL.
  // Skipped for a single piece-rate item (the sample slip goes Gross -> Nett RS).
  const singlePieceItem = itemCount === 1 && isPieceItem(invoice.items[0]);
  if (itemCount > 0 && !singlePieceItem) {
    out += tightDash();
    out += itemBoldRow('NEW TOTAL', fixed2(f.grand + f.discount));
    out += LF;
  }

  // -------------------------------------------------------
  // Old gold exchange
  // -------------------------------------------------------
  f.exchangeItems.forEach((e, idx) => {
    const purityPct = num((e as any).old_percent ?? (e as any).purity_percent ?? 100);
    const dustStone = num((e as any).stone_weight ?? (e as any).dust_weight ?? 0);
    const grossWt = num(e.gross_weight);
    const calcGross = displayNetWeight(e);

    out += BOLD_ON;
    out += wrap(`OLD ITEM ${idx + 1} : ${String(e.description || 'Gold Item').toUpperCase()}`)
      .map((l) => l + LF)
      .join('');
    out += BOLD_OFF;
    out += dashed();

    out += itemRow('Weight', fixed3(grossWt));
    if (dustStone > 0) {
      out += itemRow('Dust/Stone', fixed3(dustStone));
      out += itemRow('Gross Weight', fixed3(calcGross));
    }
    out += itemRow('Old Percentage', `* ${fixed2(purityPct)}%`);
    out += tightDash();
    out += itemRow('Old Rate/Gm', `* ${plain(e.rate_per_gram)}`);
    out += tightDash();
    out += itemRow('Gross', fixed2(e.amount));
    out += LF;
  });

  if (f.exchangeItems.length > 0) {
    out += tightDash();
    out += itemBoldRow('OLD TOTAL', fixed2(f.exchangeTotal));
  }

  // -------------------------------------------------------
  // Net amount + payments (values shifted 10 dots to the right)
  // -------------------------------------------------------
  // Discount (only when one is given) — printed before the final amount
  if (f.discount > 0) {
    out += dashed();
    out += boldSummaryRow('Discount', `-${fixed2(f.discount)}`);
  }
  out += boldSummaryRow(
    f.netBillAmount < 0 ? 'Nett (C.R)' : 'Nett RS',
    fixed2(f.netBillAmount)
  );
  out += LF;

  const splitEntries = Object.entries(splitTotalsByMode(invoice));
  const advanceEntries = Object.entries(advanceTotalsByMode(invoice));

  // Advance paid on the customer order, printed first
  for (const [mode, amt] of advanceEntries) {
    const modeName = PAID_MODE_NAMES[mode] ?? mode.replace(/_/g, ' ');
    out += boldSummaryRow(`Advance (${modeName})`, fixed2(amt));
  }

  if (splitEntries.length > 0) {
    for (const [mode, amt] of splitEntries) {
      let label: string;
      if (isEstimate) {
        label = PAY_MODE_LABELS[mode] ?? mode.toUpperCase();   // estimate unchanged
      } else if (mode === 'credit') {
        label = 'Credit';
      } else {
        label = `Paid (${PAID_MODE_NAMES[mode] ?? mode.replace(/_/g, ' ')})`;
      }
      out += boldSummaryRow(label, fixed2(amt));
    }
  } else if (advanceEntries.length === 0) {
    if (!isEstimate && f.paid > 0) {
      // Older invoices with no split rows: use the single saved payment mode
      const legacyMode = String((invoice as any).payment_mode ?? 'cash');
      out += boldSummaryRow(
        `Paid (${PAID_MODE_NAMES[legacyMode] ?? legacyMode.replace(/_/g, ' ')})`,
        fixed2(f.paid)
      );
    } else {
      out += boldSummaryRow('FINAL AMOUNT', f.paid > 0 ? fixed2(f.paid) : '');
    }
  }

  // Estimate with an advance: show what is still to pay
  if (isEstimate && advanceEntries.length > 0) {
    out += boldSummaryRow('BALANCE', fixed2(invoice.balance_amount));
  }

  // -------------------------------------------------------
  // Footer (bigger Font A, every note on ONE line, no wrapping)
  // -------------------------------------------------------
  out += LF + LF + dashed();

  out += footerLine(shop.phone ? `CONTACT :${shop.phone}` : '');

  if (isEstimate) {
    out += footerLine('**valid only for 1hr, Prices May change**');
    out += footerLine('Join Our Monthly Savings Scheme !!');
    out += footerLine('GST Bill will be issued on Confirmation');
  } else {
    out += footerLine('Thank you! Visit again');
    out += footerLine('Join Our Monthly Savings Scheme !!');
  }

  // Feed paper past the tear bar, then cut
  out += LF + LF + LF + LF;
  out += CUT_PAPER;

  await device.write(out);
}