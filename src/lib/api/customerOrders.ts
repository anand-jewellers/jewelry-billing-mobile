// src/lib/api/customerOrders.ts

import { supabase } from '../supabaseClient';

export type OrderStatus = 'pending' | 'ready' | 'completed';

export interface CustomerOrder {
  id: string;
  order_number: string;
  customer_id: string;
  category: string;
  metal: string;
  purity: string;
  weight_min: number;
  weight_max: number;
  stone_weight: number | null;
  stone_name: string | null;
  notes: string | null;
  due_date: string | null; // 'YYYY-MM-DD'
  status: OrderStatus;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerOrderInput {
  customer_id: string;
  category: string;
  metal: string;
  purity: string;
  weight_min: number;
  weight_max: number;
  stone_weight?: number | null;
  stone_name?: string | null;
  notes?: string | null;
  due_date?: string | null; // 'YYYY-MM-DD'
}

export async function createCustomerOrder(input: CreateCustomerOrderInput): Promise<CustomerOrder> {
  const { data, error } = await supabase
    .from('customer_orders')
    .insert({
      customer_id: input.customer_id,
      category: input.category.trim(),
      metal: input.metal.trim(),
      purity: input.purity.trim(),
      weight_min: input.weight_min,
      weight_max: input.weight_max,
      stone_weight: input.stone_weight ?? null,
      stone_name: input.stone_name?.trim() || null,
      notes: input.notes?.trim() || null,
      due_date: input.due_date || null,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerOrder;
}

export async function listCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  const { data, error } = await supabase
    .from('customer_orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCustomerOrderById(orderId: string): Promise<CustomerOrder> {
  const { data, error } = await supabase
    .from('customer_orders')
    .select('*')
    .eq('id', orderId)
    .single();
  if (error) throw error;
  return data as CustomerOrder;
}

export async function updateCustomerOrderStatus(orderId: string, status: OrderStatus): Promise<CustomerOrder> {
  const { data, error } = await supabase
    .from('customer_orders')
    .update({ status })
    .eq('id', orderId)
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerOrder;
}

/**
 * Called once an invoice has actually been saved for this order — links the
 * invoice and flips status to 'completed' in one step, so an order never
 * silently ends up "completed" without a real invoice behind it.
 */
export async function completeCustomerOrderWithInvoice(
  orderId: string,
  invoiceId: string
): Promise<CustomerOrder> {
  const { data, error } = await supabase
    .from('customer_orders')
    .update({ status: 'completed', invoice_id: invoiceId })
    .eq('id', orderId)
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerOrder;
}

/** Live updates for every order belonging to a customer (used on the customer detail screen). */
export function subscribeToCustomerOrders(
  customerId: string,
  onChange: (order: CustomerOrder, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
): () => void {
  const channel = supabase
    .channel(`customer_orders:${customerId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_id=eq.${customerId}` },
      (payload) => {
        const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
        const row = (eventType === 'DELETE' ? payload.old : payload.new) as CustomerOrder;
        onChange(row, eventType);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

/** Live status updates for a single order (used on the order detail screen). */
export function subscribeToOrderStatus(orderId: string, onChange: (order: CustomerOrder) => void): () => void {
  const channel = supabase
    .channel(`customer_order:${orderId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'customer_orders', filter: `id=eq.${orderId}` },
      (payload) => onChange(payload.new as CustomerOrder)
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}