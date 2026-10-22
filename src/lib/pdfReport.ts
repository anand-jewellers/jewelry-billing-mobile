// src\lib\pdfReport.ts

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing'; // run: npx expo install expo-sharing
import type { ReportRange, ReportSummary } from './api/reports';
import { getFullReport, type FullReport, type LineKind, type ReportLine } from './api/fullReport';
import { getCompanySettings } from './api/settings';
import { companyToShopDetails, ShopDetails } from './invoicePdf';

// A4 PORTRAIT in CSS points (must match what Android prints on)
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

// On phones: render the PDF to a file and open the share sheet (Save / WhatsApp / Print...).
// This is much more reliable than Print.printAsync for long reports on Android.
// Set to false to go back to the system print preview.
const USE_SHARE_SHEET = true;

// Test switch: set to false to print the report without the logo (makes the HTML much smaller).
const INCLUDE_LOGO = true;

// Android's PDF writer fails now and then ("error occurred while writing the PDF data"),
// usually on the 2nd run after the share sheet was used. Retry after a short pause.
async function createPdfFile(html: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { uri } = await withTimeout(
        Print.printToFileAsync({ html, width: PAGE_WIDTH, height: PAGE_HEIGHT }),
        60000,
        'The PDF is too large to create. Try a shorter date range.'
      );
      return uri;
    } catch (e: any) {
      lastErr = e;
      console.log(`[pdf] printToFile attempt ${attempt} failed:`, String(e?.message ?? e));
      if (String(e?.message ?? '').includes('too large')) throw e; // timeout: don't retry
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Helpers to make sure nothing can hang forever
// ---------------------------------------------------------------------------
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// Shop details rarely change: keep them for 10 minutes instead of fetching every time.
const SHOP_TTL_MS = 10 * 60 * 1000;
let shopCache: { shop: ShopDetails; at: number } | null = null;

async function loadShop(): Promise<ShopDetails> {
  if (shopCache && Date.now() - shopCache.at < SHOP_TTL_MS) return shopCache.shop;
  const settings = await withTimeout(getCompanySettings(), 8000, 'settings timeout').catch(() => null);
  const shop = companyToShopDetails(settings);
  // only cache when the settings really loaded
  if (settings) shopCache = { shop, at: Date.now() };
  return shop;
}

// Remote logo -> base64 data URI, so the print engine never waits on the network.
// Cached per URL. Any failure or timeout returns '' (PDF is printed without logo).
const logoCache = new Map<string, string>();

async function logoToDataUri(url?: string | null): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  const cached = logoCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const dataUri = await withTimeout(
      (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('logo fetch failed');
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('logo read failed'));
          reader.readAsDataURL(blob);
        });
      })(),
      4000,
      'logo timeout'
    );
    logoCache.set(url, dataUri);
    return dataUri;
  } catch {
    return ''; // don't cache failures, try again next time
  }
}

