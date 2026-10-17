// src/lib/api/customerOrders.ts

import { supabase } from '../supabaseClient';

export type OrderStatus = 'pending' | 'ready' | 'completed';

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const ORDER_IMAGE_BUCKET = 'order-images';

export interface CustomerOrder {
  id: string;
  order_number: string;
  customer_id: string;
  category: string;
  metal: string;
  purity: string;
  weight_min: number;
  weight_max: number | null; // optional now
  stone_weight: number | null;
  stone_name: string | null; // no longer collected on the form, kept for old orders
  notes: string | null;
  due_date: string | null; // 'YYYY-MM-DD'
  vac_percent: number | null;
  making_charge: number | null;
  stone_charge: number | null;
  reference_images: string[];
  goldsmith_name: string | null;
  goldsmith_phone: string | null;
  advance_amount: number | null;
  payment_mode: PaymentMode | null;
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
  weight_max?: number | null;
  stone_weight?: number | null;
  stone_name?: string | null;
  notes?: string | null;
  due_date?: string | null; // 'YYYY-MM-DD'
  vac_percent?: number | null;
  making_charge?: number | null;
  stone_charge?: number | null;
  goldsmith_name?: string | null;
  goldsmith_phone?: string | null;
  advance_amount?: number | null;
  payment_mode?: PaymentMode | null;
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
      weight_max: input.weight_max ?? null,
      stone_weight: input.stone_weight ?? null,
      stone_name: input.stone_name?.trim() || null,
      notes: input.notes?.trim() || null,
      due_date: input.due_date || null,
      vac_percent: input.vac_percent ?? null,
      making_charge: input.making_charge ?? null,
      stone_charge: input.stone_charge ?? null,
      goldsmith_name: input.goldsmith_name?.trim() || null,
      goldsmith_phone: input.goldsmith_phone?.trim() || null,
      advance_amount: input.advance_amount ?? null,
      payment_mode: input.payment_mode ?? null,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerOrder;
}

// ---------------------------------------------------------
// Reference pictures
// ---------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c !== -1) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/** Uploads picked images to storage and saves their paths on the order. */
export async function attachOrderReferenceImages(
  orderId: string,
  images: { base64: string }[]
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const path = `${orderId}/${Date.now()}_${i}.jpg`;
    const { error } = await supabase.storage
      .from(ORDER_IMAGE_BUCKET)
      .upload(path, base64ToBytes(images[i].base64), { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    paths.push(path);
  }

  if (paths.length) {
    const { data, error } = await supabase
      .from('customer_orders')
      .update({ reference_images: paths })
      .eq('id', orderId)
      .select('id');
    if (error) throw error;
    if (!data?.length) {
      throw new Error('Could not save image paths on the order (check update policy).');
    }
  }
  return paths;
}

export function getOrderImageUrl(path: string): string {
  return supabase.storage.from(ORDER_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------

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


// Number of customer orders not yet completed (pending + ready)
export async function countOpenOrders(): Promise<number> {
  const { count, error } = await supabase
    .from('customer_orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'ready']);
  if (error) throw error;
  return count ?? 0;
}

export interface OrderWithCustomer extends CustomerOrder {
  customer: { name: string; phone: string | null } | null;
}

// All open orders (pending + ready), soonest due date first
export async function listOpenOrders(): Promise<OrderWithCustomer[]> {
  const { data, error } = await supabase
    .from('customer_orders')
    .select('*, customer:customers(name, phone)')
    .in('status', ['pending', 'ready'])
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as OrderWithCustomer[];
}