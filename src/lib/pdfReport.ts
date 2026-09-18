import { Platform } from 'react-native';
import * as Print from 'expo-print';
import type { ReportSummary } from './api/reports';
import { getCompanySettings } from './api/settings';
import { companyToShopDetails, ShopDetails } from './invoicePdf';

function inr(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function shopAddressLine(shop: ShopDetails): string {
  return [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
}

function buildReportHtml(report: ReportSummary, shop: ShopDetails): string {
  const rows = report.invoices
    .map(
      (inv, idx) => `
      <tr class="${idx % 2 === 1 ? 'alt' : ''}">
        <td>${inv.invoice_number}</td>
        <td>${inv.product_codes.length ? inv.product_codes.join(', ') : '—'}</td>
        <td>${inv.customer_name}</td>
        <td class="num">${inr(inv.grand_total)}</td>
        <td class="num">${inr(inv.paid_amount)}</td>
        <td>${inv.payment_status}</td>
        <td>${new Date(inv.invoice_date).toLocaleDateString('en-IN')}</td>
      </tr>`
    )
    .join('');

  const addressLine = shopAddressLine(shop);
  const contactLine = [shop.phone ? `Ph: ${shop.phone}` : '', shop.email ?? '', shop.website ?? '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const regLine = [shop.gstin ? `GSTIN: ${shop.gstin}` : '', shop.pan ? `PAN: ${shop.pan}` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  // Check if the label is already showing the date range
  const formattedRange = `${report.range.fromDate} to ${report.range.toDate}`;
  const showDateRange = report.range.label !== formattedRange;

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${shop.name} — Sales Report</title>
      <style>
        * { box-sizing: border-box; font-family: -apple-system, Helvetica, Arial, sans-serif; }
        body { padding: 24px; color: #1a1a2e; }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #1a2a5e;
          padding-bottom: 16px;
          margin-bottom: 20px;
        }
        .companyBlock { display: flex; align-items: flex-start; gap: 12px; }
        .companyLogo { width: 52px; height: 52px; object-fit: contain; border-radius: 6px; }
        .company { font-size: 19px; font-weight: 700; color: #1a2a5e; }
        .companyDetail { font-size: 11px; color: #555; margin-top: 2px; line-height: 1.5; }
        .reportMeta { text-align: right; font-size: 12px; color: #555; }
        .reportMeta .title { font-size: 15px; font-weight: 700; color: #1a2a5e; margin-bottom: 2px; }

        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        .summaryCard {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 14px;
        }
        .summaryCard .label { font-size: 11px; color: #888; text-transform: uppercase; }
        .summaryCard .value { font-size: 16px; font-weight: 700; margin-top: 4px; color: #1a2a5e; }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        th {
          background: #f0f2f8;
          text-align: left;
          padding: 8px 6px;
          border: 1px solid #ccc;
          font-size: 11px;
          text-transform: uppercase;
          color: #444;
        }
        td {
          padding: 7px 6px;
          border: 1px solid #eee;
          vertical-align: top;
        }
        tr.alt { background: #fafbfd; }
        .num { text-align: right; white-space: nowrap; }

        .footer {
          margin-top: 20px;
          font-size: 10.5px;
          color: #999;
          text-align: center;
          border-top: 1px solid #eee;
          padding-top: 12px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="companyBlock">
          ${shop.logoUrl ? `<img class="companyLogo" src="${shop.logoUrl}" />` : ''}
          <div>
            <div class="company">${shop.name}</div>
            ${addressLine ? `<div class="companyDetail">${addressLine}</div>` : ''}
            ${contactLine ? `<div class="companyDetail">${contactLine}</div>` : ''}
            ${regLine ? `<div class="companyDetail">${regLine}</div>` : ''}
          </div>
        </div>
        <div class="reportMeta">
  <div class="title">Sales Report</div>
  <div>${report.range.label}</div>${showDateRange ? `<div>${formattedRange}</div>` : ''}
</div>
      </div>

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

      <table>
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

    doc.open();
    doc.write(html);
    doc.close();

    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    };
    return;
  }

  await Print.printAsync({ html });
}