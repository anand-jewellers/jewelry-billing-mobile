// src/lib/heldEstimates.ts
//
// Held estimates are stored in Supabase (table: held_estimates) so every
// device sees the same list. The 4-hour expiry is decided by the server.

import { supabase } from './supabaseClient';
import type { InvoiceItem, ExchangeItem, PaymentMode } from '../types/invoices';

export const HOLD_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (display only; server enforces it)

export interface HeldEstimateData {
  customerName: string;
  customerPhone: string;
  remark: string;
  resolvedCustomerId: string | null;
  items: InvoiceItem[];
  exchangeItems: ExchangeItem[];
  exchangeTotal: number;
  discountAmount: string;
  paymentSplits: { id: string; mode: PaymentMode | ''; amountText: string }[];
  paymentSplitsTouched: boolean;
  stage: 'building' | 'estimate';
}

export interface HeldEstimate {
  id: string;
  label: string;        // customer name shown in the list
  grandTotal: number;   // net amount shown in the list
  savedAt: number;
  expiresAt: number;
  // Set once the final invoice has been made from this estimate.
  // A billed estimate opens read-only (print only).
  billedInvoiceId?: string | null;
  billedInvoiceNumber?: string | null;
  data: HeldEstimateData;
}

function mapRow(r: any): HeldEstimate {
  return {
    id: r.id,
    label: r.label,
    grandTotal: Number(r.grand_total) || 0,
    savedAt: Date.parse(r.saved_at),
    expiresAt: Date.parse(r.expires_at),
    billedInvoiceId: r.billed_invoice_id ?? null,
    billedInvoiceNumber: r.billed_invoice_number ?? null,
    data: r.data as HeldEstimateData,
  };
}

// Returns only live estimates. The database also deletes expired rows
// each time this is called.
export async function listHeldEstimates(): Promise<HeldEstimate[]> {
  const { data, error } = await supabase.rpc('list_held_estimates');
  if (error) throw error;
  return ((data ?? []) as any[]).map(mapRow);
}

export async function getHeldEstimate(id: string): Promise<HeldEstimate | null> {
  const all = await listHeldEstimates();
  return all.find((h) => h.id === id) ?? null;
}

// Pass an existing id to update that entry.
// keepExpiry = true  -> the original 4-hour deadline is kept (final bill).
// keepExpiry = false -> the 4-hour timer restarts.
export async function saveHeldEstimate(input: {
  id?: string | null;
  label: string;
  grandTotal: number;
  data: HeldEstimateData;
  keepExpiry?: boolean;
  billedInvoiceId?: string | null;
  billedInvoiceNumber?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('save_held_estimate', {
    p_id: input.id ?? null,
    p_label: input.label,
    p_grand_total: input.grandTotal,
    p_data: input.data,
    p_keep_expiry: input.keepExpiry ?? false,
    p_billed_invoice_id: input.billedInvoiceId ?? null,
    p_billed_invoice_number: input.billedInvoiceNumber ?? null,
  });
  if (error) throw error;
  return (data as any).id as string;
}

export async function deleteHeldEstimate(id: string) {
  const { error } = await supabase.from('held_estimates').delete().eq('id', id);
  if (error) throw error;
}

// Deletes every held bill for ALL devices.
export async function deleteAllHeldEstimates() {
  const { error } = await supabase.from('held_estimates').delete().not('id', 'is', null);
  if (error) throw error;
}

export function timeLeftText(expiresAt: number): string {
  const ms = Math.max(0, expiresAt - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}