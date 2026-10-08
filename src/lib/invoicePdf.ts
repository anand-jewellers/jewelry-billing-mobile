// src/lib/invoicePdf.ts
import { Platform } from 'react-native';
import type { InvoiceDetail, InvoiceItemDetail, ExchangeItemDetail } from '../types/invoices';
import type { CompanySettings } from '../types/settings';
import { getInvoiceById } from './api/invoices';
import { getCompanySettings, getInvoiceSettings } from './api/settings';
import { displayNetWeight } from './exchangeGold';

// ===========================================================
// Small helpers
// ===========================================================

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const num = (n: unknown) => Number(n) || 0;

const fixed2 = (n: number) => num(n).toFixed(2);
const fixed3 = (n: number) => num(n).toFixed(3);
const plain = (n: number) => String(Number(num(n).toFixed(2)));
const pctText = (r: number) => `${Number(r.toFixed(2))}%`;

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return esc(value);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function fmtDateTimeSlip(value: string | undefined): string {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return '';
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');

  return `${dd}-${mm}-${yy} ${hh}:${minutes} ${ampm}`;
}

function withRate(label: string, amount: number, base: number): string {
  if (!base || amount <= 0) return label;
  return `${label} @ ${pctText((amount / base) * 100)}`;
}

function metalAbbrev(name: string): string {
  const n = (name || '').trim().toLowerCase();
  if (n === 'gold') return 'Gold';
  if (n === 'silver') return 'SIL';
  if (n === 'platinum') return 'PLAT';
  return name || '';
}

// ===========================================================
// Constants
// ===========================================================

const VA_CHARGE = 'Value Added Charge';
const STONE_CHARGE = 'Stone Charge';
// Diamond rows from a product are saved on the invoice item as charge lines
// named "Diamond <size>" (e.g. "Diamond 0.25 ct") — see invoiceCalc.ts.
const DIAMOND_CHARGE_PREFIX = 'Diamond';
const isDiamondCharge = (name: unknown) => String(name ?? '').startsWith(DIAMOND_CHARGE_PREFIX);
// "Diamond 0.25 ct" -> "0.25 ct"
const diamondWeightText = (name: unknown) =>
  String(name ?? '').replace(/^Diamond\s*/i, '').trim();
const DEFAULT_HSN = '7113';
const OLD_GOLD_HSN = '7108';
const LETTERHEAD_SPACE_PX = 110;

// Display labels for each payment mode, shared by both templates when
// rendering a per-mode split breakdown.
const PAY_MODE_LABELS: Record<string, string> = {
  cash: 'CASH',
  card: 'CARD',
  upi: 'UPI',
  bank_transfer: 'BANK TRANSFER',
  cheque: 'CHEQUE',
};

// ===========================================================
// Shop details
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
  name: 'Jewellery Shop',
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

export interface PrintOptions {
  showHeaderFooter: boolean;
}

const DEFAULT_PRINT_OPTIONS: PrintOptions = { showHeaderFooter: true };

// ===========================================================
// Figures shared by both templates
// ===========================================================

interface TaxRow {
  label: string;
  amount: number;
}

function taxAmountOf(invoice: InvoiceDetail, kind: 'CGST' | 'SGST' | 'IGST'): number {
  const names = kind === 'IGST' ? ['IGST', 'GST'] : [kind];
  const fromCharges = (invoice.charges ?? []).find((c) =>
    names.includes(String(c.charge_name ?? '').trim().toUpperCase())
  )?.amount;
  const fallback = (invoice as any)[`${kind.toLowerCase()}_total`];
  return round2(num(fromCharges ?? fallback));
}

// Collapses invoice.payment_splits into one total per payment mode
// (e.g. two "cash" rows become one summed cash figure). Returns an
// empty object when there are no splits, so callers can fall back to
// the single legacy payment_mode/paid_amount fields.
function splitTotalsByMode(invoice: InvoiceDetail): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of invoice.payment_splits ?? []) {
    const amt = num(s.amount);
    if (amt <= 0) continue;
    totals[s.mode] = round2((totals[s.mode] ?? 0) + amt);
  }
  return totals;
}

// An invoice is a GST invoice only if tax was actually charged on it.
export function isGstInvoice(invoice: InvoiceDetail): boolean {
  const hasTaxCharge = (invoice.charges ?? []).some(
    (c) =>
      ['CGST', 'SGST', 'IGST', 'GST'].includes(String(c.charge_name ?? '').trim().toUpperCase()) &&
      num(c.amount) > 0
  );
  return hasTaxCharge || num(invoice.tax_amount) > 0;
}


