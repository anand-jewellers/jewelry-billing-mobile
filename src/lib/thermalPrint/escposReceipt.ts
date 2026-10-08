// src/lib/thermalPrint/escposReceipt.ts

import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { InvoiceDetail, InvoiceItemDetail } from '../../types/invoices';
import { slipFigures, isGstInvoice, type ShopDetails } from '../invoicePdf';
import { displayNetWeight } from '../exchangeGold';

// ===========================================================
// PAPER WIDTH
// 58mm printer -> 32 characters
// 80mm printer -> 48 characters
// Change this one number to match your printer.
// ===========================================================

const WIDTH = 32;
const LABEL_W = Math.floor(WIDTH * 0.5); // label column; value column is the rest

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

const dashed = () => '-'.repeat(WIDTH) + LF;

// Short dashes under the value column (like the tight-dash on the slip)
const tightDash = () => ' '.repeat(LABEL_W + 2) + '-'.repeat(WIDTH - LABEL_W - 2) + LF;

// Word-wrap text to the paper width
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

const center = (text: string) => wrap(text).map((l) => ALIGN_CENTER + l + LF).join('') + ALIGN_LEFT;
const left = (text: string) => wrap(text).map((l) => l + LF).join('');

// Footer note: printed on ONE line (no word-wrap) using the smaller Font B,
// so a long note like "**valid only for 1hr, Prices May change**" (41 chars)
// fits a 58mm slip (42 chars in Font B) instead of breaking onto a 2nd line.
const footerLine = (text: string) => FONT_B + clean(text) + LF + FONT_A;

// "Label           : value" — same look as the slip rows
function row(label: string, value: string): string {
  const lbl = clean(label).slice(0, LABEL_W).padEnd(LABEL_W, ' ');
  const val = clean(value).slice(0, WIDTH - LABEL_W - 2);
  return `${lbl}: ${val}${LF}`;
}

const boldRow = (label: string, value: string) => BOLD_ON + row(label, value) + BOLD_OFF;

const VA_CHARGE = 'Value Added Charge';
const STONE_CHARGE = 'Stone Charge';
const DIAMOND_PREFIX = 'Diamond';
const isDiamondCharge = (name: unknown) => String(name ?? '').startsWith(DIAMOND_PREFIX);

// "Diamond 0.25 ct" -> "0.25 ct"  (the size/weight part of the charge name)
const diamondWeightOf = (name: unknown) =>
  String(name ?? '').replace(new RegExp(`^${DIAMOND_PREFIX}\\s*`, 'i'), '').trim() || '-';

// True only for the pre-save estimate print (see handlePrintEstimate in new.tsx)
const isEstimateInvoice = (invoice: InvoiceDetail) =>
  invoice.id === 'estimate' || invoice.invoice_number === 'ESTIMATE';

const PAY_MODE_LABELS: Record<string, string> = {
  cash: 'CASH',
  card: 'CARD',
  upi: 'UPI',
  bank_transfer: 'BANK TRANSFER',
  cheque: 'CHEQUE',
};

// Tax amount from invoice.charges (CGST / SGST / IGST|GST)
function taxAmountOf(invoice: InvoiceDetail, kind: 'CGST' | 'SGST' | 'IGST'): number {
  const names = kind === 'IGST' ? ['IGST', 'GST'] : [kind];
  const found = (invoice.charges ?? []).find((c) =>
    names.includes(String(c.charge_name ?? '').trim().toUpperCase())
  )?.amount;
  return round2(num(found));
}

