// src/lib/estimateSlip.ts
//
// Builds the "ROUGH ESTIMATE" slip that is shared on WhatsApp as a narrow PDF.
// It is its own small layout, so it does NOT use buildThermalReceiptHtml:
//  - header: shop name + "ROUGH ESTIMATE" only (no address / email / GSTIN)
//  - no footer
//  - the page height is calculated from the lines, so there is no big blank
//    area at the bottom.

export type SlipLine =
  | { type: 'heading'; text: string }
  | { type: 'row'; label: string; value: string; bold?: boolean }
  | { type: 'divider'; thin?: boolean };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Layout numbers (CSS px). Keep these in sync with the CSS below.
const LINE = 16; // normal line height
const LABEL_CHARS = 15; // characters that fit in the label column
const VALUE_CHARS = 14; // characters that fit in the value column
const FULL_CHARS = 30; // characters that fit on a full line
const SLACK = 16; // extra space at the bottom (lower it if you see blank space)
const SIDE_MARGIN = 16; // left and right space in px (increase for wider margins)
const PX_TO_PT = 0.75; // PDF page size is in points

export function buildEstimateSlip(
  lines: SlipLine[],
  opts: { shopName?: string | null; title?: string } = {}
): { html: string; heightPt: number } {
  const title = opts.title ?? 'ROUGH ESTIMATE';
  const shop = opts.shopName?.trim();

  let height = 12; // top + bottom body padding
  const parts: string[] = [];

  if (shop) {
    parts.push(`<div class="shop">${esc(shop.toUpperCase())}</div>`);
    height += 22 * Math.max(1, Math.ceil(shop.length / 22));
  }

  parts.push(`<div class="title">${esc(title)}</div>`);
  height += 4 + 6 + 6 + 17 + 2; // margins + padding + text + borders

  for (const l of lines) {
    if (l.type === 'divider') {
      parts.push(l.thin ? '<div class="thin"></div>' : '<div class="div"></div>');
      height += l.thin ? 9 : 11;
    } else if (l.type === 'heading') {
      parts.push(`<div class="heading">${esc(l.text)}</div>`);
      height += 6 + LINE * Math.max(1, Math.ceil(l.text.length / FULL_CHARS));
    } else {
      parts.push(
        `<div class="row${l.bold ? ' b' : ''}"><div class="l">${esc(l.label)}</div>` +
          `<div class="c">:</div><div class="v">${esc(l.value)}</div></div>`
      );
      const n = Math.max(
        1,
        Math.ceil(l.label.length / LABEL_CHARS),
        Math.ceil(l.value.length / VALUE_CHARS)
      );
      height += LINE * n;
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 11px; line-height: ${LINE}px; color: #000; }
  .wrap { box-sizing: border-box; padding: 6px ${SIDE_MARGIN}px; }
  .shop { text-align: center; font-weight: bold; font-size: 15px; line-height: 22px; }
  .title { text-align: center; font-weight: bold; font-size: 13px; line-height: 17px; letter-spacing: 1px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 0; margin: 4px 0 6px; }
  .heading { font-weight: bold; margin-top: 6px; }
  .row { display: flex; }
  .l { width: 50%; }
  .c { width: 10px; text-align: center; }
  .v { flex: 1; }
  .b { font-weight: bold; }
  .div { border-top: 1px dashed #000; margin: 5px 0; }
  .thin { border-top: 1px dashed #000; margin: 4px 0 4px 50%; }
</style>
</head>
<body>
<div class="wrap">
${parts.join('\n')}
</div>
</body>
</html>`;

  // Page size is in points, the layout above is in CSS px (1 px = 0.75 pt).
  return { html, heightPt: Math.ceil((height + SLACK) * PX_TO_PT) };
}