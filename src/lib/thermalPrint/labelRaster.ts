// src/lib/thermalPrint/labelRaster.ts
//
// LabelData -> 1-bit TSPL bitmap for the whole 100 x 15 mm label.
//  - BARCODE: drawn straight into the 1-bit buffer in whole printer dots.
//  - TEXT:    drawn by <LabelRasterHost /> (1 SVG unit = 1 printer dot),
//             captured as PNG and thresholded.

import { Buffer } from 'buffer';
// @ts-ignore: upng-js ships no types
import UPNG from 'upng-js';
import { LabelData, LABEL_W_MM, LABEL_H_MM, buildLabelLayout } from '../labelLayout';

// ---- PRINTER RESOLUTION: the single most important setting ----
// 203 -> 8 dots/mm      300 -> 11.81 dots/mm
export const PRINTER_DPI = 300;
export const DPMM = PRINTER_DPI / 25.4;

export const W_DOTS = Math.round(LABEL_W_MM * DPMM);            // 1181 @300dpi
export const H_DOTS = Math.round(LABEL_H_MM * DPMM);            // 177  @300dpi
export const ROW_BYTES = Math.ceil(W_DOTS / 8);                 // bytes per bitmap row

const THRESHOLD = 170;   // higher = bolder text
const INVERT = false;    // true if the print comes out as a negative

// Shift the whole label. +X = right, +Y = down. Values in mm.
export const SHIFT_X_MM = -1;   // moves content left so the right column isn't clipped
export const SHIFT_Y_MM = 1;    // whole-label shift down (limited automatically so nothing is clipped)

// Moves the TOP of the barcode down without moving its bottom edge.
// Larger = shorter bars, further from the top edge.
const BAR_TOP_TRIM_MM = 2;
const BAR_MIN_HEIGHT_MM = 6;    // never leave bars shorter than this

function shiftMono(src: Buffer, dxDots: number, dyDots: number): Buffer {
  if (!dxDots && !dyDots) return src;
  const out = Buffer.alloc(src.length, 0xff);          // all white
  for (let y = 0; y < H_DOTS; y++) {
    const sy = y - dyDots;
    if (sy < 0 || sy >= H_DOTS) continue;
    for (let x = 0; x < W_DOTS; x++) {
      const sx = x - dxDots;
      if (sx < 0 || sx >= W_DOTS) continue;
      const black = (src[sy * ROW_BYTES + (sx >> 3)] & (0x80 >> (sx & 7))) === 0;
      if (black) out[y * ROW_BYTES + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return out;
}

/** Index of the lowest row that contains any black dot, or -1 if blank. */
function lastDarkRow(buf: Buffer): number {
  for (let y = H_DOTS - 1; y >= 0; y--) {
    const start = y * ROW_BYTES;
    for (let b = 0; b < ROW_BYTES; b++) {
      if (buf[start + b] !== 0xff) return y;
    }
  }
  return -1;
}

// Registered by <LabelRasterHost />. Returns a base64 PNG of the TEXT layer.
export const rasterHost: { render: ((l: LabelData) => Promise<string>) | null } = {
  render: null,
};

/** Base64 PNG (text layer) -> 1-bit TSPL rows. TSPL: bit 1 = white, 0 = black. */
export function pngBase64ToMono(b64: string): Buffer {
  const clean = b64.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(clean, 'base64');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const img = UPNG.decode(ab);
  const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);

  if (img.width !== W_DOTS || img.height !== H_DOTS) {
    console.warn(`[labelRaster] capture is ${img.width}x${img.height}, expected ${W_DOTS}x${H_DOTS}`);
  }

  const out = Buffer.alloc(ROW_BYTES * H_DOTS, 0xff);

  for (let y = 0; y < H_DOTS; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / H_DOTS));
    for (let x = 0; x < W_DOTS; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / W_DOTS));
      const i = (sy * img.width + sx) * 4;
      const a = rgba[i + 3];
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      let dark = a > 128 && lum < THRESHOLD;
      if (INVERT) dark = !dark;
      if (dark) out[y * ROW_BYTES + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return out;
}

type Bars = { pattern: string; xMm: number; topMm: number; heightMm: number; moduleMm: number };

/** Paint the CODE128 bars directly into the mono buffer. */
function drawBars(out: Buffer, bars: Bars) {
  const { pattern, xMm, topMm, heightMm, moduleMm } = bars;

  // Bottom edge stays where the layout put it; only the top moves down.
  const y1 = Math.min(H_DOTS, Math.round((topMm + heightMm) * DPMM));
  const y0 = Math.max(
    0,
    Math.min(
      y1 - Math.round(BAR_MIN_HEIGHT_MM * DPMM),
      Math.round((topMm + BAR_TOP_TRIM_MM) * DPMM),
    ),
  );

  // If a module is (almost) a whole number of dots, use that exact width so
  // every bar is identical (0.25 mm -> 3 dots @300dpi).
  const exact = moduleMm * DPMM;
  const modDots = Math.round(exact);
  const whole = Math.abs(exact - modDots) < 0.2 && modDots >= 1;
  const x0 = Math.round(xMm * DPMM);

  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] !== '1') { i++; continue; }
    let j = i;
    while (j < pattern.length && pattern[j] === '1') j++;

    const xa = whole ? x0 + i * modDots : Math.round((xMm + i * moduleMm) * DPMM);
    const xb = whole ? x0 + j * modDots : Math.round((xMm + j * moduleMm) * DPMM);

    for (let x = xa; x < xb && x < W_DOTS; x++) {
      if (x < 0) continue;
      const mask = ~(0x80 >> (x & 7));
      for (let y = y0; y < y1; y++) out[y * ROW_BYTES + (x >> 3)] &= mask;
    }
    i = j;
  }
}

export async function rasterizeLabel(label: LabelData): Promise<Buffer> {
  if (!rasterHost.render) {
    throw new Error('Label renderer is not mounted. Add <LabelRasterHost /> to the root layout.');
  }
  const layout = buildLabelLayout(label);
  if (label.barcode && (layout as any).bars === undefined) {
    throw new Error('labelLayout.ts is outdated: buildLabelLayout() must return `bars`. Use the updated labelLayout.ts.');
  }

  const textB64 = await rasterHost.render(label);
  const mono = pngBase64ToMono(textB64);
  if (layout.bars) drawBars(mono, layout.bars);

  // Never shift further down than the free space below the content,
  // so the purity line can't be clipped.
  const wantDy = Math.round(SHIFT_Y_MM * DPMM);
  const bottom = lastDarkRow(mono);
  const maxDy = bottom < 0 ? wantDy : H_DOTS - 1 - bottom;
  const dy = Math.min(wantDy, maxDy);
  if (dy < wantDy) {
    console.warn(
      `[labelRaster] Y shift limited to ${(dy / DPMM).toFixed(2)} mm (wanted ${SHIFT_Y_MM} mm); ` +
      `content would be clipped. Compact the layout instead.`
    );
  }

  return shiftMono(mono, Math.round(SHIFT_X_MM * DPMM), dy);
}