// One total per payment mode (two cash rows -> one cash figure)
function splitTotalsByMode(invoice: InvoiceDetail): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of invoice.payment_splits ?? []) {
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

  const showWeight = display.show_weight !== false;
  const showMaking = display.show_making_charges !== false;
  const showVa = display.show_value_added_charges !== false;

  let out = INIT;

  // -------------------------------------------------------
  // Shop header
  // -------------------------------------------------------
  out += ALIGN_CENTER + BOLD_ON;
  out += wrap(shop.name.toUpperCase()).map((l) => l + LF).join('');
  out += BOLD_OFF + ALIGN_LEFT;

  const addr = [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
  if (addr) out += center(addr);

  // const contact = [shop.phone ? `Ph: ${shop.phone}` : '', shop.email ?? ''].filter(Boolean).join(' | ');
  // if (contact) out += center(contact);

  // GSTIN is printed only when the bill actually has GST
  const reg = [gst && shop.gstin ? `GSTIN: ${shop.gstin}` : '', shop.pan ? `PAN: ${shop.pan}` : '']
    .filter(Boolean)
    .join(' | ');
  if (reg) out += center(reg);

  // "ROUGH ESTIMATE" label directly under the GSTIN line (estimate prints only)
  if (isEstimateInvoice(invoice)) {
    out += ALIGN_CENTER + BOLD_ON + 'ROUGH ESTIMATE' + LF + BOLD_OFF + ALIGN_LEFT;
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

    // Title
    out += BOLD_ON;
    out += wrap(`ITEM ${idx + 1}: ${String(item.product_name).toUpperCase()}${qty > 1 ? ` x${qty}` : ''}`)
      .map((l) => l + LF)
      .join('');
    out += BOLD_OFF;
    out += '-'.repeat(6) + LF;

    // Weights + rate
    if (showWeight) {
      out += row('Weight', `${fixed3(grossWt)} gms`);
      out += row('Stone/Less(wt)', fixed3(lessWt));
      out += LF;
      out += row('Nett Weight', fixed3(netWt));
    }
    out += row('Rate/gm', plain(item.metal_rate));
    if (showVa && vaLine) {
      out += row(
        'V.ADNV',
        vaLine.calculation_type === 'percentage'
          ? `${num(vaLine.value).toFixed(1)} %`
          : fixed2(num(vaLine.amount) * qty)
      );
    }
    out += tightDash();

    // Charges
    if (showMaking && num(item.making_charge_amount) > 0) {
      out += row('MC', plain(item.making_charge_amount));
    }
    if (showVa && stoneLine) {
      out += row('Stone Charges', plain(num(stoneLine.amount) * qty));
    }

    // Diamonds: weight (e.g. "0.25 ct") + amount, one pair of rows per diamond
    if (showVa) {
      for (const c of diamondLines) {
        out += row('Diamond Wt', diamondWeightOf(c.charge_name) + ' ct');
        out += row('Diamond Amt', plain(num(c.amount) * qty));
      }
      for (const c of otherLines) out += row(c.charge_name, plain(num(c.amount) * qty));
    }
    out += tightDash();

    // Total BEFORE GST (only when this item has tax)
    if (itemHasTax) {
      out += boldRow('Total', fixed2(itemTaxable));
      out += tightDash();
    }

    // Tax (only exists when GST was applied)
    if (hasSplitGst) {
      if (itemCgst > 0) out += row(`CGST @ ${cgstRate.toFixed(1)}%`, fixed2(itemCgst));
      if (itemSgst > 0) out += row(`SGST @ ${sgstRate.toFixed(1)}%`, fixed2(itemSgst));
    } else if (itemIgst > 0) {
      out += row(`GST @ ${igstRate.toFixed(1)}%`, fixed2(itemIgst));
    } else if (num(item.tax_amount) > 0) {
      out += row('Tax', fixed2(item.tax_amount));
    }

    out += boldRow('Gross', fixed2(item.total));
    out += LF;
  });

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
    out += '-'.repeat(6) + LF;

    out += row('Weight', fixed3(grossWt));
    if (dustStone > 0) {
      out += row('Dust/Stone', fixed3(dustStone));
      out += row('Gross Weight', fixed3(calcGross));
    }
    out += row('Old Percentage', `* ${fixed2(purityPct)}%`);
    out += tightDash();
    out += row('Old Rate/Gm', `* ${plain(e.rate_per_gram)}`);
    out += tightDash();
    out += row('Gross', fixed2(e.amount));
    out += LF;
  });

  if (f.exchangeItems.length > 0) {
    out += tightDash();
    out += boldRow('OLD TOTAL', fixed2(f.exchangeTotal));
  }

  // -------------------------------------------------------
  // Net amount + payments
  // -------------------------------------------------------
  // Discount (only when one is given) — printed before the final amount
  if (f.discount > 0) {
    out += dashed();
    out += boldRow('Discount', `-${fixed2(f.discount)}`);
  }
  out += dashed();
  out += boldRow('Nett RS', fixed2(f.netBillAmount));
  out += dashed();

  const splitEntries = Object.entries(splitTotalsByMode(invoice));

  if (splitEntries.length > 0) {
    for (const [mode, amt] of splitEntries) {
      out += boldRow(PAY_MODE_LABELS[mode] ?? mode.toUpperCase(), fixed2(amt));
    }
  } else {
    out += boldRow('FINAL AMOUNT', f.paid > 0 ? fixed2(f.paid) : '');
  }

  // -------------------------------------------------------
  // Footer
  // -------------------------------------------------------
  out += LF + dashed();
  out += footerLine(shop.phone ? `CONTACT :${shop.phone}` : '');
  out += footerLine('**valid only for 1hr, Prices May change**');
  out += footerLine('Join Our Monthly Savings Scheme !!');
  out += LF;
  out += footerLine('GST Bill will be issued on Confirmation');

  out += LF + LF + LF + LF;
  out += CUT_PAPER;

  await device.write(out);
}