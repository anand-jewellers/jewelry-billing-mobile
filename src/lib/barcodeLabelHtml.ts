// src/lib/barcodeLabelHtml.ts
import { LabelData, buildLabelLayout, LABEL_W_MM, LABEL_H_MM } from './labelLayout';

export type { LabelData };

// Nudge the whole drawing if the printer feeds slightly off (mm).
// Positive Y moves the print DOWN, positive X moves it RIGHT.
const OFFSET_X_MM = 0;
const OFFSET_Y_MM = 0;

// Keep the box a hair smaller than the page so rounding can never overflow to a new page.
const SAFE_H_MM = LABEL_H_MM - 0.2;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function labelSvgMarkup(l: LabelData): string {
  const { barsPath, texts } = buildLabelLayout(l);
  const textEls = texts
    .map(
      (t) =>
        `<text x="${t.x.toFixed(3)}" y="${t.y.toFixed(3)}" font-size="${t.size}" text-anchor="${t.anchor}">${esc(t.text)}</text>`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_W_MM}mm" height="${SAFE_H_MM}mm" viewBox="${-OFFSET_X_MM} ${-OFFSET_Y_MM} ${LABEL_W_MM} ${SAFE_H_MM}" preserveAspectRatio="xMinYMin meet">
    <path d="${barsPath}" fill="#000" shape-rendering="crispEdges"/>
    <g font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#000">${textEls}</g>
  </svg>`;
}

export function buildLabelsHtml(labels: LabelData[]): string {
  const pages = labels
    .map(
      (l, i) =>
        `<div class="label${i < labels.length - 1 ? ' brk' : ''}">${labelSvgMarkup(l)}</div>`
    )
    .join('');
  return `<html>
    <head>
      <meta name="viewport" content="width=${LABEL_W_MM}mm, initial-scale=1.0" />
      <style>
        @page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${LABEL_W_MM}mm; }
        .label { width: ${LABEL_W_MM}mm; height: ${SAFE_H_MM}mm; overflow: hidden; page-break-inside: avoid; break-inside: avoid; }
        .brk { page-break-after: always; break-after: page; }
        .label svg { display: block; }
      </style>
    </head>
    <body>${pages}</body>
  </html>`;
}