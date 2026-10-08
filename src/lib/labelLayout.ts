// src/lib/labelLayout.ts
// Single source of truth for the 100 x 15 mm label geometry (all units in mm).
// Used by BOTH the on-screen preview and the print HTML.
// @ts-ignore — jsbarcode ships no TS types; headless mode only
import JsBarcode from 'jsbarcode';
import { parseCarat, diamondChargeAmount } from './invoiceCalc';
export interface LabelData {
  barcode: string;
  purity: string;
  huid?: string | null;
  category: string;
  grossWeight: number;
  netWeight: number;
  vaPercent?: number;              // VA %
  makingCharge?: number;           // MC amount
  stoneCharge?: number;            // SC amount
  diamondWeight?: number | string; // DWT (diamond size/weight text)
  diamondCharge?: number;          // diamond charges
}

export const LABEL_W_MM = 100;
export const LABEL_H_MM = 15;
export const PRINT_W_MM = 65;
// 'left'  -> printable (gummed) zone on the left, 35mm tail on the right
// 'right' -> printable zone on the right, tail on the left
export const PRINT_SIDE: 'left' | 'right' = 'left';
export const TAIL_X_MM = PRINT_SIDE === 'left' ? PRINT_W_MM : 0;
export const TAIL_W_MM = LABEL_W_MM - PRINT_W_MM;

const DOT_MM = 0.125;          // one printer dot at 203 dpi
const MIN_MODULE_DOTS = 2;     // 0.25mm
const MAX_MODULE_DOTS = 4;     // 0.5mm

// ---- Left block: barcode, digits, then "purity | huid" underneath ----
const BARS_X = 2.2;            // quiet zone left of the bars
const QUIET_R = 2.2;           // quiet zone right of the bars
const MAX_BARS_MM = 24;        // barcode width cap
const BAR_TOP = 1.0;
const BAR_H = 7.2;             // bars end at y = 8.2
const DIGITS_Y = 10.9;         // barcode number baseline
const DIGITS_SIZE = 2.4;
const ID_Y = 14.0;             // "18K | 23JO9P" baseline
const ID_MAX_SIZE = 2.0;

// ---- Right block: item details ----
const RIGHT_GAP_MM = 10.0;      // gap between left block and details
const RIGHT_PAD_MM = 0.5;      // keep clear of the printable edge
const MAX_ROW_H = 3.2;
const CHAR_W = 0.64;           // avg glyph width / font size (Arial bold), for fitting

export interface LabelText {
  x: number;
  y: number;
  size: number;
  text: string;
  anchor: 'start' | 'middle';
}

export interface LabelLayout {
  barsPath: string;
  texts: LabelText[];
  moduleMm: number;
}

function encodeCode128(value: string): string | null {
  if (!value) return null;
  try {
    const data: any = {};
    JsBarcode(data, value, { format: 'CODE128', displayValue: false });
    return (data.encodings?.[0]?.data as string) ?? null;
  } catch (e) {
    console.warn('Barcode encoding failed', e);
    return null;
  }
}

const w3 = (v: number) => (Number(v) || 0).toFixed(3);
const num = (v?: number | null) => Number(v) || 0;
// 12.50 -> "12.5", 1500 -> "1500"
const trim = (v: number) => String(Number(num(v).toFixed(2)));
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Row {
  left: string;
  right?: string; // when present, row is drawn as "left | right" in aligned columns
}

/**
 * SINGLE place that turns a product record (from getProductById) into label data.
 * Both the product detail screen and the bulk-print screen must use this,
 * so the two labels can never drift apart.
 * Returns null when the product has no barcode.
 */
/**
 * SINGLE place that turns a product record (from getProductById) into label data.
 * Mirrors exactly what the product detail screen computes, so the single-print
 * and bulk-print labels are identical.
 * Returns null when the product has no barcode.
 */
export function productToLabelData(p: any): LabelData | null {
  if (!p?.barcode) return null;

  const charges: any[] = p.product_value_added_charges ?? [];
  const chargeVal = (name: string) =>
    Number(charges.find((c) => c.charge_name === name)?.value) || 0;

  const diamonds: any[] = p.product_diamonds ?? [];
  const totalDiamondWt = diamonds.reduce((s, d) => s + parseCarat(d.size), 0);
  const totalDiamondAmt = diamonds.reduce(
    (s, d) => s + diamondChargeAmount(d.size, d.amount),
    0
  );

  return {
    barcode: String(p.barcode),
    purity: p.purities?.name ?? '',
    huid: p.huid ?? null,
    category: p.categories?.name ?? '',
    grossWeight: Number(p.gross_weight) || 0,
    netWeight: Number(p.net_weight) || 0,
    vaPercent: chargeVal('Value Added Charge'),
    makingCharge: chargeVal('Making Charge'),
    stoneCharge: chargeVal('Stone Charge'),
    diamondWeight: totalDiamondWt > 0 ? totalDiamondWt.toFixed(3) : '',
    diamondCharge: totalDiamondAmt,
  };
}

