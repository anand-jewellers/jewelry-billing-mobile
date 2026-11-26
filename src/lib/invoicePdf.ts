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
const DEFAULT_HSN = '7113';
const LETTERHEAD_SPACE_PX = 110;

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
// Figures shared by the template
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
  // Payment structure
  //   New total - old gold = net bill
  //   net bill - advance - chit fund = amount to pay
  //   amount to pay - received (cash/card/upi...) = balance due
  //
  // The balance is worked out from the saved payment rows, so invoices saved
  // with a wrong balance_amount column still print the right figures.
  // ---------------------------------------------------------
  const allSplits = (invoice.payment_splits ?? []).filter((s) => num(s.amount) > 0);
  const hasSplits = allSplits.length > 0;

  const isChit = (s: any) => s.mode === 'chit_fund';
  const isAdvance = (s: any) => s.mode === 'advance' || s.reference === 'Advance';
  const isPrepaid = (s: any) => isChit(s) || isAdvance(s);

  const advanceTotal = round2(
    allSplits.filter((s) => !isChit(s) && isAdvance(s)).reduce((t, s) => t + num(s.amount), 0)
  );
  const chitTotal = round2(allSplits.filter(isChit).reduce((t, s) => t + num(s.amount), 0));
  const prepaidTotal = round2(advanceTotal + chitTotal);

  // Money received at billing, per mode (cash / card / upi ...). Advance, chit
  // fund and the unpaid "credit" part are not counted here.
  const receivedByMode: Record<string, number> = {};
  for (const s of allSplits) {
    if (isPrepaid(s) || s.mode === 'credit') continue;
    receivedByMode[s.mode] = round2((receivedByMode[s.mode] ?? 0) + num(s.amount));
  }
  // Older invoices without split rows: one mode + paid_amount
  const legacyMode = (invoice as any).payment_mode ?? 'cash';
  if (!hasSplits && f.paid > 0) receivedByMode[legacyMode] = f.paid;

  const receivedTotal = round2(Object.values(receivedByMode).reduce((t, v) => t + v, 0));

  const customerGetsMoney = f.netBillAmount < 0;
  const amountToPay = customerGetsMoney ? 0 : round2(Math.max(0, f.netBillAmount - prepaidTotal));
  const balanceDue = customerGetsMoney ? 0 : round2(Math.max(0, amountToPay - receivedTotal));
  const payout = round2(Math.max(0, prepaidTotal - f.netBillAmount));

  const modeCells = PAY_MODES.map((m) => {
    const amt = receivedByMode[m.id] ?? 0;
    return `
      <div class="mode">
        <div class="modeLabel">${m.label} :</div>
        <div class="modeAmt">${amt > 0 ? fixed2(amt) : ''}</div>
      </div>`;
  }).join('');

  const sumRow = (label: string, value: string, cls = '') =>
    `<tr class="${cls}"><td class="l">${label}</td><td class="v">${value}</td></tr>`;

  const summaryRows = [
    sumRow('NEW TOTAL', fixed2(f.grand)),
    f.exchangeTotal > 0 ? sumRow('Less: Old Gold', `-${fixed2(f.exchangeTotal)}`) : '',
    sumRow(customerGetsMoney ? 'NETT (C.R)' : 'NET BILL AMOUNT', fixed2(f.netBillAmount), 'strong'),
    !customerGetsMoney && advanceTotal > 0 ? sumRow('Less: Advance', `-${fixed2(advanceTotal)}`) : '',
    !customerGetsMoney && chitTotal > 0 ? sumRow('Less: Chit Fund', `-${fixed2(chitTotal)}`) : '',
    !customerGetsMoney && prepaidTotal > 0 ? sumRow('AMOUNT TO PAY', fixed2(amountToPay), 'strong') : '',
    receivedTotal > 0 ? sumRow('Received', fixed2(receivedTotal)) : '',
    !customerGetsMoney
      ? sumRow('BALANCE DUE', fixed2(balanceDue), balanceDue > 0 ? 'strong due' : 'strong')
      
      : '',
          payout > 0 ? sumRow('PAY TO CUSTOMER', fixed2(payout), 'strong due') : '',
  ].join('');
  

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
      .pay { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0 0; }
      .modesBox { flex: 1; padding-right: 16px; }
      .payTitle { font-weight: 700; font-size: 12px; margin-bottom: 6px; text-decoration: underline; }
      .modes { display: flex; flex-wrap: wrap; gap: 10px 22px; }
      .modeLabel { font-weight: 700; font-size: 13px; }
      .modeAmt { font-weight: 700; margin-top: 12px; font-size: 13px; min-height: 14px; }
      table.sum { width: 300px; border-collapse: collapse; }
      table.sum td { padding: 2px 0; font-size: 13px; font-weight: 700; }
      table.sum td.l { text-align: left; padding-right: 12px; }
      table.sum td.v { text-align: right; padding-right: 4px; width: 110px; }
      table.sum tr.strong td { border-top: 1px solid #000; padding-top: 4px; font-size: 14px; }
      table.sum tr.due td { color: #b00020; }
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
          <th>AMOUNT</th>
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
      <div class="modesBox">
        <div class="payTitle">PAYMENT RECEIVED</div>
        <div class="modes">${modeCells}</div>
      </div>
      <table class="sum">${summaryRows}</table>
    </div>

    
  </body>
  </html>`;
}

// ===========================================================
// End-to-end: fetch fresh data → build HTML → render PDF → share
// ===========================================================

async function loadInvoiceHtml(
  invoiceId: string,
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

  const html = buildInvoiceHtml(invoice, shop, display, options);

  return { html, invoiceNumber: invoice.invoice_number };
}

async function renderPdf(html: string): Promise<{ uri: string; base64: string | null }> {
  const Print = await import('expo-print');
  const { uri, base64 } = await Print.printToFileAsync({
    html,
    base64: true,
    width: 595,
    height: 842,
  });
  return { uri, base64: base64 ?? null };
}

export async function generateInvoicePdf(
  invoiceId: string,
  _variant: 'a4' = 'a4',
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): Promise<{ uri: string }> {
  const { html } = await loadInvoiceHtml(invoiceId, options);
  const { uri } = await renderPdf(html);
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
  _variant: 'a4' = 'a4'
): Promise<void> {
  const safeName = fileBaseName.replace(/[^\w.-]+/g, '_') || 'invoice';

  try {
    const { uri, base64 } = await renderPdf(html);

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

export async function printHtml(html: string, _variant: 'a4' = 'a4'): Promise<void> {
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
        const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
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
  _variant: 'a4' = 'a4',
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): Promise<void> {
  const { html, invoiceNumber } = await loadInvoiceHtml(invoiceId, options);

  if (Platform.OS === 'web') {
    await printHtml(html);
    return;
  }

  await sharePdfFromHtml(html, invoiceNumber);
}

export async function printInvoice(
  invoiceId: string,
  _variant: 'a4' = 'a4',
  options: PrintOptions = DEFAULT_PRINT_OPTIONS
): Promise<void> {
  const { html } = await loadInvoiceHtml(invoiceId, options);
  await printHtml(html);
}

// Label printing (100mm x 15mm) — unrelated to the invoice slips, kept as is.
export async function printLabelsNative(html: string) {
  const Print = await import('expo-print');
  // 100mm x 15mm in PDF points (1mm = 2.8346pt)
  const { uri } = await Print.printToFileAsync({ html, width: 284, height: 43 });
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}