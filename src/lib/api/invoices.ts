//src/lib/api/invoices.ts

import { supabase } from '../supabaseClient';
import type { Metal, Purity, CalculationType } from '../../types/settings';
import type { Product, Customer, InvoiceItem, Invoice, InvoiceDetail } from '../../types/invoices';
import type { PaymentMode, PaymentSplitEntry } from '../../types/invoices';
import type { ExchangeItem, ExchangeItemDetail } from '../../types/invoices';


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------
// Products
// ---------------------------------------------------------

export interface ProductChargeRow {
  id: string;
  charge_type_id: string | null;
  charge_name: string;
  calculation_type: CalculationType;
  value: number;
  amount: number;
}

// One diamond size + amount row saved on the product (product_diamonds table).
export interface ProductDiamondRow {
  id: string;
  size: string;
  amount: number;
  sort_order: number;
}

export interface ProductWithCharges extends Product {
  product_value_added_charges?: ProductChargeRow[];
  product_diamonds?: ProductDiamondRow[];
  tax_setting_id?: string | null;
  tax_settings?: {
    id: string;
    tax_name: string;
    tax_percentage: number;
    cgst: number;
    sgst: number;
    igst: number;
  } | null;
}

export async function getProductByCode(rawCode: string): Promise<ProductWithCharges | null> {
  const code = rawCode.trim();
  if (!code) return null;

  const filters = [`product_code.eq.${code}`, `barcode.eq.${code}`, `sku.eq.${code}`];
  if (UUID_RE.test(code)) filters.push(`id.eq.${code}`);

  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      product_value_added_charges(id, charge_type_id, charge_name, calculation_type, value, amount),
      product_diamonds(id, size, amount, sort_order),
      tax_settings(id, tax_name, tax_percentage, cgst, sgst, igst)
    `)
    .or(filters.join(','))
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function sanitizeForOrFilter(s: string): string {
  return s.replace(/[,()]/g, '');
}

export async function searchProducts(query: string): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];
  const safe = q.replace(/[,()]/g, '');
  if (!safe) return [];

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .or(`product_code.ilike.%${safe}%,product_name.ilike.%${safe}%,sku.ilike.%${safe}%`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------
// Rates / making charges / tax
// ---------------------------------------------------------

export async function getCurrentRate(metalId: string, purityId: string): Promise<number> {
  const { data, error } = await supabase
    .from('current_metal_rates')
    .select('rate_per_gram')
    .eq('metal_id', metalId)
    .eq('purity_id', purityId)
    .maybeSingle();
  if (error) throw error;
  return data?.rate_per_gram ?? 0;
}

export async function getMakingChargeRule(metalId: string, purityId: string, categoryId: string | null) {
  let query = supabase
    .from('making_charge_rules')
    .select('*')
    .eq('metal_id', metalId)
    .eq('is_active', true)
    .or(`purity_id.eq.${purityId},purity_id.is.null`);

  query = categoryId
    ? query.or(`category_id.eq.${categoryId},category_id.is.null`)
    : query.is('category_id', null);

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return null;
  return data.sort(
    (a, b) => Number(!!b.purity_id && !!b.category_id) - Number(!!a.purity_id && !!a.category_id)
  )[0];
}

export async function getDefaultTaxSetting() {
  const { data, error } = await supabase
    .from('tax_settings')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------
// Customers
// ---------------------------------------------------------

export async function searchCustomers(query: string): Promise<Customer[]> {
  if (!query.trim()) {
    const { data, error } = await supabase.from('customers').select('id, name, phone:mobile, email').order('name').limit(20);
    if (error) throw error;
    return data ?? [];
  }
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone:mobile, email')
    .or(`name.ilike.%${query}%,mobile.ilike.%${query}%`)
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function findOrCreateCustomer(input: { name: string; phone: string | null }): Promise<Customer | null> {
  if (!input.name.trim()) return null;
  const { data, error } = await supabase.rpc('find_or_create_customer', {
    p_name: input.name,
    p_mobile: input.phone,
  });
  if (error) throw error;
  return data ? { ...data, phone: data.mobile } : null;
}

// ---------------------------------------------------------
// Invoice creation
// ---------------------------------------------------------

export interface CreateInvoiceInput {
  customerId: string | null;
  customerName: string;
  customerMobile: string | null;
  items: InvoiceItem[];
  metals: Metal[];
  purities: Purity[];
  subtotal: number;
  invoiceDiscount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  makingTotal: number;
  vaChargesTotal: number;
  paymentSplits: PaymentSplitEntry[];
  exchangeItems: ExchangeItem[];
  exchangeTotal: number;
  remark: string; // NEW — mandatory internal-reference note
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

export function computePaymentStatus(paidAmount: number, balanceAmount: number): PaymentStatus {
  if (balanceAmount <= 0) return 'paid';
  if (paidAmount > 0) return 'partial';
  return 'unpaid';
}

// A single legacy `payment_mode` still gets stored on the invoice header
// (existing screens/reports read it) — 'split' signals "see payment_splits
// for the real breakdown" rather than picking one mode arbitrarily.
function derivePaymentMode(splits: PaymentSplitEntry[]): PaymentMode {
  if (splits.length === 0) return 'cash';
  if (splits.length === 1) return splits[0].mode;
  return 'split';
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const metalName = (id: string | null) => input.metals.find((m) => m.id === id)?.name ?? 'Unknown';
  const purityName = (id: string | null) => input.purities.find((p) => p.id === id)?.name ?? 'Unknown';

  const items = input.items.map((item) => ({
    product_id: item.product_id,
    product_name: item.name,
    product_code: item.product_code,
    metal_name: metalName(item.metal_id),
    purity_name: purityName(item.purity_id),
    quantity: item.quantity,
    gross_weight: item.gross_weight,
    stone_weight: item.stone_weight,
    net_weight: item.net_weight,
    metal_rate: item.metal_rate,
    metal_value: item.metal_value,
    making_charge_type: item.making_charge_type,
    making_charge_value: item.making_charge_value,
    making_charge_amount: item.making_charge_amount,
    value_added_total: item.value_added_charges.reduce((s, c) => s + c.amount, 0),
    discount: item.item_discount,
    tax_amount: item.tax_amount,
    total: item.total_amount,
    // Includes the "Diamond <size>" lines, so diamonds are saved with the invoice.
    value_added_charges: item.value_added_charges.map((c) => ({
      charge_name: c.name,
      calculation_type: c.calculation_type,
      value: c.value,
      amount: c.amount,
    })),
  }));

  const charges = [
    input.makingTotal > 0 && { charge_name: 'Making Charges', amount: input.makingTotal },
    input.vaChargesTotal > 0 && { charge_name: 'Value Added Charges', amount: input.vaChargesTotal },
    input.cgstTotal > 0 && { charge_name: 'CGST', amount: input.cgstTotal },
    input.sgstTotal > 0 && { charge_name: 'SGST', amount: input.sgstTotal },
    input.igstTotal > 0 && { charge_name: 'IGST', amount: input.igstTotal },
  ].filter(Boolean);

  const exchange_items = input.exchangeItems.map((e) => ({
    description: e.description,
    gross_weight: e.gross_weight,
    stone_weight: e.stone_weight,
    purity_id: e.purity_id,
    purity_percent: e.purity_percent,
    old_percent: e.old_percent,
    deduction_percent: e.deduction_percent,
    rate_per_gram: e.rate_per_gram,
    net_weight: e.net_weight,
    amount: e.amount,
  }));

  const payment_splits = input.paymentSplits
    .filter((s) => s.amount > 0)
    .map((s) => ({
      payment_mode: s.mode,
      amount: s.amount,
      reference: s.reference ?? null,
    }));

  const paymentStatus = computePaymentStatus(input.paidAmount, input.balanceAmount);
  void paymentStatus;

  const { data, error } = await supabase.rpc('create_invoice_with_items', {
    p_customer_id: input.customerId,
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_items: items,
    p_charges: charges,
    p_subtotal: input.subtotal,
    p_invoice_discount: input.invoiceDiscount,
    p_tax_amount: input.taxAmount,
    p_grand_total: input.grandTotal,
    p_paid_amount: input.paidAmount,
    p_balance_amount: input.balanceAmount,
    p_payment_mode: derivePaymentMode(input.paymentSplits),
    p_payment_splits: payment_splits,
    p_exchange_items: exchange_items,
    p_exchange_total: input.exchangeTotal,
    // NEW — this requires a matching `p_remark text default null` parameter
    // on the create_invoice_with_items RPC, and a `remark` column on
    // `invoices`, before it actually persists.
    p_remark: input.remark.trim(),
  });

  if (error) throw error;
  return data as Invoice;
}

// ---------------------------------------------------------
// Fetch a single invoice
// ---------------------------------------------------------

export async function getInvoiceById(invoiceId: string): Promise<InvoiceDetail> {
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('*, customer:customers(name, mobile, address, gstin)')
    .eq('id', invoiceId)
    .single();
  if (invErr) throw invErr;

  const { data: items, error: itemsErr } = await supabase
    .from('invoice_items')
    .select('*, value_added_charges:invoice_item_value_added_charges(*)')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (itemsErr) throw itemsErr;

  const { data: charges, error: chargesErr } = await supabase
    .from('invoice_charges')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (chargesErr) throw chargesErr;

  const { data: exchangeItems, error: exchangeErr } = await supabase
    .from('invoice_exchange_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });

  console.log('[getInvoiceById] invoiceId:', invoiceId);
  console.log('[getInvoiceById] exchangeItems:', JSON.stringify(exchangeItems));
  console.log('[getInvoiceById] exchangeErr:', exchangeErr);

  if (exchangeErr) throw exchangeErr;

  // Per-mode payment breakdown. If the table isn't available, this is
  // wrapped instead of thrown, and the screen falls back to the single
  // `payment_mode`/`paid_amount` fields.
  let paymentSplits: PaymentSplitEntry[] = [];
  try {
    const { data: splitRows, error: splitsErr } = await supabase
      .from('invoice_payment_splits')
      .select('id, payment_mode, amount, reference')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true });
    if (splitsErr) throw splitsErr;
    paymentSplits = (splitRows ?? []).map((r: any) => ({
      id: r.id,
      mode: r.payment_mode,
      amount: r.amount,
      reference: r.reference ?? null,
    }));
  } catch (e) {
    console.warn('[getInvoiceById] invoice_payment_splits not available yet:', e);
  }

  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    customer_id: invoice.customer_id,
    customer_name: invoice.customer?.name ?? 'Walk-in Customer',
    customer_mobile: invoice.customer?.mobile ?? null,
    customer_address: invoice.customer?.address ?? null,
    customer_gstin: invoice.customer?.gstin ?? null,
    subtotal: invoice.subtotal,
    invoice_discount: invoice.invoice_discount,
    tax_amount: invoice.tax_amount,
    grand_total: invoice.grand_total,
    paid_amount: invoice.paid_amount,
    balance_amount: invoice.balance_amount,
    payment_status: invoice.payment_status,
    status: invoice.status,
    items: items ?? [],
    charges: charges ?? [],
    created_at: invoice.created_at,
    exchange_total: invoice.exchange_total ?? 0,
    exchange_items: (exchangeItems ?? []) as ExchangeItemDetail[],
    payment_splits: paymentSplits,
    remark: invoice.remark ?? null,
  };
}

// ---------------------------------------------------------
// Invoice list (server-side pagination + search)
// Requires the `invoice_list_view` view and indexes from the SQL step.
// ---------------------------------------------------------

export interface InvoiceListItem {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
  balance_amount: number;
  payment_status: string;
  payment_mode: string;
  status: string;
  customer_name: string;
}

export interface ListInvoicesParams {
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number; // 1-based
  pageSize?: number;
}

export interface ListInvoicesResult {
  rows: InvoiceListItem[];
  hasMore: boolean;
}

export async function listInvoices(params: ListInvoicesParams = {}): Promise<ListInvoicesResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 15;
  const from = (page - 1) * pageSize;

  let query = supabase
    .from('invoice_list_view')
    .select(
      'id, invoice_number, invoice_date, grand_total, balance_amount, payment_status, payment_mode, status, customer_name'
    )
    .order('created_at', { ascending: false })
    .range(from, from + pageSize); // pageSize + 1 rows, to detect a next page

  if (params.fromDate) query = query.gte('invoice_date', params.fromDate);
  if (params.toDate) query = query.lte('invoice_date', params.toDate);

  const s = params.search?.trim().replace(/[,()%]/g, '');
  if (s) {
    query = query.or(`invoice_number.ilike.%${s}%,customer_name.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const all = (data ?? []) as InvoiceListItem[];
  return { rows: all.slice(0, pageSize), hasMore: all.length > pageSize };
}

