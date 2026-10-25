// src/lib/api/cashPurchases.ts

import { supabase } from '../supabaseClient';

// One old-gold / old-silver piece bought from the customer.
// Same maths as the old-gold exchange on the invoice (see lib/exchangeGold.ts):
//   net_weight = (gross - stone) x old% / 100
//   amount     = round(net_weight x rate_per_gram)
export interface PurchaseItem {
  id: string;
  name: string;
  metal_id: string | null;
  metal_name: string;
  purity_id: string | null;
  purity_name: string;
  gross_weight: number;
  stone_weight: number;
  old_percent: number;
  rate_per_gram: number;
  net_weight: number;
  amount: number;
  remark?: string | null;    // per-product remark (internal, never printed)
}

export interface CashPurchase {
  id: string;
  receipt_no: string;
  customer_name: string;
  phone: string | null;
  items: PurchaseItem[];
  total_amount: number;      // net (calculated)
  paid_amount: number;       // actually paid
  payment_mode: string;
  remarks: string | null;
  created_at: string;
}

export interface CreateCashPurchaseInput {
  receiptNo: string;
  customerName: string;
  phone: string;
  items: PurchaseItem[];
  totalAmount: number;       // net
  paidAmount: number;        // actually paid
  paymentMode: string;
  remarks: string;
}

function normalize(r: any): CashPurchase {
  return {
    ...r,
    items: (Array.isArray(r.items) ? r.items : []).map((i: any) => ({
      ...i,
      gross_weight: Number(i.gross_weight ?? 0),
      stone_weight: Number(i.stone_weight ?? 0),
      old_percent: Number(i.old_percent ?? 0),
      rate_per_gram: Number(i.rate_per_gram ?? 0),
      net_weight: Number(i.net_weight ?? 0),
      amount: Number(i.amount ?? 0),
      remark: i.remark ?? null,
    })),
    total_amount: Number(r.total_amount ?? 0),
    paid_amount: Number(r.paid_amount ?? r.total_amount ?? 0),
  };
}

export async function createCashPurchase(input: CreateCashPurchaseInput): Promise<CashPurchase> {
  const { data, error } = await supabase
    .from('cash_purchases')
    .insert({
      receipt_no: input.receiptNo,
      customer_name: input.customerName,
      phone: input.phone || null,
      items: input.items,
      total_amount: input.totalAmount,
      paid_amount: input.paidAmount,
      payment_mode: input.paymentMode,
      remarks: input.remarks || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return normalize(data);
}

export async function listCashPurchases(search?: string): Promise<CashPurchase[]> {
  let query = supabase
    .from('cash_purchases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const s = search?.trim().replace(/[,()%]/g, '');
  if (s) {
    query = query.or(`customer_name.ilike.%${s}%,receipt_no.ilike.%${s}%,phone.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalize);
}

export async function getCashPurchase(id: string): Promise<CashPurchase> {
  const { data, error } = await supabase.from('cash_purchases').select('*').eq('id', id).single();
  if (error) throw error;
  return normalize(data);
}

export async function deleteCashPurchases(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('cash_purchases').delete().in('id', ids);
  if (error) throw error;
}