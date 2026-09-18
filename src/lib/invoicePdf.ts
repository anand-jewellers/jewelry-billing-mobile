import type { InvoiceDetail } from '../types/invoices';
import type { CompanySettings, InvoiceSettings } from '../types/settings';
import { getInvoiceById } from './api/invoices';
import { getCompanySettings, getInvoiceSettings } from './api/settings';

function money(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyCompact(n: number): string {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Appends "(x%)" to a tax label, derived from amount / base. Returns ''
// when there's nothing meaningful to show (zero base or zero amount).
function formatRate(amount: number, base: number): string {
  if (!base || amount <= 0) return '';
  const rate = (amount / base) * 100;
  return ` (${rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(1)}%)`;
}

// ===========================================================
// Shop details — derived from CompanySettings, used by both templates
// ===========================================================

export interface ShopDetails {
  name: string;
  logoUrl?: string | null;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  website?: string;
}

const DEFAULT_SHOP: ShopDetails = {
  name: 'BizJewel Pvt Ltd',
};

export function companyToShopDetails(settings: CompanySettings | null | undefined): ShopDetails {
  if (!settings) return DEFAULT_SHOP;
  return {
    name: settings.company_name?.trim() || DEFAULT_SHOP.name,
    logoUrl: settings.logo_url ?? null,
    address: settings.address ?? undefined,
    city: settings.city ?? undefined,
    state: settings.state ?? undefined,
    pincode: settings.pincode ?? undefined,
    phone: settings.phone ?? undefined,
    email: settings.email ?? undefined,
    gstin: settings.gstin ?? undefined,
    pan: settings.pan ?? undefined,
    website: settings.website ?? undefined,
  };
}

function shopAddressLine(shop: ShopDetails): string {
  return [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
}

// Sensible defaults for the display toggles / footer so screens that
// haven't loaded invoice_settings yet (or a row that's missing some
// columns) don't crash — everything just shows by default.
interface InvoiceDisplayConfig {
  show_logo: boolean;
  show_huid: boolean;
  show_weight: boolean;
  show_making_charges: boolean;
  show_value_added_charges: boolean;
  invoice_footer: string | null;
  terms_and_conditions: string | null;
}

const DEFAULT_INVOICE_SETTINGS: InvoiceDisplayConfig = {
  show_logo: true,
  show_huid: true,
  show_weight: true,
  show_making_charges: true,
  show_value_added_charges: true,
  invoice_footer: null,
  terms_and_conditions: null,
};

// ===========================================================
// A4 / full invoice PDF
// ===========================================================

export function buildInvoiceHtml(
  invoice: InvoiceDetail,
  shop: ShopDetails = DEFAULT_SHOP,
  display: Partial<InvoiceDisplayConfig> = {}
): string {
  const cfg = { ...DEFAULT_INVOICE_SETTINGS, ...display };

  const itemRows = invoice.items
    .map((item, idx) => {
      const huidLine =
        cfg.show_huid && (item as any).huid ? `<br/><span class="muted">HUID: ${(item as any).huid}</span>` : '';
      return `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <strong>${item.product_name}</strong><br/>
          <span class="muted">${item.product_code} · ${item.metal_name} ${item.purity_name}</span>${huidLine}
        </td>
        <td class="num">${item.quantity}</td>
        ${cfg.show_weight ? `<td class="num">${item.net_weight}g</td>` : ''}
        <td class="num">${money(item.metal_rate)}</td>
        <td class="num">${money(item.metal_value)}</td>
        ${cfg.show_making_charges ? `<td class="num">${money(item.making_charge_amount)}</td>` : ''}
        ${cfg.show_value_added_charges ? `<td class="num">${money(item.value_added_total)}</td>` : ''}
        <td class="num">${money(item.tax_amount)}</td>
        <td class="num"><strong>${money(item.total)}</strong></td>
      </tr>`;
    })
    .join('');

  const chargeRows = invoice.charges
    .map((c) => `<div class="totalsRow"><span>${c.charge_name}</span><span>${money(c.amount)}</span></div>`)
    .join('');

  const addressLine = shopAddressLine(shop);
  const contactLine = [shop.phone ? `Ph: ${shop.phone}` : '', shop.email ?? '', shop.website ?? '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const regLine = [shop.gstin ? `GSTIN: ${shop.gstin}` : '', shop.pan ? `PAN: ${shop.pan}` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  const weightHeader = cfg.show_weight ? '<th class="num">Net Wt</th>' : '';
  const makingHeader = cfg.show_making_charges ? '<th class="num">Making</th>' : '';
  const vaHeader = cfg.show_value_added_charges ? '<th class="num">VA Charges</th>' : '';

  const footerText = invoice.charges.length || !cfg.invoice_footer
    ? cfg.invoice_footer || `Thank you for your business — ${shop.name}`
    : cfg.invoice_footer;

  // GST breakdown for the totals block — CGST/SGST (intra-state) or
  // GST/IGST (inter-state) only render when their amount is > 0.
  const cgstRow = invoice.cgst_total > 0
    ? `<div class="totalsRow"><span>CGST${formatRate(invoice.cgst_total, invoice.subtotal)}</span><span>${money(invoice.cgst_total)}</span></div>`
    : '';
  const sgstRow = invoice.sgst_total > 0
    ? `<div class="totalsRow"><span>SGST${formatRate(invoice.sgst_total, invoice.subtotal)}</span><span>${money(invoice.sgst_total)}</span></div>`
    : '';
  const igstRow = invoice.igst_total > 0
    ? `<div class="totalsRow"><span>GST${formatRate(invoice.igst_total, invoice.subtotal)}</span><span>${money(invoice.igst_total)}</span></div>`
    : '';

  return `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; font-family: -apple-system, Helvetica, Arial, sans-serif; }
      body { padding: 24px; color: #1a1a2e; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a2a5e; padding-bottom: 16px; margin-bottom: 16px; }
      .companyBlock { display: flex; align-items: flex-start; gap: 12px; }
      .companyLogo { width: 56px; height: 56px; object-fit: contain; border-radius: 6px; }
      .company { font-size: 20px; font-weight: 700; color: #1a2a5e; }
      .companyDetail { font-size: 11px; color: #555; margin-top: 2px; line-height: 1.5; }
      .invoiceMeta { text-align: right; font-size: 12px; color: #555; }
      .invoiceMeta .num { font-size: 16px; font-weight: 700; color: #1a2a5e; }
      .customerBox { margin-bottom: 20px; font-size: 13px; }
      .customerBox .label { color: #888; font-size: 11px; text-transform: uppercase; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
      th { background: #f0f2f8; text-align: left; padding: 8px 6px; border-bottom: 2px solid #ccc; font-size: 11px; text-transform: uppercase; color: #444; }
      td { padding: 8px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
      .num { text-align: right; white-space: nowrap; }
      .muted { color: #888; font-size: 11px; }
      .totalsBlock { width: 280px; margin-left: auto; font-size: 13px; }
      .totalsRow { display: flex; justify-content: space-between; padding: 4px 0; }
      .totalsRow.grand { font-size: 16px; font-weight: 700; border-top: 2px solid #1a2a5e; margin-top: 6px; padding-top: 8px; color: #1a2a5e; }
      .totalsRow.balance { color: #b00020; font-weight: 700; }
      .terms { margin-top: 24px; font-size: 10.5px; color: #777; border-top: 1px solid #eee; padding-top: 10px; white-space: pre-line; }
      .terms .label { font-size: 10px; text-transform: uppercase; color: #999; margin-bottom: 4px; display: block; }
      .footer { margin-top: 20px; font-size: 11px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="companyBlock">
        ${cfg.show_logo && shop.logoUrl ? `<img class="companyLogo" src="${shop.logoUrl}" />` : ''}
        <div>
          <div class="company">${shop.name}</div>
          ${addressLine ? `<div class="companyDetail">${addressLine}</div>` : ''}
          ${contactLine ? `<div class="companyDetail">${contactLine}</div>` : ''}
          ${regLine ? `<div class="companyDetail">${regLine}</div>` : ''}
        </div>
      </div>
      <div class="invoiceMeta">
        <div class="num">${invoice.invoice_number}</div>
        <div>Date: ${new Date(invoice.invoice_date).toLocaleDateString('en-IN')}</div>
      </div>
    </div>

    <div class="customerBox">
      <div class="label">Bill To</div>
      <div><strong>${invoice.customer_name}</strong></div>
      ${invoice.customer_mobile ? `<div>${invoice.customer_mobile}</div>` : ''}
      ${invoice.customer_address ? `<div>${invoice.customer_address}</div>` : ''}
      ${invoice.customer_gstin ? `<div>GSTIN: ${invoice.customer_gstin}</div>` : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th><th>Item</th><th class="num">Qty</th>${weightHeader}
          <th class="num">Rate</th><th class="num">Metal Value</th>${makingHeader}
          ${vaHeader}<th class="num">Tax</th><th class="num">Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="totalsBlock">
      <div class="totalsRow"><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div>
      ${chargeRows}
      <div class="totalsRow"><span>Discount</span><span>-${money(invoice.invoice_discount)}</span></div>
      ${cgstRow}
      ${sgstRow}
      ${igstRow}
      <div class="totalsRow grand"><span>Grand Total</span><span>${money(invoice.grand_total)}</span></div>
      <div class="totalsRow"><span>Amount Paid</span><span>${money(invoice.paid_amount)}</span></div>
      ${invoice.balance_amount > 0 ? `<div class="totalsRow balance"><span>Balance Due</span><span>${money(invoice.balance_amount)}</span></div>` : ''}
    </div>

    ${cfg.terms_and_conditions ? `<div class="terms"><span class="label">Terms &amp; Conditions</span>${cfg.terms_and_conditions}</div>` : ''}

    <div class="footer">${footerText}</div>
  </body>
  </html>`;
}

// ===========================================================
// Thermal (58/80mm) receipt — shop details + items + totals only.
// Deliberately omits customer name/mobile/address/GSTIN.
// ===========================================================

export function buildThermalReceiptHtml(
  invoice: InvoiceDetail,
  shop: ShopDetails = DEFAULT_SHOP,
  display: Partial<InvoiceDisplayConfig> = {}
): string {
  const cfg = { ...DEFAULT_INVOICE_SETTINGS, ...display };

  const itemRows = invoice.items
    .map((item) => {
      const weightPart = cfg.show_weight ? `${item.net_weight}g @ ${moneyCompact(item.metal_rate)}` : '';
      const chargeLabel = ['Metal', cfg.show_making_charges && 'Making', cfg.show_value_added_charges && 'VA']
        .filter(Boolean)
        .join(' + ');
      const chargeAmount =
        item.metal_value +
        (cfg.show_making_charges ? item.making_charge_amount : 0) +
        (cfg.show_value_added_charges ? item.value_added_total : 0);

      return `
      <div class="item">
        <div class="itemName">${item.product_name}${item.quantity > 1 ? ` x${item.quantity}` : ''}</div>
        ${weightPart ? `<div class="itemMeta">${weightPart}</div>` : ''}
        <div class="itemLine">
          <span>${chargeLabel}</span>
          <span>${moneyCompact(chargeAmount)}</span>
        </div>
        ${item.tax_amount > 0 ? `<div class="itemLine"><span>Tax</span><span>${moneyCompact(item.tax_amount)}</span></div>` : ''}
        <div class="itemLine total"><span>Item Total</span><span>${moneyCompact(item.total)}</span></div>
      </div>`;
    })
    .join('<div class="dashed"></div>');

  const chargeRows = invoice.charges
    .map((c) => `<div class="totalsRow"><span>${c.charge_name}</span><span>${moneyCompact(c.amount)}</span></div>`)
    .join('');

  const addressLine = shopAddressLine(shop);
  const footerText = cfg.invoice_footer || 'Thank you, visit again!';

  // GST breakdown — same logic as the A4 template, compact formatting.
  const cgstRow = invoice.cgst_total > 0
    ? `<div class="totalsRow"><span>CGST${formatRate(invoice.cgst_total, invoice.subtotal)}</span><span>${moneyCompact(invoice.cgst_total)}</span></div>`
    : '';
  const sgstRow = invoice.sgst_total > 0
    ? `<div class="totalsRow"><span>SGST${formatRate(invoice.sgst_total, invoice.subtotal)}</span><span>${moneyCompact(invoice.sgst_total)}</span></div>`
    : '';
  const igstRow = invoice.igst_total > 0
    ? `<div class="totalsRow"><span>GST${formatRate(invoice.igst_total, invoice.subtotal)}</span><span>${moneyCompact(invoice.igst_total)}</span></div>`
    : '';

  return `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 280px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: #000;
        padding: 10px 8px;
      }
      .center { text-align: center; }
      .shopLogo { width: 48px; height: 48px; object-fit: contain; margin: 0 auto 4px; display: block; }
      .shopName { font-size: 15px; font-weight: 700; }
      .shopMeta { font-size: 10px; margin-top: 2px; }
      .dashed { border-top: 1px dashed #000; margin: 8px 0; }
      .metaRow { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
      .item { padding: 4px 0; }
      .itemName { font-weight: 700; font-size: 12px; }
      .itemMeta { font-size: 10px; color: #333; }
      .itemLine { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
      .itemLine.total { font-weight: 700; }
      .totalsRow { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
      .totalsRow.grand { font-size: 14px; font-weight: 700; margin-top: 4px; }
      .totalsRow.balance { font-weight: 700; }
      .footer { text-align: center; font-size: 10px; margin-top: 10px; white-space: pre-line; }
    </style>
  </head>
  <body>
    <div class="center">
     
      <div class="shopName">${shop.name}</div>
      ${addressLine ? `<div class="shopMeta">${addressLine}</div>` : ''}
      ${shop.phone ? `<div class="shopMeta">Ph: ${shop.phone}</div>` : ''}
      ${shop.gstin ? `<div class="shopMeta">GSTIN: ${shop.gstin}</div>` : ''}
    </div>

    <div class="dashed"></div>

    <div class="metaRow"><span>${invoice.invoice_number}</span><span>${new Date(invoice.invoice_date).toLocaleDateString('en-IN')}</span></div>

    <div class="dashed"></div>

    ${itemRows}

    <div class="dashed"></div>

    <div class="totalsRow"><span>Subtotal</span><span>${moneyCompact(invoice.subtotal)}</span></div>
    ${chargeRows}
    ${invoice.invoice_discount > 0 ? `<div class="totalsRow"><span>Discount</span><span>-${moneyCompact(invoice.invoice_discount)}</span></div>` : ''}
    ${cgstRow}
    ${sgstRow}
    ${igstRow}
    <div class="totalsRow grand"><span>TOTAL</span><span>${moneyCompact(invoice.grand_total)}</span></div>
    <div class="totalsRow"><span>Paid</span><span>${moneyCompact(invoice.paid_amount)}</span></div>
    ${invoice.balance_amount > 0 ? `<div class="totalsRow balance"><span>Balance</span><span>${moneyCompact(invoice.balance_amount)}</span></div>` : ''}

    <div class="dashed"></div>

    <div class="footer">${footerText}</div>
  </body>
  </html>`;
}

// ===========================================================
// End-to-end: fetch fresh data → build HTML → render PDF → share
// ===========================================================
//
// Fetches invoice, company_settings, and invoice_settings fresh on every
// call, so a print always reflects the current logo/address/GSTIN and the
// current show/hide toggles even if they changed after the invoice was
// created. Uses expo-print + expo-sharing:
//   npx expo install expo-print expo-sharing

export async function generateInvoicePdf(
  invoiceId: string,
  variant: 'a4' | 'thermal' = 'a4'
): Promise<{ uri: string }> {
  const [invoice, companySettings, invoiceSettings] = await Promise.all([
    getInvoiceById(invoiceId),
    getCompanySettings(),
    getInvoiceSettings().catch(() => null),
  ]);

  console.log('generateInvoicePdf: companySettings =', companySettings);
  console.log('generateInvoicePdf: invoiceSettings =', invoiceSettings);

  const shop = companyToShopDetails(companySettings);

  const display = invoiceSettings
    ? {
        show_logo: invoiceSettings.show_logo,
        show_huid: invoiceSettings.show_huid,
        show_weight: invoiceSettings.show_weight,
        show_making_charges: invoiceSettings.show_making_charges,
        show_value_added_charges: invoiceSettings.show_value_added_charges,
        invoice_footer: invoiceSettings.invoice_footer,
        terms_and_conditions: invoiceSettings.terms_and_conditions,
      }
    : {};

  const html =
    variant === 'thermal'
      ? buildThermalReceiptHtml(invoice, shop, display)
      : buildInvoiceHtml(invoice, shop, display);

  const Print = await import('expo-print');
  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
    ...(variant === 'thermal' ? { width: 302, height: undefined } : {}),
  });

  return { uri };
}

export async function shareInvoicePdf(invoiceId: string, variant: 'a4' | 'thermal' = 'a4'): Promise<void> {
  const { uri } = await generateInvoicePdf(invoiceId, variant);

  const Sharing = await import('expo-sharing');
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share Invoice',
    UTI: 'com.adobe.pdf',
  });
}