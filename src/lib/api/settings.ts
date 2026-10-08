// src\lib\api\settings.ts

import { supabase } from '../supabaseClient';
import type {
  CompanySettings,
  Metal,
  Purity,
  CurrentMetalRate,
  Category,
  Subcategory,
  MakingChargeRule,
  ValueAddedChargeType,
  TaxSetting,
  InvoiceSettings,
  StoneName,
  CalculationType,
} from '../../types/settings';

// ---------- Single-row tables: helpers ----------
// company_settings and invoice_settings each hold exactly one row (id = 1).
// On a brand-new database that row doesn't exist yet, and a plain
// .update().eq('id', 1) silently changes 0 rows (no error). These helpers
// create the row from the app the first time it is needed, and make a
// zero-row update fail loudly instead of showing a false "Saved".

type SingleRowTable = 'company_settings' | 'invoice_settings';

/** Fetch row id=1. If missing, try to create it (race-safe), then re-read. */
async function fetchOrCreateSingleRow(
  table: SingleRowTable,
  insertDefaults: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> {
  const first = await supabase.from(table).select('*').eq('id', 1).maybeSingle();
  if (first.error) throw first.error;
  if (first.data) return first.data as Record<string, unknown>;

  // ON CONFLICT DO NOTHING: safe if two devices try at the same moment.
  // The insert may be refused by RLS for non-admin users; that is not fatal
  // here, the caller decides what to do when nothing could be created.
  const { error: insertError } = await supabase
    .from(table)
    .upsert({ id: 1, ...insertDefaults }, { onConflict: 'id', ignoreDuplicates: true });
  if (insertError) {
    console.warn(`Could not create default ${table} row:`, insertError.message);
  }

  const second = await supabase.from(table).select('*').eq('id', 1).maybeSingle();
  if (second.error) throw second.error;
  return (second.data as Record<string, unknown> | null) ?? null;
}

/** Update row id=1; if it doesn't exist yet, insert it instead. */
async function updateOrCreateSingleRow(
  table: SingleRowTable,
  patch: Record<string, unknown>,
  insertDefaults: Record<string, unknown> = {}
) {
  const { data, error } = await supabase.from(table).update(patch).eq('id', 1).select('id');
  if (error) throw error;
  if (data && data.length > 0) return; // updated an existing row

  // Zero rows updated: the row is missing (or RLS hid it). Try to create it.
  // If the row exists but RLS blocked the update, this insert fails too
  // (duplicate key / permission), so the user sees an error, not a false "Saved".
  const { error: insertError } = await supabase
    .from(table)
    .insert({ id: 1, ...insertDefaults, ...patch });
  if (insertError) throw insertError;
}

// ---------- Company Settings (single row) ----------
const COMPANY_DEFAULTS = {
  company_name: '',
  logo_url: null,
  address: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  website: '',
};

export async function getCompanySettings(): Promise<CompanySettings> {
  // Only company_name is sent on insert; other columns use the table defaults (null).
  const row = await fetchOrCreateSingleRow('company_settings', { company_name: '' });
  // If no row exists and this user couldn't create one (e.g. the login screen,
  // before sign-in), fall back to empty values so the app still renders.
  return { ...COMPANY_DEFAULTS, id: 1, ...(row ?? {}) } as unknown as CompanySettings;
}

export async function updateCompanySettings(patch: Partial<CompanySettings>) {
  await updateOrCreateSingleRow('company_settings', patch as Record<string, unknown>, {
    company_name: '',
  });
}

// ---------- Metals ----------
export async function listMetals(): Promise<Metal[]> {
  const { data, error } = await supabase.from('metals').select('*').order('name');
  if (error) throw error;
  return data as Metal[];
}

export async function createMetal(input: { name: string; code: string; type: Metal['type'] }) {
  const { error } = await supabase.from('metals').insert(input);
  if (error) throw error;
}

export async function updateMetal(id: string, patch: Partial<Metal>) {
  const { error } = await supabase.from('metals').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteMetal(id: string) {
  const { error } = await supabase.from('metals').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Purities ----------
export async function listPurities(metalId?: string): Promise<Purity[]> {
  let query = supabase.from('purities').select('*').order('name');
  if (metalId) query = query.eq('metal_id', metalId);
  const { data, error } = await query;
  if (error) throw error;
  return data as Purity[];
}

export async function createPurity(input: { metal_id: string; name: string; purity_percentage: number | null }): Promise<Purity> {
  const { data, error } = await supabase.from('purities').insert(input).select().single();
  if (error) throw error;
  return data as Purity;
}

export async function updatePurity(id: string, patch: Partial<Purity>) {
  const { error } = await supabase.from('purities').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePurity(id: string) {
  const { error } = await supabase.from('purities').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Gold / Metal Rates ----------
export async function listCurrentRates(): Promise<CurrentMetalRate[]> {
  const { data, error } = await supabase.from('current_metal_rates').select('*');
  if (error) throw error;
  return data as CurrentMetalRate[];
}

export async function addMetalRate(input: {
  metal_id: string;
  purity_id: string;
  rate_per_gram: number;
  staffId: string;
}) {
  const { error } = await supabase.rpc('log_metal_rate_rpc', {
    p_staff_id: input.staffId,
    p_metal_id: input.metal_id,
    p_purity_id: input.purity_id,
    p_rate: input.rate_per_gram,
    p_source: 'manual',
  });
  if (error) throw error;
}

// ---------- Categories ----------
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) throw error;
  return data as Category[];
}

export async function createCategory(input: { name: string }): Promise<Category> {
  const { data, error } = await supabase.from('categories').insert(input).select().single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(id: string, patch: Partial<Category>) {
  const { error } = await supabase.from('categories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Subcategories ----------
// Settings-screen version: lists ALL subcategories (with parent category name
// joined in), unlike products.ts's getSubcategories() which filters to one
// active category_id for the product form dropdown.
export async function listSubcategories(): Promise<(Subcategory & { categories?: { name: string } })[]> {
  const { data, error } = await supabase
    .from('subcategories')
    .select('*, categories(name)')
    .order('name');
  if (error) throw error;
  return data as (Subcategory & { categories?: { name: string } })[];
}

export async function createSubcategory(input: { category_id: string; name: string }): Promise<Subcategory> {
  const { data, error } = await supabase.from('subcategories').insert(input).select().single();
  if (error) throw error;
  return data as Subcategory;
}

export async function updateSubcategory(id: string, patch: Partial<Subcategory>) {
  const { error } = await supabase.from('subcategories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteSubcategory(id: string) {
  const { error } = await supabase.from('subcategories').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Stone Names ----------
export async function listStoneNames(): Promise<StoneName[]> {
  const { data, error } = await supabase.from('stones').select('*').order('name');
  if (error) throw error;
  return data as StoneName[];
}

export async function createStoneName(input: { name: string }): Promise<StoneName> {
  const { data, error } = await supabase.from('stones').insert(input).select().single();
  if (error) throw error;
  return data as StoneName;
}

export async function updateStoneName(id: string, patch: Partial<StoneName>) {
  const { error } = await supabase.from('stones').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteStoneName(id: string) {
  const { error } = await supabase.from('stones').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Making Charge Rules ----------
export async function listMakingChargeRules(): Promise<MakingChargeRule[]> {
  const { data, error } = await supabase.from('making_charge_rules').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as MakingChargeRule[];
}

export async function createMakingChargeRule(input: {
  metal_id: string;
  purity_id: string | null;
  category_id: string | null;
  calculation_type: CalculationType;
  value: number;
}) {
  const { error } = await supabase.from('making_charge_rules').insert(input);
  if (error) throw error;
}

export async function updateMakingChargeRule(id: string, patch: Partial<MakingChargeRule>) {
  const { error } = await supabase.from('making_charge_rules').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteMakingChargeRule(id: string) {
  const { error } = await supabase.from('making_charge_rules').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Value Added Charge Types ----------
export async function listValueAddedChargeTypes(): Promise<ValueAddedChargeType[]> {
  const { data, error } = await supabase.from('value_added_charge_types').select('*').order('name');
  if (error) throw error;
  return data as ValueAddedChargeType[];
}

export async function createValueAddedChargeType(input: {
  name: string;
  calculation_type: CalculationType;
  default_value: number;
}) {
  const { error } = await supabase.from('value_added_charge_types').insert(input);
  if (error) throw error;
}

export async function updateValueAddedChargeType(id: string, patch: Partial<ValueAddedChargeType>) {
  const { error } = await supabase.from('value_added_charge_types').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteValueAddedChargeType(id: string) {
  const { error } = await supabase.from('value_added_charge_types').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Tax Settings ----------
export async function listTaxSettings(): Promise<TaxSetting[]> {
  const { data, error } = await supabase.from('tax_settings').select('*').order('tax_name');
  if (error) throw error;
  return data as TaxSetting[];
}

export async function createTaxSetting(input: {
  tax_name: string;
  tax_percentage: number;
  cgst: number;
  sgst: number;
  igst: number;
}) {
  const { error } = await supabase.from('tax_settings').insert(input);
  if (error) throw error;
}

export async function updateTaxSetting(id: string, patch: Partial<TaxSetting>) {
  const { error } = await supabase.from('tax_settings').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteTaxSetting(id: string) {
  const { error } = await supabase.from('tax_settings').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Invoice Settings (single row) ----------
export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  // Insert sends only { id: 1 }, so every other column uses its table default.
  // If a column is NOT NULL with no default, creating the row fails and we
  // throw a clear error below.
  const row = await fetchOrCreateSingleRow('invoice_settings');
  if (!row) {
    throw new Error(
      'Invoice settings have not been created yet. Ask an admin to open Invoice Settings once.'
    );
  }
  return row as unknown as InvoiceSettings;
}

export async function updateInvoiceSettings(patch: Partial<InvoiceSettings>) {
  await updateOrCreateSingleRow('invoice_settings', patch as Record<string, unknown>);
}

export async function getPrimaryTaxSetting(): Promise<TaxSetting | null> {
  const { data, error } = await supabase
    .from('tax_settings')
    .select('*')
    .eq('is_active', true)
    .order('tax_percentage', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as TaxSetting | null;
}