// ---------------------------------------------------------
// Dashboard
// ---------------------------------------------------------

export interface DashboardSummary {
  todaySales: number;
  todayInvoices: number;
  totalCustomers: number;
  totalProducts: number;
  pendingPayments: number;
  todayCollection: number;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const today = new Date().toISOString().slice(0, 10);

  const [todayInvoicesRes, customersRes, productsRes, pendingRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('grand_total, paid_amount', { count: 'exact' })
      .eq('invoice_date', today),
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    supabase.from('products').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('invoices').select('balance_amount'),
  ]);

  if (todayInvoicesRes.error) throw todayInvoicesRes.error;
  if (customersRes.error) throw customersRes.error;
  if (productsRes.error) throw productsRes.error;
  if (pendingRes.error) throw pendingRes.error;

  const todaySales = (todayInvoicesRes.data ?? []).reduce((s, r) => s + (r.grand_total ?? 0), 0);
  const todayCollection = (todayInvoicesRes.data ?? []).reduce((s, r) => s + (r.paid_amount ?? 0), 0);
  const pendingPayments = (pendingRes.data ?? []).reduce((s, r) => s + (r.balance_amount ?? 0), 0);

  return {
    todaySales,
    todayInvoices: todayInvoicesRes.count ?? 0,
    totalCustomers: customersRes.count ?? 0,
    totalProducts: productsRes.count ?? 0,
    pendingPayments,
    todayCollection,
  };
}