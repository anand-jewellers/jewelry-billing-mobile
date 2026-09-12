import { supabase } from '../supabaseClient';
// import type { Product, Customer, InvoiceItem, Invoice } from '../../types/invoices';
import type { Metal, Purity } from '../../types/settings';
import type { Product, Customer, InvoiceItem, Invoice, InvoiceDetail } from '../../types/invoices';
import type { PaymentMode } from '../../types/invoices';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------
// Products
// ---------------------------------------------------------

export async function getProductByCode(rawCode: string): Promise<Product | null> {
  const code = rawCode.trim();
  if (!code) return null;

  const filters = [`product_code.eq.${code}`, `barcode.eq.${code}`, `sku.eq.${code}`];
  if (UUID_RE.test(code)) filters.push(`id.eq.${code}`);

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .or(filters.join(','))
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function searchProducts(query: string): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .or(`product_code.ilike.%${q}%,product_name.ilike.%${q}%,sku.ilike.%${q}%`)
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
  const { data, error } = await supabase
    .from('making_charge_rules')
    .select('*')
    .eq('metal_id', metalId)
    .eq('is_active', true)
    .or(`purity_id.eq.${purityId},purity_id.is.null`)
    .or(`category_id.eq.${categoryId ?? 'null'},category_id.is.null`);
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

// Used by the Customer Picker sheet, if you have one, when the user selects
// an existing customer directly. NOT used by the invoice save flow itself —
// createInvoice() below resolves/creates the customer server-side instead.
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
  paymentMode: PaymentMode;   // NEW
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

/**
 * FIX: previously payment_status was left entirely up to the
 * create_invoice_with_items RPC to infer from paid_amount/balance_amount.
 * If paid_amount ever arrives as 0 (e.g. because the UI's amountPaid field
 * was empty), the invoice silently gets marked "unpaid" even when the
 * cashier believed they billed it as fully paid. Computing and passing this
 * explicitly from the client makes the status transparent and lets you
 * assert on it in tests, and gives the RPC an authoritative value to store
 * (or to validate against) rather than re-deriving it.
 */
export function computePaymentStatus(paidAmount: number, balanceAmount: number): PaymentStatus {
  if (balanceAmount <= 0) return 'paid';
  if (paidAmount > 0) return 'partial';
  return 'unpaid';
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

  // NOTE: payment_status / status are now derived server-side inside
  // create_invoice_with_items (from p_paid_amount / p_balance_amount), so
  // they are intentionally NOT passed as RPC params here. Supabase/PostgREST
  // matches functions by exact parameter signature — sending an extra
  // p_payment_status param that the deployed function doesn't declare
  // produces a "Could not find the function ... in the schema cache" error.
  // computePaymentStatus() is kept below only as a client-side helper (e.g.
  // for optimistic UI), not for sending to the RPC.
  const paymentStatus = computePaymentStatus(input.paidAmount, input.balanceAmount);
  void paymentStatus; // available to callers if needed; not sent to the RPC

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
    p_payment_mode: input.paymentMode,   // NEW
  });

  if (error) throw error;
  return data as Invoice;
}

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
  };
}

export interface InvoiceListItem {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
  balance_amount: number;
  payment_status: string;
  payment_mode: string;   // NEW
  status: string;
  customer_name: string;
}

export interface ListInvoicesParams {
  search?: string;     // matches invoice_number or customer name
  fromDate?: string;   // 'YYYY-MM-DD', inclusive
  toDate?: string;     // 'YYYY-MM-DD', inclusive
}

export async function listInvoices(params: ListInvoicesParams = {}): Promise<InvoiceListItem[]> {
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, grand_total, balance_amount, payment_status, payment_mode, status, customer:customers(name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (params.fromDate) query = query.gte('invoice_date', params.fromDate);
  if (params.toDate) query = query.lte('invoice_date', params.toDate);
  if (params.search?.trim()) {
    query = query.ilike('invoice_number', `%${params.search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data ?? []).map((row: any) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    grand_total: row.grand_total,
    balance_amount: row.balance_amount,
    payment_status: row.payment_status,
    payment_mode: row.payment_mode,   // NEW — was missing
    status: row.status,
    customer_name: row.customer?.name ?? 'Walk-in Customer',
  }));

  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    if (!rows.some((r) => r.invoice_number.toLowerCase().includes(needle))) {
      let nameQuery = supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, grand_total, balance_amount, payment_status, payment_mode, status, customer:customers(name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (params.fromDate) nameQuery = nameQuery.gte('invoice_date', params.fromDate);
      if (params.toDate) nameQuery = nameQuery.lte('invoice_date', params.toDate);
      const { data: nameData, error: nameErr } = await nameQuery;
      if (nameErr) throw nameErr;
      rows = (nameData ?? [])
        .map((row: any) => ({
          id: row.id,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          grand_total: row.grand_total,
          balance_amount: row.balance_amount,
          payment_status: row.payment_status,
          payment_mode: row.payment_mode,   // NEW — was missing
          status: row.status,
          customer_name: row.customer?.name ?? 'Walk-in Customer',
        }))
        .filter((r) => r.customer_name.toLowerCase().includes(needle));
    }
  }

  return rows;
}

export interface DashboardSummary {
  todaySales: number;
  todayInvoices: number;
  totalCustomers: number;
  totalProducts: number;
  pendingPayments: number;
  todayCollection: number;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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