// ---------------------------------------------------------------------------
// HTML building
// ---------------------------------------------------------------------------
function inr(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shopAddressLine(shop: ShopDetails): string {
  return [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).map(esc).join(', ');
}

const SECTIONS: { kind: LineKind; title: string; color: string }[] = [
  { kind: 'inv', title: 'Invoices (INV)', color: '#1a2a5e' },
  { kind: 'rep', title: 'Repairs / Service (REP)', color: '#b45309' },
  { kind: 'ord', title: 'Customer Orders (ORD)', color: '#6d28d9' },
  { kind: 'cp', title: 'Cash Purchases - old gold / silver (CP)', color: '#b91c1c' },
];

const sumOf = (rows: ReportLine[], f: (l: ReportLine) => number) => rows.reduce((a, l) => a + f(l), 0);
const w3 = (n: number) => (n > 0 ? `${Number(n.toFixed(3))} g` : '');

// Column names, shown under every section title
const COLUMN_HEAD = `
    <tr class="colHead">
      <th>Metal</th><th>Bill No</th><th>Product Name</th><th class="num">WT</th>
      <th>LOC (Remarks)</th><th>Old Metal</th><th class="num">Old WT</th><th class="num">Paid Amount</th>
    </tr>`;

function lineRow(l: ReportLine): string {
  const paid =
    l.paid == null
      ? ''
      : l.flow === 'out'
        ? `<span class="out">- ${inr(l.paid)}</span>`
        : inr(l.paid);

  // bill number only
  const billCell = l.firstOfBill
    ? `<div class="bill">${esc(l.billNo)}</div>`
    : `<div class="small">${esc(l.billNo)}</div>`;

  return `
    <tr class="${l.firstOfBill ? 'first' : ''}">
      <td>${esc(l.metal)}</td>
      <td>${billCell}</td>
      <td>${esc(l.product) || '—'}</td>
      <td class="num">${esc(l.weight)}</td>
      <td>${esc(l.loc)}</td>
      <td>${esc(l.oldMetal)}</td>
      <td class="num">${esc(l.oldWeight)}</td>
      <td class="num strong">${paid}</td>
    </tr>`;
}

function sectionHtml(report: FullReport, s: (typeof SECTIONS)[number]): string {
  const rows = report.lines.filter((l) => l.kind === s.kind);
  if (!rows.length) return '';

  const sum = sumOf(rows, (l) => l.paid ?? 0);
  const wt = sumOf(rows, (l) => l.weightNum);
  const oldWt = sumOf(rows, (l) => l.oldWeightNum);
  const label = s.kind === 'cp' ? 'Total paid out' : 'Total received';

  return `
    <tr class="sectionRow"><td colspan="8" style="background:${s.color}">${esc(s.title)}</td></tr>
    ${COLUMN_HEAD}
    ${rows.map(lineRow).join('')}
    <tr class="subtotal">
      <td colspan="3" class="num">${label}</td>
      <td class="num">${w3(wt)}</td>
      <td></td>
      <td></td>
      <td class="num">${w3(oldWt)}</td>
      <td class="num">${s.kind === 'cp' ? `<span class="out">- ${inr(sum)}</span>` : inr(sum)}</td>
    </tr>`;
}

// logoSrc: already a data URI (or '' for no logo)
function buildReportHtml(report: FullReport, shop: ShopDetails, logoSrc: string): string {
  const t = report.totals;
  const addressLine = shopAddressLine(shop);
  const contactLine = [shop.phone ? `Ph: ${esc(shop.phone)}` : '', esc(shop.email ?? ''), esc(shop.website ?? '')]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const regLine = [shop.gstin ? `GSTIN: ${esc(shop.gstin)}` : '', shop.pan ? `PAN: ${esc(shop.pan)}` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const formattedRange = `${report.range.fromDate} to ${report.range.toDate}`;
  const showDateRange = report.range.label !== formattedRange;

  // A blank gap row between the bill sections (INV / REP / ORD / CP)
  const gapRow = `<tr class="gapRow"><td colspan="8"></td></tr>`;
  const body = SECTIONS.map((s) => sectionHtml(report, s))
    .filter(Boolean)
    .join(gapRow);

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${esc(shop.name)} — Full Report</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; font-family: -apple-system, Helvetica, Arial, sans-serif; }
        html, body { margin: 0; padding: 0; }
        body { padding: 0 7mm; color: #1a1a2e; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

        .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
          border-bottom: 2px solid #1a2a5e; padding-bottom: 10px; margin-bottom: 10px; padding-top: 8mm; background: #fff; }
        .companyBlock { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
        .companyLogo { width: 48px; height: 48px; object-fit: contain; border-radius: 6px; flex-shrink: 0; }
        .company { font-size: 18px; font-weight: 700; color: #1a2a5e; }
        .companyDetail { font-size: 10.5px; color: #555; margin-top: 2px; line-height: 1.5; }
        .reportMeta { text-align: right; font-size: 11.5px; color: #555; flex-shrink: 0; }
        .reportMeta .title { font-size: 15px; font-weight: 700; color: #1a2a5e; margin-bottom: 2px; }

        /* ONE flat table: company header repeats on every page, count cards show on page 1 only */
        table.data { width: 100%; border-collapse: collapse; font-size: 9px; table-layout: fixed; }
        table.data thead { display: table-header-group; }
        table.data tfoot { display: table-footer-group; }
        table.data tr { page-break-inside: avoid; break-inside: avoid; }
        table.data th { background: #f0f2f8; text-align: left; padding: 5px 3px; border: 1px solid #ccc;
          font-size: 8px; text-transform: uppercase; color: #444; }
        table.data td { padding: 4px 3px; border: 1px solid #eee; vertical-align: top; word-break: break-word; }
        table.data tr.first td { border-top: 1px solid #cfd4e2; }
        table.data tr.headRow td,
        table.data tr.spacerRow td,
        table.data tr.countsRow td,
        table.data tr.gapRow td { border: none; padding: 0; }
        table.data tr.countsRow td { padding: 0 0 8px 0; }
        .cards { display: flex; gap: 6px; }
        .card { flex: 1; border-radius: 6px; padding: 5px 8px; color: #fff; }
        .card .cl { font-size: 8px; text-transform: uppercase; letter-spacing: .3px; }
        .card .cv { font-size: 14px; font-weight: 700; margin-top: 1px; }
        table.data tr.gapRow td { height: 18px; }
        .pageBottom { height: 10mm; }
        col.cMetal { width: 9%; } col.cBill { width: 18%; } col.cProd { width: 19%; } col.cWt { width: 8%; }
        col.cLoc { width: 17%; } col.cOld { width: 10%; } col.cOldWt { width: 8%; } col.cPaid { width: 11%; }

        tr.sectionRow td { color: #fff; font-weight: 700; font-size: 10px; padding: 5px 6px; border: none; }
        tr.sectionRow, tr.colHead { break-after: avoid; page-break-after: avoid; }
        tr.subtotal td { background: #f6f7fb; font-weight: 700; border-top: 2px solid #ccc; }
        .bill { font-weight: 700; color: #1a2a5e; }
        .small { font-size: 8px; color: #777; margin-top: 1px; }
        .num { text-align: right; }
        .strong { font-weight: 700; }
        .out { color: #b91c1c; }

        .footer { margin-top: 14px; font-size: 10px; color: #999; text-align: center;
          border-top: 1px solid #eee; padding-top: 8px; }
      </style>
    </head>
    <body>
      <table class="data">
        <colgroup>
          <col class="cMetal" /><col class="cBill" /><col class="cProd" /><col class="cWt" />
          <col class="cLoc" /><col class="cOld" /><col class="cOldWt" /><col class="cPaid" />
        </colgroup>
        <thead>
          <tr class="headRow"><td colspan="8">
            <div class="header">
              <div class="companyBlock">
                ${logoSrc ? `<img class="companyLogo" src="${logoSrc}" />` : ''}
                <div>
                  <div class="company">${esc(shop.name)}</div>
                  ${addressLine ? `<div class="companyDetail">${addressLine}</div>` : ''}
                  ${contactLine ? `<div class="companyDetail">${contactLine}</div>` : ''}
                  ${regLine ? `<div class="companyDetail">${regLine}</div>` : ''}
                </div>
              </div>
              <div class="reportMeta">
                <div class="title">Full Report</div>
                <div>${esc(report.range.label)}</div>${showDateRange ? `<div>${esc(formattedRange)}</div>` : ''}
              </div>
            </div>
          </td></tr>
        </thead>
        <tfoot>
          <tr class="spacerRow"><td colspan="8"><div class="pageBottom"></div></td></tr>
        </tfoot>
        <tbody>
          <tr class="countsRow"><td colspan="8">
            <div class="cards">
              <div class="card" style="background:#1a2a5e"><div class="cl">Invoices</div><div class="cv">${t.invoiceCount}</div></div>
              <div class="card" style="background:#b45309"><div class="cl">Repairs</div><div class="cv">${t.repairCount}</div></div>
              <div class="card" style="background:#6d28d9"><div class="cl">Orders</div><div class="cv">${t.orderCount}</div></div>
              <div class="card" style="background:#b91c1c"><div class="cl">Cash purchases</div><div class="cv">${t.purchaseCount}</div></div>
            </div>
          </td></tr>
          ${body || '<tr><td colspan="8" style="text-align:center;color:#999">No entries in this period</td></tr>'}
        </tbody>
      </table>

      <div class="footer">Generated on ${new Date().toLocaleString('en-IN')}</div>
    </body>
  </html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function downloadSalesReportPdf(
  input: ReportSummary | ReportRange,
  shop?: ShopDetails
): Promise<void> {
  const isSummary = 'range' in input;
  const range: ReportRange = isSummary ? (input as ReportSummary).range : (input as ReportRange);

  // Timing log: shows exactly which step is slow (look for "[pdf]" in the Metro console)
  const t0 = Date.now();
  const lap = (label: string) => console.log(`[pdf] ${label}: ${Date.now() - t0} ms`);

  // Everything starts at the same time:
  //   shop settings (cached)  ->  logo (starts as soon as shop is known)
  //   report data             (reuses the dashboard's sales report when given)
  const shopPromise: Promise<ShopDetails> = (shop ? Promise.resolve(shop) : loadShop()).then((s) => {
    lap('shop ready');
    return s;
  });
  const logoPromise = shopPromise.then((s) => (INCLUDE_LOGO ? logoToDataUri(s.logoUrl) : '')).then((l) => {
    lap(`logo ready (${l ? 'yes' : 'none'})`);
    return l;
  });
  const reportPromise = withTimeout(
    getFullReport(range, isSummary ? (input as ReportSummary) : undefined),
    45000,
    'Report took too long. Check your internet and try again.'
  ).then((r) => {
    lap(`data ready (${r.lines.length} rows)`);
    return r;
  });

  const [resolvedShop, report, logoSrc] = await Promise.all([shopPromise, reportPromise, logoPromise]);

  const html = buildReportHtml(report, resolvedShop, logoSrc);
  lap(`html built (${Math.round(html.length / 1024)} KB)`);

  if (Platform.OS === 'web') {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      throw new Error('Could not prepare the PDF for printing.');
    }

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      win.onafterprint = () => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      };
      win.focus();
      win.print();
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 60000);
    };

    doc.open();
    doc.write(html);
    doc.close();
    return;
  }

  if (USE_SHARE_SHEET) {
    // Render to a PDF file (with a hard time limit so the button can never stay stuck)
    const uri = await createPdfFile(html);
    lap('pdf file created');

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Full Report',
      });
    } else {
      throw new Error('Sharing is not available on this device.');
    }
    lap('share sheet closed');
    return;
  }

  await Print.printAsync({ html, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  lap('print finished');
}