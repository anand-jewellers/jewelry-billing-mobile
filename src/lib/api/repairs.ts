// src/lib/api/repairs.ts

import { supabase } from '../supabaseClient';
import { generateRepairReceiptNo } from '../repairReceipt';

export interface RepairOrder {
  id: string;
  receipt_no: string;
  customer_name: string;
  phone: string | null;
  item: string;
  weight: number | null;
  charge: number;
  advance: number;
  remarks: string | null;
  status: string; // 'received' | 'ready' | 'delivered'
  created_at: string;
  ready_at: string | null; // when the jewel was marked ready
  final_payment: number; // balance collected on delivery
  final_payment_mode: string | null;
  delivered_at: string | null;
}

export interface CreateRepairInput {
  receiptNo: string;
  customerName: string;
  phone: string;
  item: string;
  weight: number | null;
  charge: number;
  advance: number;
  remarks: string;
}

// numeric columns can come back as strings, so normalise them
function normalize(r: any): RepairOrder {
  return {
    ...r,
    weight: r.weight == null ? null : Number(r.weight),
    charge: Number(r.charge ?? 0),
    advance: Number(r.advance ?? 0),
    final_payment: Number(r.final_payment ?? 0),
    final_payment_mode: r.final_payment_mode ?? null,
    ready_at: r.ready_at ?? null,
    delivered_at: r.delivered_at ?? null,
  };
}

// Next free receipt number for the day, e.g. REP-002-251026
export async function getNextRepairReceiptNo(d: Date = new Date()): Promise<string> {
  const datePart = generateRepairReceiptNo(d, 1).split('-').pop(); // "251026"
  const { data, error } = await supabase
    .from('repair_orders')
    .select('receipt_no')
    .like('receipt_no', `%-${datePart}`);
  if (error) throw error;

  let max = 0;
  for (const r of data ?? []) {
    const seq = parseInt(String(r.receipt_no).split('-')[1], 10);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return generateRepairReceiptNo(d, max + 1);
}


export async function createRepairOrder(input: CreateRepairInput): Promise<RepairOrder> {
  const { data, error } = await supabase
    .from('repair_orders')
    .insert({
      receipt_no: input.receiptNo,
      customer_name: input.customerName,
      phone: input.phone || null,
      item: input.item,
      weight: input.weight,
      charge: input.charge,
      advance: input.advance,
      remarks: input.remarks || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return normalize(data);
}

export async function listRepairOrders(search?: string): Promise<RepairOrder[]> {
  let query = supabase
    .from('repair_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const s = search?.trim().replace(/[,()%]/g, '');
  if (s) {
    query = query.or(
      `customer_name.ilike.%${s}%,receipt_no.ilike.%${s}%,phone.ilike.%${s}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalize);
}

export async function getRepairOrder(id: string): Promise<RepairOrder> {
  const { data, error } = await supabase.from('repair_orders').select('*').eq('id', id).single();
  if (error) throw error;
  return normalize(data);
}

export async function deleteRepairOrder(id: string): Promise<void> {
  const { error } = await supabase.from('repair_orders').delete().eq('id', id);
  if (error) throw error;
}

// Jewel is repaired and waiting for the customer to collect it.
export async function markRepairReady(id: string): Promise<RepairOrder> {
  const { data, error } = await supabase
    .from('repair_orders')
    .update({
      status: 'ready',
      ready_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'received') // only from "received" (never from ready/delivered)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This repair is already marked ready or delivered.');
  return normalize(data);
}

// Customer came back: collect the balance (if any) and hand over the jewel.
// Works from both "received" and "ready".
export async function deliverRepairOrder(
  id: string,
  input: { amount: number; mode: string | null }
): Promise<RepairOrder> {
  const { data, error } = await supabase
    .from('repair_orders')
    .update({
      status: 'delivered',
      final_payment: input.amount,
      final_payment_mode: input.amount > 0 ? input.mode : null,
      delivered_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['received', 'ready']) // never deliver twice (e.g. from another device)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This repair was already delivered.');
  return normalize(data);
}

// Admin bulk delete (Invoices page -> Repairs tab -> Delete)
export async function deleteRepairOrders(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('repair_orders').delete().in('id', ids);
  if (error) throw error;
}

// Number of repairs still with us (received or ready, not yet delivered)
export async function countPendingRepairs(): Promise<number> {
  const { count, error } = await supabase
    .from('repair_orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['received', 'ready']);
  if (error) throw error;
  return count ?? 0;
}