export function slipFigures(invoice: InvoiceDetail) {
  const items = invoice.items ?? [];
  const qtyOf = (i: InvoiceItemDetail) => Number(i.quantity) || 1;

  const grossWeight = round3(items.reduce((s, i) => s + num(i.gross_weight) * qtyOf(i), 0));
  const netWeight = round3(items.reduce((s, i) => s + num(i.net_weight) * qtyOf(i), 0));
  const lessWeight = round3(grossWeight - netWeight);

  const rate =
    items.length > 0 && items.every((i) => i.metal_rate === items[0].metal_rate) ? num(items[0].metal_rate) : null;

  const making = round2(items.reduce((s, i) => s + num(i.making_charge_amount), 0));

  const lineTotals: Record<string, number> = {};
  const lineRates: Record<string, number | null> = {};
  for (const item of items) {
    const qty = qtyOf(item);
    for (const c of item.value_added_charges ?? []) {
      lineTotals[c.charge_name] = round2((lineTotals[c.charge_name] ?? 0) + num(c.amount) * qty);
      const r = c.calculation_type === 'percentage' ? num(c.value) : null;
      if (!(c.charge_name in lineRates)) lineRates[c.charge_name] = r;
      else if (lineRates[c.charge_name] !== r) lineRates[c.charge_name] = null;
    }
  }

  const vaAmount = lineTotals[VA_CHARGE] ?? 0;
  const vaRate = lineRates[VA_CHARGE] ?? null;
  const stone = lineTotals[STONE_CHARGE] ?? 0;
  const otherCharges = Object.entries(lineTotals)
    .filter(([name, amount]) => name !== VA_CHARGE && name !== STONE_CHARGE && amount > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const subtotal = round2(num(invoice.subtotal));

  const taxRows: TaxRow[] = [];
  const cgst = taxAmountOf(invoice, 'CGST');
  const sgst = taxAmountOf(invoice, 'SGST');
  const igst = taxAmountOf(invoice, 'IGST');
  if (cgst > 0 && sgst > 0) {
    taxRows.push({ label: withRate('CGST', cgst, subtotal), amount: cgst });
    taxRows.push({ label: withRate('SGST', sgst, subtotal), amount: sgst });
  } else if (igst > 0) {
    taxRows.push({ label: withRate('GST', igst, subtotal), amount: igst });
  } else {
    if (cgst > 0) taxRows.push({ label: withRate('CGST', cgst, subtotal), amount: cgst });
    if (sgst > 0) taxRows.push({ label: withRate('SGST', sgst, subtotal), amount: sgst });
  }
  if (taxRows.length === 0 && num(invoice.tax_amount) > 0) {
    taxRows.push({ label: 'GST', amount: round2(num(invoice.tax_amount)) });
  }
  const taxTotal = round2(taxRows.reduce((s, t) => s + t.amount, 0));

  const discount = round2(num(invoice.invoice_discount));
  const grossTotal = Math.round(subtotal + taxTotal);
  const grand = round2(num(invoice.grand_total));
  const roundOff = round2(grand - (subtotal + taxTotal - discount));

  const exchangeItems: ExchangeItemDetail[] = invoice.exchange_items ?? [];
  const exchangeTotal = round2(num(invoice.exchange_total));
  const exchangeNetWeight = round3(exchangeItems.reduce((s, e) => s + displayNetWeight(e), 0));

  const netBillAmount = round2(grand - exchangeTotal);

  return {
    grossWeight, netWeight, lessWeight, rate,
    making, vaAmount, vaRate, stone, otherCharges,
    subtotal, taxRows, taxTotal, discount, grossTotal, grand, roundOff,
    paid: round2(num(invoice.paid_amount)),
    balance: round2(num(invoice.balance_amount)),
    exchangeItems, exchangeTotal, exchangeNetWeight, netBillAmount,
  };
}

// ===========================================================
// A4 tax invoice
// ===========================================================

const PAY_MODES = [
  { id: 'cash', label: 'CASH' },
  { id: 'card', label: 'CARD' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'NEFT' },
  { id: 'cheque', label: 'CHEQUE' },
];

export function buildInvoiceHtml(
  invoice: InvoiceDetail,
  shop: ShopDetails = DEFAULT_SHOP,
  display: Partial<InvoiceDisplayConfig> = {},
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): string {
  const cfg = { ...DEFAULT_INVOICE_SETTINGS, ...display };
  const showHF = options.showHeaderFooter;
  const f = slipFigures(invoice);
  const gst = isGstInvoice(invoice);

  const itemRows = (invoice.items ?? [])
    .map((item, idx) => {
      const qty = Number(item.quantity) || 1;
      const lines = item.value_added_charges ?? [];
      const rate = num(item.metal_rate);

      const stoneAmt = round2(
        lines.filter((c) => c.charge_name === STONE_CHARGE).reduce((s, c) => s + num(c.amount), 0) * qty
      );

      // V.Addn as a percentage
      const vaLine = lines.find((c) => c.charge_name === VA_CHARGE);
      let vaPercent = 0;
      if (vaLine) {
        if (vaLine.calculation_type === 'percentage') {
          vaPercent = num(vaLine.value); // the % the user entered
        } else {
          // flat-amount charge: derive the % against the metal value
          const metalValue = num(item.net_weight) * qty * rate;
          vaPercent = metalValue > 0 ? ((num(vaLine.amount) * qty) / metalValue) * 100 : 0;
        }
      }
      const taxable = round2(num(item.total) - num(item.tax_amount));

      const stoneWeight = round3(
        (item as any).stone_weight != null
          ? num((item as any).stone_weight) * qty
          : Math.max(0, (num(item.gross_weight) - num(item.net_weight)) * qty)
      );

      const huid = (item as any).huid as string | undefined;
      const huidLine = cfg.show_huid && huid ? `<div class="sub">HUID: ${esc(huid)}</div>` : '';

      // Diamond size + amount, one small line per diamond row under the
      // item description (their amounts are already inside TAXABLE AMT).
      const diamondHtml = cfg.show_value_added_charges
        ? lines
          .filter((c) => isDiamondCharge(c.charge_name) && num(c.amount) > 0)
          .map(
            (c) =>
              `<div class="sub dia">${esc(c.charge_name)} : ${plain(num(c.amount) * qty)}</div>`
          )
          .join('')
        : '';

      return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td>${esc(item.product_name)}${huidLine}${diamondHtml}</td>
        <td class="c">${qty}</td>
        <td class="c">${DEFAULT_HSN}</td>
        ${cfg.show_weight ? `<td class="c">${fixed3(num(item.gross_weight) * qty)}</td>` : ''}
        ${cfg.show_weight ? `<td class="c">${stoneWeight > 0 ? fixed3(stoneWeight) : ''}</td>` : ''}
        ${cfg.show_weight ? `<td class="c">${fixed3(num(item.net_weight) * qty)}</td>` : ''}
        ${cfg.show_value_added_charges ? `<td class="c">${vaPercent > 0 ? pctText(vaPercent) : ''}</td>` : ''}
        ${cfg.show_making_charges ? `<td class="c">${num(item.making_charge_amount) > 0 ? plain(item.making_charge_amount) : ''}</td>` : ''}
        ${cfg.show_value_added_charges ? `<td class="c">${stoneAmt > 0 ? plain(stoneAmt) : ''}</td>` : ''}
        <td class="c">${plain(rate)}</td>
        <td class="r">${fixed2(taxable)}</td>
      </tr>`;
    })
    .join('');

  const headWeight = cfg.show_weight ? '<th>GROSS WT</th><th>ST.WT</th><th>NET WT</th>' : '';
  const headVa = cfg.show_value_added_charges ? '<th>V.Addn</th>' : '';
  const headMc = cfg.show_making_charges ? '<th>MC</th>' : '';
  const headStone = cfg.show_value_added_charges ? '<th>SC</th>' : '';

  const totalCols =
    4 +
    (cfg.show_weight ? 3 : 0) +
    (cfg.show_value_added_charges ? 1 : 0) +
    (cfg.show_making_charges ? 1 : 0) +
    (cfg.show_value_added_charges ? 1 : 0) +
    2;

  const colGroupHtml = `
    <colgroup>
      <col style="width: 4%;" />
      <col style="width: 25%;" />
      <col style="width: 5%;" />
      <col style="width: 7%;" />
      ${cfg.show_weight ? '<col style="width: 9%;" /><col style="width: 7%;" /><col style="width: 8%;" />' : ''}
      ${cfg.show_value_added_charges ? '<col style="width: 7%;" />' : ''}
      ${cfg.show_making_charges ? '<col style="width: 6%;" />' : ''}
      ${cfg.show_value_added_charges ? '<col style="width: 6%;" />' : ''}
      <col style="width: 7%;" />
      <col style="width: 9%;" />
    </colgroup>`;

  const purchaseBillNo =
    (invoice as any).exchange_bill_no ?? (f.exchangeItems[0] as any)?.purchase_bill_no ?? '';

  const exchangeSection = f.exchangeItems.length > 0
    ? `
    <table class="items exchGrid">
      <colgroup>
        <col style="width: 30%;" />
        <col style="width: 13%;" />
        <col style="width: 13%;" />
        <col style="width: 13%;" />
        <col style="width: 13%;" />
        <col style="width: 18%;" />
      </colgroup>
      <thead>
        <tr>
          <th colspan="6" class="purchaseLabel">
            OLD GOLD EXCHANGE ${purchaseBillNo ? `&nbsp;·&nbsp; Ref Bill No: ${esc(purchaseBillNo)}` : ''}
          </th>
        </tr>
        <tr>
          <th style="text-align: left; padding-left: 4px;">DESCRIPTION</th>
          <th>GROSS WT</th>
          <th>STONE WT</th>
          <th>NET WT</th>
          <th>RATE</th>
          <th>AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        ${f.exchangeItems
      .map(
        (e) => `
          <tr>
            <td style="text-align: left; padding-left: 4px;">${esc(e.description || 'Old Gold')}</td>
            <td class="c">${fixed3(e.gross_weight)}</td>
            <td class="c">${(() => {
            const sw = num((e as any).stone_weight ?? (e as any).dust_weight ?? 0);
            return sw > 0 ? fixed3(sw) : '';
          })()}</td>
            <td class="c">${fixed3(displayNetWeight(e))}</td>
            <td class="c">${plain(e.rate_per_gram)}</td>
            <td class="r">${fixed2(e.amount)}</td>
          </tr>`
      )
      .join('')}
        <tr class="exchTotalRow">
          <td colspan="3" class="r" style="font-weight: 700;">Exchange Total Weight:</td>
          <td class="c" style="font-weight: 700;">${fixed3(f.exchangeNetWeight)}</td>
          <td class="r" style="font-weight: 700;">Total:</td>
          <td class="r" style="font-weight: 700;">${fixed2(f.exchangeTotal)}</td>
        </tr>
      </tbody>
    </table>`
    : '';
  const addressLine = shopAddressLine(shop);
  const contactLine = [shop.phone ? `Ph: ${esc(shop.phone)}` : '', esc(shop.email ?? ''), esc(shop.website ?? '')]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const regLine = [shop.gstin && gst ? `GSTIN: ${esc(shop.gstin)}` : '', shop.pan ? `PAN: ${esc(shop.pan)}` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  const headerHtml = showHF
    ? `
    <div class="hdr">
      ${cfg.show_logo && shop.logoUrl ? `<img class="logo" src="${esc(shop.logoUrl)}" />` : ''}
      <div class="hdrText">
        <div class="company">${esc(shop.name)}</div>
        ${addressLine ? `<div class="companyDetail">${esc(addressLine)}</div>` : ''}
        ${contactLine ? `<div class="companyDetail">${contactLine}</div>` : ''}
        ${regLine ? `<div class="companyDetail">${regLine}</div>` : ''}
      </div>
    </div>`
    : `<div style="height:${LETTERHEAD_SPACE_PX}px"></div>`;

  const footerText = cfg.invoice_footer || `Thank you for your business — ${shop.name}`;
  const footerHtml = showHF
    ? `
    ${cfg.terms_and_conditions ? `<div class="terms"><b>Terms &amp; Conditions</b><br/>${esc(cfg.terms_and_conditions)}</div>` : ''}
    <div class="footer">${esc(footerText)}</div>`
    : '';

  const rateEntries = Array.from(
    new Map((invoice.items ?? []).map((i) => [i.metal_name, num(i.metal_rate)])).entries()
  )
    .map(([name, rate]) => `${esc(metalAbbrev(name))} : ${plain(rate)}`)
    .join(' ');

  const totalsRows = [
    `<tr><td class="l"></td><td class="v dashTop">${fixed2(f.subtotal)}</td></tr>`,
    ...f.taxRows.map((t) => `<tr><td class="l">${esc(t.label)}</td><td class="v">${fixed2(t.amount)}</td></tr>`),
    f.discount > 0 ? `<tr><td class="l">Discount</td><td class="v">-${fixed2(f.discount)}</td></tr>` : '',
    Math.abs(f.roundOff) >= 0.005 ? `<tr><td class="l">Round Off</td><td class="v">${fixed2(f.roundOff)}</td></tr>` : '',
    `<tr class="grand"><td class="l">TOTAL</td><td class="v">${fixed2(f.grand)}</td></tr>`,
  ].join('');

  // ---------------------------------------------------------
  // Payment mode cells — now split-aware.
  //
  // If invoice.payment_splits has entries (a split payment), each mode's
  // cell shows the SUM of everything collected in that mode (e.g. two
  // separate cash rows on the same invoice show as one combined cash
  // figure). If there are no splits at all, this falls back to the old
  // single-mode/paid_amount behaviour exactly as before, so invoices
  // saved before split payments existed still print correctly.
  // ---------------------------------------------------------
  const splitTotals = splitTotalsByMode(invoice);
  const hasSplits = Object.keys(splitTotals).length > 0;
  const legacyPaidMode = (invoice as any).payment_mode ?? (f.paid > 0 ? 'cash' : null);

  const modeCells = PAY_MODES.map((m) => {
    const amt = hasSplits
      ? (splitTotals[m.id] ?? 0)
      : (m.id === legacyPaidMode && f.paid > 0 ? f.paid : 0);
    return `
      <div class="mode">
        <div class="modeLabel">${m.label} :</div>
        <div class="modeAmt">${amt > 0 ? fixed2(amt) : ''}</div>
      </div>`;
  }).join('');

  const netBalance = round2(Math.max(0, f.netBillAmount - f.paid));

  return `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px 36px; font-family: 'Times New Roman', Times, serif; font-size: 13px; color: #000; }
      .hdr { display: flex; align-items: center; justify-content: center; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 14px; text-align: center; }
      .logo { width: 56px; height: 56px; object-fit: contain; }
      .company { font-size: 20px; font-weight: 700; }
      .companyDetail { font-size: 11px; margin-top: 2px; line-height: 1.4; }
      .topBox { display: flex; border: 1.5px solid #000; }
      .cust { flex: 1.1; padding: 6px 10px; border-right: 1.5px solid #000; }
      .custName { font-weight: 700; font-size: 14px; }
      .meta { flex: 1; padding: 6px 10px; font-weight: 700; font-size: 13.5px; line-height: 1.35; }
      
      table.items { width: 100%; border-collapse: collapse; border: 1.5px solid #000; table-layout: fixed; }
      table.items th, table.items td { border: 1px solid #000; padding: 4px 2px; vertical-align: top; font-size: 12.5px; font-weight: 700; }
      table.items th { font-size: 12px; border-bottom: 1.5px solid #000; text-align: center; }
      
      table.items.exchGrid { margin-top: 10px; border: 1.5px solid #000; }
      .purchaseLabel { text-align: left; font-weight: 700; font-size: 13px; padding: 5px 6px !important; border-bottom: 1.5px solid #000 !important; background-color: #fcfcfc; }
      
      .c { text-align: center; white-space: nowrap; }
      .r { text-align: right; white-space: nowrap; padding-right: 4px; }
      .bold { font-weight: 700; }
      .sub { font-size: 10px; margin-top: 1px; font-weight: normal; }
      .sub.dia { font-weight: 700; font-size: 10.5px; }
      
      .below { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 8px; }
      .ng { font-size: 12px; font-weight: 700; padding-left: 55px; margin-top: 6px; }
      
      table.tot { width: 280px; border-collapse: collapse; }
      table.tot td { padding: 2px 0; font-size: 13px; }
      table.tot td.l { text-align: right; padding-right: 20px; font-weight: 700; }
      table.tot td.v { text-align: right; padding-right: 6px; width: 110px; font-weight: 700; }
      table.tot td.dashTop { border-top: 1.5px dashed #000; padding-top: 4px; }
      table.tot tr.grand td { font-weight: 700; padding-top: 4px; }
      
      .payDash { border-top: 1.5px dashed #000; margin-top: 36px; }
      .pay { display: flex; justify-content: space-between; align-items: flex-start; padding: 6px 0 0; }
      .modes { display: flex; gap: 32px; }
      .modeLabel { font-weight: 700; font-size: 13px; }
      .modeAmt { font-weight: 700; margin-top: 12px; font-size: 13px; min-height: 14px; }
      .bill { font-size: 16px; font-weight: 700; text-align: right; }
      .balance { font-size: 12px; font-weight: 700; color: #b00020; margin-top: 4px; text-align: right; }
      .terms { margin-top: 24px; font-size: 10.5px; border-top: 1px solid #999; padding-top: 8px; white-space: pre-line; }
      .footer { margin-top: 16px; font-size: 11px; text-align: center; border-top: 1px solid #999; padding-top: 10px; white-space: pre-line; }
    </style>
  </head>
  <body>
    ${headerHtml}

    <div class="topBox">
      <div class="cust">
        <div class="custName">Mr./Ms.${esc(invoice.customer_name)}</div>
        ${invoice.customer_mobile ? `<div>${esc(invoice.customer_mobile)}</div>` : ''}
        ${invoice.customer_address ? `<div>${esc(invoice.customer_address)}</div>` : ''}
        ${invoice.customer_gstin && gst ? `<div>GSTIN: ${esc(invoice.customer_gstin)}</div>` : ''}
      </div>
            <div class="meta">
        ${gst ? `<div>TAX INVOICE${shop.gstin ? ` GSTIN: ${esc(shop.gstin)}` : ''}</div>` : ''}
        ${gst ? `<div>SALES &nbsp;Bill No : ${esc(invoice.invoice_number)}</div>` : ''}
        <div>Date : ${fmtDate(invoice.invoice_date)}${rateEntries ? ` ${rateEntries}` : ''}</div>
      </div>
    </div>

    <table class="items">
      ${colGroupHtml}
      <thead>
        <tr>
          <th>NO</th>
          <th style="text-align:left; padding-left: 4px;">DESCRIPTION</th>
          <th>QTY</th>
          <th>HSN</th>
          ${headWeight}${headVa}${headMc}${headStone}
          <th>RATE</th>
          <th>TAXABLE AMT</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="below">
      <div class="ng">${cfg.show_weight ? `NG-${fixed3(f.netWeight)} gms` : ''}</div>
      <table class="tot">${totalsRows}</table>
    </div>

    ${exchangeSection}

    <div class="payDash"></div>
    <div class="pay">
      <div class="modes">${modeCells}</div>
      <div>
        <div class="bill">Bill Amount: ${fixed2(f.netBillAmount)}</div>
        ${netBalance > 0 ? `<div class="balance">Balance Due: ${fixed2(netBalance)}</div>` : ''}
      </div>
    </div>

    ${footerHtml}
  </body>
  </html>`;
}

// ===========================================================
// Thermal (58/80mm) slip
// ===========================================================

export function buildThermalReceiptHtml(
  invoice: InvoiceDetail,
  shop: ShopDetails = DEFAULT_SHOP,
  display: Partial<InvoiceDisplayConfig> = {},
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): string {
  const cfg = { ...DEFAULT_INVOICE_SETTINGS, ...display };
  const f = slipFigures(invoice);
  const gst = isGstInvoice(invoice);

  const row = (label: string, value: string, cls = '') =>
    `<div class="row ${cls}"><span class="lbl">${label}</span><span class="colon">:</span><span class="val">${value}</span></div>`;

  const dashedSep = '<div class="dashed-line">------------------------------------</div>';
  const itemDash = '<div class="item-dash">------</div>';

  // -----------------------------------------------------
  // Shop header — same source data as the A4 template
  // (companyToShopDetails), laid out centered for the narrow
  // thermal width instead of the A4's side-by-side header.
  // -----------------------------------------------------
  const shopAddress = shopAddressLine(shop);
  const shopContactLine = [shop.phone ? `Ph: ${esc(shop.phone)}` : '', esc(shop.email ?? '')]
    .filter(Boolean)
    .join('  |  ');
  const shopRegLine = [shop.gstin && gst ? `GSTIN: ${esc(shop.gstin)}` : '', shop.pan ? `PAN: ${esc(shop.pan)}` : '']
    .filter(Boolean)
    .join('  |  ');

  // -----------------------------------------------------
  // Per-item tax split. InvoiceItemDetail only stores one
  // combined tax_amount — there's no per-item CGST/SGST
  // saved — so the invoice-level rates (derived from
  // invoice.charges, same source the A4 template uses) are
  // applied to each item's own taxable amount to split its
  // tax into CGST + SGST (or a single GST row for IGST).
  // -----------------------------------------------------
  const subtotalOverall = round2(num(invoice.subtotal));
  const cgstTotalOverall = taxAmountOf(invoice, 'CGST');
  const sgstTotalOverall = taxAmountOf(invoice, 'SGST');
  const igstTotalOverall = taxAmountOf(invoice, 'IGST');
  const hasSplitGst = cgstTotalOverall > 0 && sgstTotalOverall > 0;
  const cgstRate = subtotalOverall > 0 ? (cgstTotalOverall / subtotalOverall) * 100 : 0;
  const sgstRate = subtotalOverall > 0 ? (sgstTotalOverall / subtotalOverall) * 100 : 0;
  const igstRate = subtotalOverall > 0 ? (igstTotalOverall / subtotalOverall) * 100 : 0;

  // -----------------------------------------------------
  // Per-product blocks — each item prints its own weight,
  // rate, charges, CGST/SGST and line total, one after
  // another, before the combined net-amount section further
  // down.
  // -----------------------------------------------------
  const productBlocks = (invoice.items ?? [])
    .map((item, idx) => {
      const qty = num(item.quantity) || 1;
      const grossWt = round3(num(item.gross_weight) * qty);
      const netWt = round3(num(item.net_weight) * qty);
      const lessWt = round3(Math.max(0, grossWt - netWt));

      const lines = item.value_added_charges ?? [];
      const vaLine = lines.find((c) => c.charge_name === VA_CHARGE);
      const stoneLine = lines.find((c) => c.charge_name === STONE_CHARGE);
      const diamondLines = lines.filter((c) => isDiamondCharge(c.charge_name) && num(c.amount) > 0);
      const otherLines = lines.filter(
        (c) => c.charge_name !== VA_CHARGE && c.charge_name !== STONE_CHARGE && !isDiamondCharge(c.charge_name)
      );

      // This item's own taxable base (its total minus its own tax), used
      // to split its tax into CGST + SGST at the invoice-level rate.
      const itemTaxable = round2(num(item.total) - num(item.tax_amount));
      const itemCgst = hasSplitGst ? round2((itemTaxable * cgstRate) / 100) : 0;
      const itemSgst = hasSplitGst ? round2((itemTaxable * sgstRate) / 100) : 0;
      const itemIgst = !hasSplitGst && igstTotalOverall > 0 ? round2((itemTaxable * igstRate) / 100) : 0;

      const taxRowsHtml = hasSplitGst
        ? `${itemCgst > 0 ? row(`CGST @ ${cgstRate.toFixed(1)}%`, fixed2(itemCgst)) : ''}${itemSgst > 0 ? row(`SGST @ ${sgstRate.toFixed(1)}%`, fixed2(itemSgst)) : ''}`
        : itemIgst > 0
          ? row(`GST @ ${igstRate.toFixed(1)}%`, fixed2(itemIgst))
          : num(item.tax_amount) > 0
            ? row('Tax', fixed2(item.tax_amount))
            : '';

      // Diamond weight + amount rows, e.g. "Diamond Wt : 0.25 ct" / "Diamond Amt : 12000"
      const diamondRowsHtml = cfg.show_value_added_charges
        ? diamondLines
          .map(
            (c) =>
              row('Diamond Wt', esc(diamondWeightText(c.charge_name)) + " ct") +
              row('Diamond Amt', plain(num(c.amount) * qty))
          )
          .join('')
        : '';

      return `
        <div class="item-block">
          <div class="item-title">ITEM ${idx + 1}: ${esc(item.product_name)}${qty > 1 ? ` x${qty}` : ''}</div>
          ${itemDash}
          ${cfg.show_weight ? row('Weight', `${fixed3(grossWt)} gms`) : ''}
          ${cfg.show_weight ? row('Stone/Less(wt)', fixed3(lessWt)) : ''}
          <div style="height: 6px;"></div>
          ${cfg.show_weight ? row('Nett Weight', fixed3(netWt)) : ''}
          ${row('Rate/gm', plain(item.metal_rate))}
          ${cfg.show_value_added_charges && vaLine
          ? row('V.ADNV', vaLine.calculation_type === 'percentage' ? `${num(vaLine.value).toFixed(1)} %` : fixed2(num(vaLine.amount) * qty))
          : ''}
          <div class="tight-dash">------</div>
          ${cfg.show_making_charges && num(item.making_charge_amount) > 0 ? row('MC', plain(item.making_charge_amount)) : ''}
          ${cfg.show_value_added_charges && stoneLine ? row('Stone Charges', plain(num(stoneLine.amount) * qty)) : ''}
          ${diamondRowsHtml}
          ${cfg.show_value_added_charges
          ? otherLines.map((c) => row(esc(c.charge_name), plain(num(c.amount) * qty))).join('')
          : ''}
          <div class="tight-dash">------</div>
          ${taxRowsHtml ? row('Total', fixed2(itemTaxable), 'item-total') : ''}
          ${taxRowsHtml ? '<div class="tight-dash">------</div>' : ''}
          ${taxRowsHtml}
          ${row('Gross', fixed2(item.total), 'item-total')}
        </div>
      `;
    })
    .join('');

  const exchangeBlocks = f.exchangeItems.map((e, idx) => {
    const purityPct = num((e as any).old_percent ?? (e as any).purity_percent ?? 100);
    const dustStone = num((e as any).stone_weight ?? (e as any).dust_weight ?? 0);
    const grossWt = num(e.gross_weight);
    const calculatedGrossWeight = displayNetWeight(e);

    return `
      <div class="old-item-block">
        <div class="old-item-title">OLD ITEM ${idx + 1} : ${esc(e.description || 'Gold Item')}</div>
        ${itemDash}
        ${row('Weight', fixed3(grossWt))}
        ${dustStone > 0 ? row('Dust/Stone', fixed3(dustStone)) : ''}
        ${dustStone > 0 ? row('Gross Weight', fixed3(calculatedGrossWeight)) : ''}
        ${row('Old Percentage', `* ${fixed2(purityPct)}%`)}
        <div class="tight-dash">------</div>
        ${row('Old Rate/Gm', `* ${plain(e.rate_per_gram)}`)}
        <div class="tight-dash">------</div>
        ${row('Gross', fixed2(e.amount))}
      </div>
    `;
  }).join('');

  const contactText = shop.phone
    ? `CONTACT :${esc(shop.phone)}`
    : 'CONTACT :9963780483,7010788696';

  // ---------------------------------------------------------
  // Payment breakdown — split-aware.
  //
  // With splits present, each mode gets its own printed row (e.g.
  // "CASH : 100000.00" then "CARD : 50000.00"), summed per mode the
  // same way as the A4 template. With no splits (older invoices, or a
  // single-mode payment), falls back to the original single
  // "FINAL AMOUNT" line using invoice.paid_amount exactly as before.
  // ---------------------------------------------------------
  const splitTotals = splitTotalsByMode(invoice);
  const splitRowsHtml = Object.entries(splitTotals)
    .map(([mode, amt]) => row(PAY_MODE_LABELS[mode] ?? mode.toUpperCase(), fixed2(amt)))
    .join('');

  const paymentSectionHtml = splitRowsHtml
    ? splitRowsHtml
    : `<div class="row final-amt">
        <span class="lbl">FINAL AMOUNT</span>
        <span class="colon">:</span>
        <span class="val">${f.paid > 0 ? fixed2(f.paid) : ''}</span>
      </div>`;

  return `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page {
        margin: 0;
        size: 80mm auto;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        width: 100%;
        max-width: 310px;
        margin: 0 auto;
        padding: 8px 10px 24px 10px;
        font-family: 'Courier New', Courier, monospace;
        font-size: 13.5px;
        font-weight: 700;
        color: #000;
        line-height: 1.35;
        background-color: #fff;
      }

      .shop-header {
        text-align: center;
        margin-bottom: 6px;
      }
      .shop-logo {
        width: 40px;
        height: 40px;
        object-fit: contain;
        margin-bottom: 4px;
      }
      .shop-name {
        font-size: 16px;
        font-weight: 800;
        text-transform: uppercase;
      }
      .shop-detail {
        font-size: 11px;
        font-weight: 600;
        margin-top: 2px;
        line-height: 1.35;
      }

      .top-datetime {
        text-align: right;
        font-size: 13px;
        margin-bottom: 4px;
      }
      .div-tag {
        font-size: 14px;
        margin-bottom: 12px;
      }

      .row {
        display: flex;
        align-items: flex-start;
        margin-bottom: 2px;
      }
      .row.spaced {
        margin-top: 10px;
      }
      .row.item-total {
        margin-top: 2px;
        font-size: 14px;
      }
      .lbl {
        flex: 1.45;
        white-space: nowrap;
      }
      .colon {
        width: 16px;
        text-align: center;
      }
      .val {
        flex: 1.3;
        text-align: left;
        padding-left: 4px;
      }

      .dashed-line {
        letter-spacing: -1px;
        margin: 6px 0;
        overflow: hidden;
        white-space: nowrap;
        font-size: 13px;
      }
      .tight-dash {
        letter-spacing: 0px;
        margin: 2px 0 2px 52%;
        font-size: 13px;
      }
      .item-dash {
        margin: 2px 0;
        font-size: 13px;
      }

      .item-block {
        margin-top: 14px;
      }
      .item-block:first-of-type {
        margin-top: 6px;
      }
      .item-title {
        font-size: 13.5px;
        text-transform: uppercase;
      }

      .section-title {
        margin-top: 16px;
        font-size: 14px;
        text-transform: uppercase;
        text-align: center;
      }

      .old-item-block {
        margin-top: 14px;
      }
      .old-item-title {
        font-size: 13.5px;
        text-transform: uppercase;
      }

      .nett-rs {
        margin-top: 10px;
        font-size: 16px;
      }
      .final-amt {
        margin-top: 8px;
        font-size: 14px;
      }

      .footer-box {
  margin-top: 26px;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
}
      .footer-box .dashed-line {
        margin-bottom: 8px;
      }
    </style>
  </head>
  <body>
    <div class="shop-header">
      ${false && cfg.show_logo && shop.logoUrl ? `<img class="shop-logo" src="${esc(shop.logoUrl)}" />` : ''}
      <div class="shop-name">${esc(shop.name)}</div>
      ${shopAddress ? `<div class="shop-detail">${esc(shopAddress)}</div>` : ''}
      ${shopContactLine ? `<div class="shop-detail">${shopContactLine}</div>` : ''}
      ${shopRegLine ? `<div class="shop-detail">${esc(shopRegLine)}</div>` : ''}
    </div>
    ${dashedSep}

    <!-- Per-product breakdown, one after another -->
    ${productBlocks}

    <!-- Old Items Section (still shown in full — it's separate from the products above) -->
    ${exchangeBlocks}

    <!-- Old Total -->
    ${f.exchangeItems.length > 0 ? `
      <div class="tight-dash">----------</div>
      ${row('OLD TOTAL', fixed2(f.exchangeTotal))}
    ` : ''}

    <!-- Overall summary: net amount only, not the full breakdown again -->
    <!-- Discount (only when one is given) — shown before the final amount -->
    ${f.discount > 0 ? `${dashedSep}${row('Discount', `-${fixed2(f.discount)}`)}` : ''}
    ${dashedSep}
    ${row('Nett RS', fixed2(f.netBillAmount), 'nett-rs')}
    ${dashedSep}
    ${paymentSectionHtml}

    <!-- Slip Footer -->
    <div class="footer-box">
      ${dashedSep}
      
      <div>**valid only for 1hr, Prices May change**</div>
      <div>Join Our Monthly Savings Scheme !!</div>
      <div style="margin-top: 10px;">GST Bill will be issued on Confirmation</div>
    </div>
  </body>
  </html>`;
}

// ===========================================================
// End-to-end: fetch fresh data → build HTML → render PDF → share
// ===========================================================

async function loadInvoiceHtml(
  invoiceId: string,
  variant: 'a4' | 'thermal',
  options: PrintOptions
): Promise<{ html: string; invoiceNumber: string }> {
  const [invoice, companySettings, invoiceSettings] = await Promise.all([
    getInvoiceById(invoiceId),
    getCompanySettings(),
    getInvoiceSettings().catch(() => null),
  ]);

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
      ? buildThermalReceiptHtml(invoice, shop, display, options)
      : buildInvoiceHtml(invoice, shop, display, options);

  return { html, invoiceNumber: invoice.invoice_number };
}

async function renderPdf(
  html: string,
  variant: 'a4' | 'thermal'
): Promise<{ uri: string; base64: string | null }> {
  const Print = await import('expo-print');
  const { uri, base64 } = await Print.printToFileAsync({
    html,
    base64: true,
    ...(variant === 'thermal' ? { width: 302, height: undefined } : { width: 595, height: 842 }),
  });
  return { uri, base64: base64 ?? null };
}

export async function generateInvoicePdf(
  invoiceId: string,
  variant: 'a4' | 'thermal' = 'a4',
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): Promise<{ uri: string }> {
  const { html } = await loadInvoiceHtml(invoiceId, variant, options);
  const { uri } = await renderPdf(html, variant);
  return { uri };
}

function getFileSystem(): any {
  try {
    return require('expo-file-system/legacy');
  } catch {
    return require('expo-file-system');
  }
}

async function writeBase64ToDest(base64: string, fileName: string): Promise<string> {
  const FS = getFileSystem();
  const dir: string | undefined = FS.documentDirectory ?? FS.cacheDirectory;
  if (!dir) throw new Error('No writable directory available.');
  const dest = `${dir}${fileName}`;
  try {
    await FS.deleteAsync(dest, { idempotent: true });
  } catch { }
  await FS.writeAsStringAsync(dest, base64, { encoding: FS.EncodingType.Base64 });
  return dest;
}

export async function sharePdfFromHtml(
  html: string,
  fileBaseName: string,
  variant: 'a4' | 'thermal' = 'a4'
): Promise<void> {
  const safeName = fileBaseName.replace(/[^\w.-]+/g, '_') || 'invoice';

  try {
    const { uri, base64 } = await renderPdf(html, variant);

    const shareUri = base64
      ? await writeBase64ToDest(base64, `${safeName}.pdf`)
      : uri;

    const Sharing = await import('expo-sharing');
    const available = await Sharing.isAvailableAsync();
    if (!available) throw new Error('Sharing is not available on this device.');

    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Invoice ${fileBaseName}`,
      UTI: 'com.adobe.pdf',
    });
  } catch (e) {
    console.warn('PDF share failed, falling back to the print dialog', e);
    await printHtml(html);
  }
}

let printInFlight = false;

export async function printHtml(html: string, variant: 'a4' | 'thermal' = 'a4'): Promise<void> {
  if (Platform.OS !== 'web') {
    if (printInFlight) return; // ignore double taps
    printInFlight = true;
    try {
      const Print = await import('expo-print');
      try {
        await Print.printAsync({ html });
      } catch (e: any) {
        // Android can get stuck with a print request that never completed.
        // Fall back to a PDF + share sheet, which has no such lock.
        if (!String(e?.message ?? '').includes('already in progress')) throw e;
        const { uri } = await Print.printToFileAsync({
          html,
          ...(variant === 'thermal' ? { width: 302 } : { width: 595, height: 842 }),
        });
        const Sharing = await import('expo-sharing');
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: 'Print / Save invoice',
        });
      }
    } finally {
      printInFlight = false;
    }
    return;
  }

  const doc = (globalThis as any).document;
  if (!doc) throw new Error('Printing is not available here.');

  await new Promise<void>((resolve, reject) => {
    const iframe = doc.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        win.focus();
        win.onafterprint = cleanup;
        win.print();
        resolve();
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    iframe.srcdoc = html;
    doc.body.appendChild(iframe);
  });
}

export async function shareInvoicePdf(
  invoiceId: string,
  variant: 'a4' | 'thermal' = 'a4',
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): Promise<void> {
  const { html, invoiceNumber } = await loadInvoiceHtml(invoiceId, variant, options);

  if (Platform.OS === 'web') {
    await printHtml(html);
    return;
  }

  await sharePdfFromHtml(html, invoiceNumber, variant);
}

export async function printInvoice(
  invoiceId: string,
  variant: 'a4' | 'thermal' = 'a4',
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): Promise<void> {
  const { html, invoiceNumber } = await loadInvoiceHtml(invoiceId, variant, options);
  await printHtml(html);
}

// in invoicePdf.ts
export async function printLabelsNative(html: string) {
  const Print = await import('expo-print');
  // 100mm x 15mm in PDF points (1mm = 2.8346pt)
  const { uri } = await Print.printToFileAsync({ html, width: 284, height: 43 });
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}