export function buildLabelLayout(l: LabelData): LabelLayout {
  const x0 = PRINT_SIDE === 'left' ? 0 : LABEL_W_MM - PRINT_W_MM;
  const code = String(l.barcode ?? '');
  const pattern = encodeCode128(code);

  // Widest module (whole printer dots) that keeps the bars <= MAX_BARS_MM.
  let moduleMm = MIN_MODULE_DOTS * DOT_MM;
  let barsW = 0;
  if (pattern) {
    for (let dots = MAX_MODULE_DOTS; dots >= MIN_MODULE_DOTS; dots--) {
      moduleMm = dots * DOT_MM;
      barsW = pattern.length * moduleMm;
      if (barsW <= MAX_BARS_MM) break;
    }
  }

  const barsX = x0 + BARS_X;
  const leftBlockW = BARS_X + barsW + QUIET_R;
  const cx = barsX + barsW / 2; // centre of the left block

  let barsPath = '';
  if (pattern) {
    let i = 0;
    while (i < pattern.length) {
      if (pattern[i] === '1') {
        let j = i;
        while (j < pattern.length && pattern[j] === '1') j++;
        const w = (j - i) * moduleMm;
        barsPath += `M${w3(barsX + i * moduleMm)} ${BAR_TOP}h${w3(w)}v${BAR_H}h-${w3(w)}z`;
        i = j;
      } else {
        i++;
      }
    }
  }

  const texts: LabelText[] = [];

  // ---------- LEFT BLOCK ----------
  // Barcode number under the bars
  texts.push({ x: cx, y: DIGITS_Y, size: DIGITS_SIZE, text: code, anchor: 'middle' });

  // "purity | huid" at the bottom of the barcode
  const purity = String(l.purity ?? '').trim();
  const huidText = l.huid ? String(l.huid).trim().toUpperCase() : '';
  const idLine = huidText ? `${purity} | ${huidText}` : purity;
  if (idLine) {
    const idSize = r2(Math.min(ID_MAX_SIZE, (leftBlockW - 1) / (idLine.length * CHAR_W)));
    texts.push({ x: cx, y: ID_Y, size: idSize, text: idLine, anchor: 'middle' });
  }

  // ---------- RIGHT BLOCK ----------
  const rows: Row[] = [];

  const cat = String(l.category ?? '').trim().toUpperCase().slice(0, 24);
  if (cat) rows.push({ left: cat });

  rows.push({ left: `GWT:${w3(l.grossWeight)}`, right: `NWT:${w3(l.netWeight)}` });

  if (num(l.vaPercent) > 0 || num(l.makingCharge) > 0) {
    rows.push({ left: `VA:${trim(num(l.vaPercent))}%`, right: `MC:${trim(num(l.makingCharge))}` });
  }

  if (num(l.stoneCharge) > 0) {
    rows.push({ left: `SC:${trim(num(l.stoneCharge))}` });
  }

  const dwt = String(l.diamondWeight ?? '').trim();
  if ((dwt && dwt !== '0') || num(l.diamondCharge) > 0) {
    rows.push({ left: `CTS:${dwt || '-'}`, right: `DC:${trim(num(l.diamondCharge))}` });
  }

  const textX = barsX + barsW + QUIET_R + RIGHT_GAP_MM;
  const avail = x0 + PRINT_W_MM - textX - RIGHT_PAD_MM;
  const rowH = Math.min(MAX_ROW_H, (LABEL_H_MM - 1.2) / rows.length);

  // Column widths in characters, so the "|" lines up on every paired row
  const pairs = rows.filter((r) => r.right);
  const singles = rows.filter((r) => !r.right);
  const maxL = Math.max(0, ...pairs.map((r) => r.left.length));
  const maxR = Math.max(0, ...pairs.map((r) => r.right!.length));
  const maxSingle = Math.max(0, ...singles.map((r) => r.left.length));
  const pairChars = pairs.length ? maxL + maxR + 3 : 0; // +3 = gap, pipe, gap
  const widest = Math.max(pairChars, maxSingle, 1);

  // One font size for all rows: capped by row height AND by available width
  const size = r2(Math.min(rowH * 0.8, avail / (widest * CHAR_W)));
  const cw = size * CHAR_W;
  const pipeX = textX + (maxL + 1) * cw;
  const rightX = textX + (maxL + 2) * cw;

  const top = (LABEL_H_MM - rows.length * rowH) / 2;
  rows.forEach((row, i) => {
    const y = top + i * rowH + rowH * 0.78;
    texts.push({ x: textX, y, size, text: row.left, anchor: 'start' });
    if (row.right) {
      texts.push({ x: pipeX, y, size, text: '|', anchor: 'middle' });
      texts.push({ x: rightX, y, size, text: row.right, anchor: 'start' });
    }
  });

  return { barsPath, texts, moduleMm };
}