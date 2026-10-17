// src/lib/repairReceipt.ts
//
// Builds the simple repair / service receipt (HTML) used for both
// printing and sharing. Same HTML feeds Print.printAsync (print) and
// createThermalPdfFile / createInvoicePdfBlobWeb (share as PDF).

export interface RepairReceiptData {
  receiptNo: string;
  dateText: string;      // already formatted for display, e.g. "14 Oct 2026, 04:30 PM"
  customerName: string;
  phone: string;
  item: string;          // "For Repair" - what is being repaired
  weight: number | null; // grams, optional
  charge: number;
  advance: number;
  remarks: string;
  finalPaid?: number;            // balance collected on delivery
  deliveredText?: string | null; // set once the jewel is handed over
}

export interface RepairShopInfo {
  name: string;
  address: string | null;
  phone?: string | null;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/** REP-YYYYMMDD-HHMMSS (local time). Unique enough for a hand-over slip. */
export function generateRepairReceiptNo(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `REP-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

export function formatReceiptDate(d: Date = new Date()): string {
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * expo-print cannot measure content height, so the thermal PDF needs an
 * estimate. Grows a little with long item / remark text.
 */
export function estimateRepairReceiptHeightPt(data: RepairReceiptData): number {
  const extraLines =
    Math.ceil((data.item.length || 0) / 28) + Math.ceil((data.remarks.length || 0) / 32);
  return 470 + extraLines * 14;
}

export function buildRepairReceiptHtml(data: RepairReceiptData, shop: RepairShopInfo): string {
  const balance = Math.max(0, data.charge - data.advance - (data.finalPaid ?? 0));

  const row = (label: string, value: string, bold = false) => `
    <tr>
      <td class="k">${label}</td>
      <td class="v${bold ? ' b' : ''}">${value}</td>
    </tr>`;

  const shopLines = [
    shop.address ? `<div class="sub">${escapeHtml(shop.address)}</div>` : '',
    shop.phone ? `<div class="sub">Ph: ${escapeHtml(shop.phone)}</div>` : '',
  ].join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; }
  .slip { max-width: 300px; margin: 0 auto; padding: 14px 12px 18px; box-sizing: border-box; }
  .center { text-align: center; }
  .shop { font-size: 17px; font-weight: 800; }
  .sub { font-size: 11px; color: #444; margin-top: 2px; }
  .title { margin: 10px 0 2px; font-size: 13px; font-weight: 700; letter-spacing: .4px; }
  .rule { border: 0; border-top: 1px dashed #777; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; font-size: 12px; vertical-align: top; }
  td.k { width: 38%; color: #555; }
  td.v { text-align: right; word-break: break-word; }
  td.b { font-weight: 700; }
  .total td { font-size: 14px; font-weight: 800; padding-top: 5px; }
  .remarks { font-size: 12px; margin-top: 2px; word-break: break-word; }
  .label { font-size: 11px; color: #555; }
  .foot { font-size: 11px; color: #444; margin-top: 10px; }
</style>
</head>
<body>
  <div class="slip">
    <div class="center">
      <div class="shop">${escapeHtml(shop.name)}</div>
      ${shopLines}
      <div class="title">REPAIR / SERVICE RECEIPT</div>
    </div>

    <hr class="rule" />

    <table>
      ${row('Receipt No', escapeHtml(data.receiptNo), true)}
      ${row('Date', escapeHtml(data.dateText))}
      ${data.deliveredText ? row('Delivered', escapeHtml(data.deliveredText), true) : ''}
      ${row('Name', escapeHtml(data.customerName), true)}
      ${data.phone ? row('Phone', escapeHtml(data.phone)) : ''}
    </table>

    <hr class="rule" />

    <table>
      ${row('For Repair', escapeHtml(data.item), true)}
      ${data.weight != null && data.weight > 0 ? row('Weight', `${data.weight.toFixed(3)} g`) : ''}
    </table>

    <hr class="rule" />

    <table>
      ${row('Repair Charge', money(data.charge))}
      ${row('Advance Paid', money(data.advance))}
      ${data.finalPaid ? row('Paid on Delivery', money(data.finalPaid)) : ''}
      <tr class="total">
        <td class="k" style="color:#111">Balance Due</td>
        <td class="v">${money(balance)}</td>
      </tr>
    </table>

    ${
      data.remarks
        ? `<hr class="rule" />
           <div class="label">Remarks</div>
           <div class="remarks">${escapeHtml(data.remarks)}</div>`
        : ''
    }

    <hr class="rule" />
    <div class="center foot">
      ${data.deliveredText ? 'Thank You Visit again!' : 'Please bring this receipt when collecting your item.'}<br/>
      Thank you! 🙏
    </div>
  </div>
</body>
</html>`;
}