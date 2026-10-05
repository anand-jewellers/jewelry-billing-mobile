// src/lib/barcodeLabelHtml.ts
// Print HTML: one 100mm x 15mm label per page, drawn from the shared layout.
import { LabelData, buildLabelLayout, LABEL_W_MM, LABEL_H_MM } from './labelLayout';

export type { LabelData };

// How many CSS px the print engine uses per mm. Standard CSS = 96 / 25.4 = 3.78.
// CALIBRATE with a ruler: print on plain paper, measure the full label width in mm (M),
// then set  PRINT_PX_PER_MM = (current value) * 100 / M
const PRINT_PX_PER_MM = 96 / 25.4;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function labelSvgMarkup(l: LabelData): string {
  const { barsPath, texts } = buildLabelLayout(l);
  const w = (LABEL_W_MM * PRINT_PX_PER_MM).toFixed(2);
  const h = (LABEL_H_MM * PRINT_PX_PER_MM).toFixed(2);
  const textEls = texts
    .map(
      (t) =>
        `<text x="${t.x.toFixed(3)}" y="${t.y.toFixed(3)}" font-size="${t.size}" text-anchor="${t.anchor}">${esc(t.text)}</text>`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${LABEL_W_MM} ${LABEL_H_MM}">
    <path d="${barsPath}" fill="#000" shape-rendering="crispEdges"/>
    <g font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#000">${textEls}</g>
  </svg>`;
}

/** One label per page — each page is one sticker on the roll. */
export function buildLabelsHtml(labels: LabelData[]): string {
  const w = (LABEL_W_MM * PRINT_PX_PER_MM).toFixed(2);
  const h = (LABEL_H_MM * PRINT_PX_PER_MM).toFixed(2);
  const pages = labels
    .map(
      (l, i) =>
        `<div class="label"${i < labels.length - 1 ? ' style="page-break-after: always;"' : ''}>${labelSvgMarkup(l)}</div>`
    )
    .join('');
  return `<html>
    <head>
      <style>
        @page { size: ${w}px ${h}px; margin: 0; }
        html, body { margin: 0; padding: 0; }
        .label { width: ${w}px; height: ${h}px; overflow: hidden; }
        .label svg { display: block; }
      </style>
    </head>
    <body>${pages}</body>
  </html>`;
}