// src\lib\api\customers.ts
import { supabase } from '../supabaseClient';
import type { Customer } from '../../types/invoices';
import type { OrderStatus } from './customerOrders';

export interface CustomerListItem extends Customer {
  address: string | null;
  gstin: string | null;
  latest_invoice_number?: string | null;
  latest_invoice_date?: string | null;
  latest_order_id?: string | null;
  latest_order_status?: OrderStatus | null;
  latest_order_metal?: string | null;
}

export interface ListCustomersParams {
  search?: string;
  /** ISO (YYYY-MM-DD) — only customers with an invoice on/after this date */
  fromDate?: string;
  /** ISO (YYYY-MM-DD) — only customers with an invoice on/before this date */
  toDate?: string;
}

function orderPriority(status?: OrderStatus | null): number {
  if (status === 'ready') return 0;
  if (status === 'pending') return 1;
  return 2; // completed or no order — falls back to normal invoice sorting
}

function invoiceSortValue(invoiceNumber: string | null | undefined): number | null {
  if (!invoiceNumber) return null;
  const matches = invoiceNumber.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return parseInt(matches[matches.length - 1], 10);
}

export function compareCustomerListItems(a: CustomerListItem, b: CustomerListItem): number {
  // Customers with an active jewel order (pending/ready) always float to the
  // top of the queue, ready before pending, ahead of everyone sorted by
  // invoice number. Once an order is completed it no longer gets priority.
  const aPri = orderPriority(a.latest_order_status);
  const bPri = orderPriority(b.latest_order_status);
  if (aPri !== bPri) return aPri - bPri;

  const aValue = invoiceSortValue(a.latest_invoice_number);
  const bValue = invoiceSortValue(b.latest_invoice_number);
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return bValue - aValue;
}

/**
 * Single round trip: the list_customers_rpc Postgres function returns each
 * customer together with their latest invoice and latest jewel order, and
 * applies the search + date filter server-side.
 * (See list_customers_rpc.sql for the function and indexes.)
 */
export async function listCustomers(params?: ListCustomersParams): Promise<CustomerListItem[]> {
  const { search, fromDate, toDate } = params ?? {};

  const { data, error } = await supabase.rpc('list_customers_rpc', {
    p_search: search?.trim() || null,
    p_from: fromDate ?? null,
    p_to: toDate ?? null,
  });
  if (error) throw error;

  return ((data ?? []) as CustomerListItem[]).slice().sort(compareCustomerListItems);
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