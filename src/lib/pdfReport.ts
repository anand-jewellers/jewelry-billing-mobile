import { Platform } from 'react-native';
import * as Print from 'expo-print';
import type { ReportSummary } from './api/reports';
import { getCompanySettings } from './api/settings';
import { companyToShopDetails, ShopDetails } from './invoicePdf';

// A4 in CSS points — used by expo-print on iOS so the page size matches what
// Android/web show in their print dialogs.
const A4_WIDTH = 595;
const A4_HEIGHT = 842;

function inr(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// Escape user-entered text (customer names, product codes, shop details) so a
// stray "&" or "<" can never break the report layout.
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

function buildReportHtml(report: ReportSummary, shop: ShopDetails): string {
  const rows = report.invoices
    .map(
      (inv, idx) => `
      <tr class="${idx % 2 === 1 ? 'alt' : ''}">
        <td class="nowrap">${esc(inv.invoice_number)}</td>
        <td>${inv.product_codes.length ? inv.product_codes.map(esc).join(', ') : '—'}</td>
        <td>${esc(inv.customer_name)}</td>
        <td class="num">${inr(inv.grand_total)}</td>
        <td class="num">${inr(inv.paid_amount)}</td>
        <td class="nowrap">${esc(inv.payment_status)}</td>
        <td class="nowrap">${new Date(inv.invoice_date).toLocaleDateString('en-IN')}</td>
      </tr>`
    )
    .join('');

  const addressLine = shopAddressLine(shop);
  const contactLine = [shop.phone ? `Ph: ${esc(shop.phone)}` : '', esc(shop.email ?? ''), esc(shop.website ?? '')]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const regLine = [shop.gstin ? `GSTIN: ${esc(shop.gstin)}` : '', shop.pan ? `PAN: ${esc(shop.pan)}` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  // Check if the label is already showing the date range
  const formattedRange = `${report.range.fromDate} to ${report.range.toDate}`;
  const showDateRange = report.range.label !== formattedRange;

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${esc(shop.name)} — Sales Report</title>
      <style>
        /*
         * Page margins are handled INSIDE the document (see .topSpacer /
         * .bottomSpacer and the side padding on body) rather than with
         * @page margins. That is deliberate: Android's print engine, iOS and
         * desktop browsers all treat @page margins differently, but they all
         * repeat table headers/footers the same way, so spacing built from
         * those looks identical everywhere. "@page margin: 0" also stops
         * desktop browsers from stamping their own date/URL header and footer
         * onto the printout.
         */
        @page { size: A4; margin: 0; }

        * { box-sizing: border-box; font-family: -apple-system, Helvetica, Arial, sans-serif; }
        html, body { margin: 0; padding: 0; }
        body {
          padding: 0 12mm;
          color: #1a1a2e;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /*
         * The whole document is one outer table:
         *  - <thead> = company header, repeated at the top of EVERY page
         *  - <tfoot> = empty spacer, repeated at the bottom of every page so
         *    rows never run to the paper edge
         *  - <tbody> = summary cards + invoice table
         */
        table.page { width: 100%; border-collapse: collapse; }
        table.page > thead { display: table-header-group; }
        table.page > tfoot { display: table-footer-group; }
        table.page > thead > tr > td,
        table.page > tbody > tr > td,
        table.page > tfoot > tr > td { padding: 0; border: none; }

        .topSpacer { height: 10mm; }
        .bottomSpacer { height: 12mm; }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          border-bottom: 2px solid #1a2a5e;
          padding-bottom: 12px;
          margin-bottom: 14px;
          background: #fff;
        }
        .companyBlock { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
        .companyLogo { width: 52px; height: 52px; object-fit: contain; border-radius: 6px; flex-shrink: 0; }
        .company { font-size: 19px; font-weight: 700; color: #1a2a5e; }
        .companyDetail { font-size: 11px; color: #555; margin-top: 2px; line-height: 1.5; }
        .reportMeta { text-align: right; font-size: 12px; color: #555; flex-shrink: 0; }
        .reportMeta .title { font-size: 15px; font-weight: 700; color: #1a2a5e; margin-bottom: 2px; }

        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 18px;
          page-break-inside: avoid;
        }
        .summaryCard {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 14px;
        }
        .summaryCard .label { font-size: 11px; color: #888; text-transform: uppercase; }
        .summaryCard .value { font-size: 16px; font-weight: 700; margin-top: 4px; color: #1a2a5e; }

        table.data {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        table.data thead { display: table-header-group; }
        table.data tr { page-break-inside: avoid; break-inside: avoid; }
        table.data th {
          background: #f0f2f8;
          text-align: left;
          padding: 8px 6px;
          border: 1px solid #ccc;
          font-size: 11px;
          text-transform: uppercase;
          color: #444;
        }
        table.data td {
          padding: 7px 6px;
          border: 1px solid #eee;
          vertical-align: top;
          word-break: break-word;
        }
        table.data tr.alt { background: #fafbfd; }
        .num { text-align: right; white-space: nowrap; }
        .nowrap { white-space: nowrap; }

        .footer {
          margin-top: 16px;
          font-size: 10.5px;
          color: #999;
          text-align: center;
          border-top: 1px solid #eee;
          padding-top: 10px;
          page-break-inside: avoid;
        }
      </style>
    </head>
    <body>
      <table class="page">
        <thead>
          <tr>
            <td>
              <div class="topSpacer"></div>
              <div class="header">
                <div class="companyBlock">
                  ${shop.logoUrl ? `<img class="companyLogo" src="${esc(shop.logoUrl)}" />` : ''}
                  <div>
                    <div class="company">${esc(shop.name)}</div>
                    ${addressLine ? `<div class="companyDetail">${addressLine}</div>` : ''}
                    ${contactLine ? `<div class="companyDetail">${contactLine}</div>` : ''}
                    ${regLine ? `<div class="companyDetail">${regLine}</div>` : ''}
                  </div>
                </div>
                <div class="reportMeta">
                  <div class="title">Sales Report</div>
                  <div>${esc(report.range.label)}</div>${showDateRange ? `<div>${esc(formattedRange)}</div>` : ''}
                </div>
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="summaryGrid">
                <div class="summaryCard">
                  <div class="label">Total Sales</div>
                  <div class="value">${inr(report.totalSales)}</div>
                </div>
                <div class="summaryCard">
                  <div class="label">Invoices</div>
                  <div class="value">${report.totalInvoices}</div>
                </div>
              </div>

              <table class="data">
                <thead>
                  <tr>
                    <th>Invoice #</th><th>Product Code</th><th>Customer</th>
                    <th class="num">Total</th><th class="num">Paid</th>
                    <th>Status</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="7" style="text-align:center;color:#999">No invoices in this period</td></tr>'}
                </tbody>
              </table>

              <div class="footer">Generated on ${new Date().toLocaleString('en-IN')}</div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td><div class="bottomSpacer"></div></td>
          </tr>
        </tfoot>
      </table>
    </body>
  </html>`;
}

export async function downloadSalesReportPdf(report: ReportSummary, shop?: ShopDetails): Promise<void> {
  let resolvedShop = shop;
  if (!resolvedShop) {
    const companySettings = await getCompanySettings().catch(() => null);
    resolvedShop = companyToShopDetails(companySettings);
  }

  const html = buildReportHtml(report, resolvedShop);

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

    // Set onload BEFORE writing the document so the handler can't be missed,
    // and remove the iframe after printing finishes rather than on a timer.
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      win.onafterprint = () => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      };
      win.focus();
      win.print();
      // Fallback cleanup for browsers that don't fire afterprint.
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 60000);
    };

    doc.open();
    doc.write(html);
    doc.close();
    return;
  }

  await Print.printAsync({ html, width: A4_WIDTH, height: A4_HEIGHT });
}