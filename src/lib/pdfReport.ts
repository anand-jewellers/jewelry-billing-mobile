import * as Print from 'expo-print';
import { Platform } from 'react-native';
import type { ReportSummary } from './api/reports';

function inr(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function buildReportHtml(report: ReportSummary, companyName: string): string {
  const rows = report.invoices
    .map(
      (inv) => `
      <tr>
        <td>${inv.invoice_number}</td>
        <td>${inv.invoice_date}</td>
        <td>${inv.customer_name}</td>
        <td style="text-align:right">${inr(inv.grand_total)}</td>
        <td style="text-align:right">${inr(inv.paid_amount)}</td>
        <td style="text-align:right">${inr(inv.balance_amount)}</td>
        <td>${inv.payment_status}</td>
      </tr>`
    )
    .join('');

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #1a1a1a; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 20px; }
        .summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
        .summary div { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; min-width: 130px; }
        .summary .label { font-size: 11px; color: #888; }
        .summary .value { font-size: 15px; font-weight: 700; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; }
      </style>
    </head>
    <body>
      <h1>${companyName} — Sales Report</h1>
      <div class="sub">${report.range.label} (${report.range.fromDate} to ${report.range.toDate})</div>
      <div class="summary">
        <div><div class="label">Total Sales</div><div class="value">${inr(report.totalSales)}</div></div>
        <div><div class="label">Invoices</div><div class="value">${report.totalInvoices}</div></div>
        <div><div class="label">Collected</div><div class="value">${inr(report.totalCollected)}</div></div>
        <div><div class="label">Pending</div><div class="value">${inr(report.totalPending)}</div></div>
      </div>
      <table>
        <thead>
          <tr><th>Invoice #</th><th>Date</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#999">No invoices in this period</td></tr>'}</tbody>
      </table>
    </body>
  </html>`;
}

export async function downloadSalesReportPdf(report: ReportSummary, companyName = 'My Store'): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('PDF download is not supported on web in this build. Please use the mobile app.');
  }

  const html = buildReportHtml(report, companyName);

  // Opens the native print/preview sheet. The user can "Save as PDF" or
  // "Save to Files" / "Print" directly from there — this avoids the
  // Sharing.shareAsync file-provider restriction that Expo Go enforces.
  await Print.printAsync({ html });
}