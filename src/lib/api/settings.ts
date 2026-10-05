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

// ---------- Company Settings (single row) ----------
export async function getCompanySettings(): Promise<CompanySettings> {
  const { data, error } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as CompanySettings;
}

export async function updateCompanySettings(patch: Partial<CompanySettings>) {
  const { error } = await supabase.from('company_settings').update(patch).eq('id', 1);
  if (error) throw error;
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
  const { data, error } = await supabase.from('invoice_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as InvoiceSettings;
}

export async function updateInvoiceSettings(patch: Partial<InvoiceSettings>) {
  const { error } = await supabase.from('invoice_settings').update(patch).eq('id', 1);
  if (error) throw error;
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