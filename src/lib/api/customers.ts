import { supabase } from '../supabaseClient';
import type { Customer } from '../../types/invoices';

export interface CustomerListItem extends Customer {
  address: string | null;
  gstin: string | null;
  latest_invoice_number?: string | null;
  latest_invoice_date?: string | null;
}

export async function listCustomers(query?: string): Promise<CustomerListItem[]> {
  let q = supabase
    .from('customers')
    .select('id, name, phone:mobile, email, address, gstin')
    .order('name');

  if (query?.trim()) {
    q = q.or(`name.ilike.%${query}%,mobile.ilike.%${query}%`);
  }

  const { data: customers, error } = await q;
  if (error) throw error;
  if (!customers?.length) return [];

  // Fetch every invoice for the visible customers in one shot, newest first,
  // then keep only the first (latest) one we see per customer.
  const ids = customers.map((c) => c.id);
  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('customer_id, invoice_number, invoice_date')
    .in('customer_id', ids)
    .order('invoice_date', { ascending: false });
  if (invErr) throw invErr;

  const latestByCustomer = new Map<string, { invoice_number: string; invoice_date: string }>();
  for (const inv of invoices ?? []) {
    if (!latestByCustomer.has(inv.customer_id)) {
      latestByCustomer.set(inv.customer_id, {
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
      });
    }
  }

  return customers.map((c) => ({
    ...c,
    latest_invoice_number: latestByCustomer.get(c.id)?.invoice_number ?? null,
    latest_invoice_date: latestByCustomer.get(c.id)?.invoice_date ?? null,
  })) as CustomerListItem[];
}

export async function getCustomerById(id: string): Promise<CustomerListItem> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone:mobile, email, address, gstin')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as CustomerListItem;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
}

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerListItem> {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      name: input.name.trim(),
      mobile: input.phone.trim(),
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      gstin: input.gstin?.trim() || null,
    })
    .select('id, name, phone:mobile, email, address, gstin')
    .single();
  if (error) throw error;
  return data as CustomerListItem;
}

export interface CustomerInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
  balance_amount: number;
  payment_status: string;
  status: string;
}

export async function getCustomerInvoices(customerId: string): Promise<CustomerInvoiceRow[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, grand_total, balance_amount, payment_status, status')
    .eq('customer_id', customerId)
    .order('invoice_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}