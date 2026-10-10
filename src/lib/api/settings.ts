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

// ---------- Soft delete + reuse helpers ----------
// "Delete" in the app never removes a row from the database. It sets
// is_active = false, so old invoices / products keep their references.
// Creating the same name again finds that hidden row and turns it back on
// (instead of inserting a duplicate).

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Hide a row (is_active = false). Fails loudly if nothing was updated (RLS / wrong id). */
async function softDelete(table: string, id: string) {
  const { data, error } = await supabase
    .from(table)
    .update({ is_active: false })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Could not delete (item not found or not allowed).');
  }
}

/** Case-insensitive lookup of one row (active OR hidden) by a text column. */
async function findExisting(
  table: string,
  column: string,
  value: string,
  scope: Record<string, string> = {},
  excludeId?: string
): Promise<any | null> {
  let query = supabase.from(table).select('*').ilike(column, escapeLike(value.trim()));
  for (const [col, val] of Object.entries(scope)) query = query.eq(col, val);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * If a matching row exists and is hidden -> turn it back on (and apply `revive`).
 * If it exists and is already active   -> throw a friendly "already exists".
 * If it does not exist                 -> insert `insertRow`.
 */
async function reuseOrInsert(
  table: string,
  existing: any | null,
  insertRow: Record<string, unknown>,
  revive: Record<string, unknown>,
  label: string,
  name: string
): Promise<any> {
  if (existing) {
    if (existing.is_active) {
      throw new Error(`${label} "${name}" already exists.`);
    }
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: true, ...revive })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from(table).insert(insertRow).select().single();
  if (error) throw error;
  return data;
}

/**
 * Call before UPDATING a row's name/code.
 * - Another VISIBLE row already has that name -> friendly "already exists" error.
 * - A DELETED (hidden) row holds that name   -> give the hidden row a tombstone
 *   name so the unique constraint no longer blocks the edit.
 */
async function freeNameForRename(
  table: string,
  id: string,
  column: string,
  value: string,
  label: string,
  scope: Record<string, string> = {}
) {
  const clash = await findExisting(table, column, value, scope, id);
  if (!clash) return;
  if (clash.is_active) {
    throw new Error(`${label} "${value.trim()}" already exists.`);
  }
  const { error } = await supabase
    .from(table)
    .update({ [column]: `${clash[column]} (deleted ${Date.now().toString(36)})` })
    .eq('id', clash.id);
  if (error) throw error;
}

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
// By default only ACTIVE (not deleted) metals are returned. Pass
// includeInactive = true when you only need to look up the NAME of an old record.
export async function listMetals(includeInactive = false): Promise<Metal[]> {
  let query = supabase.from('metals').select('*').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data as Metal[];
}

export async function createMetal(input: {
  name: string;
  code: string;
  type: Metal['type'];
}): Promise<Metal> {
  // Same name OR same code counts as the same metal.
  const existing =
    (await findExisting('metals', 'name', input.name)) ??
    (await findExisting('metals', 'code', input.code));
  return (await reuseOrInsert(
    'metals',
    existing,
    input,
    { name: input.name, code: input.code, type: input.type },
    'Metal',
    input.name
  )) as Metal;
}

export async function updateMetal(id: string, patch: Partial<Metal>) {
  if (patch.name) await freeNameForRename('metals', id, 'name', patch.name, 'Metal');
  if (patch.code) await freeNameForRename('metals', id, 'code', patch.code, 'Metal code');
  const { error } = await supabase.from('metals').update(patch).eq('id', id);
  if (error) throw error;
}

/** Hides the metal and its purities. Nothing is removed from the database. */
export async function deleteMetal(id: string) {
  await softDelete('metals', id);
  const { error } = await supabase.from('purities').update({ is_active: false }).eq('metal_id', id);
  if (error) throw error;
}

// ---------- Purities ----------
export async function listPurities(metalId?: string, includeInactive = false): Promise<Purity[]> {
  let query = supabase.from('purities').select('*').order('name');
  if (metalId) query = query.eq('metal_id', metalId);
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data as Purity[];
}

export async function createPurity(input: {
  metal_id: string;
  name: string;
  purity_percentage: number | null;
}): Promise<Purity> {
  const existing = await findExisting('purities', 'name', input.name, { metal_id: input.metal_id });
  return (await reuseOrInsert(
    'purities',
    existing,
    input,
    { name: input.name, purity_percentage: input.purity_percentage },
    'Purity',
    input.name
  )) as Purity;
}

export async function updatePurity(id: string, patch: Partial<Purity>) {
  if (patch.name !== undefined || patch.metal_id !== undefined) {
    const { data: current, error: curErr } = await supabase
      .from('purities')
      .select('name, metal_id')
      .eq('id', id)
      .single();
    if (curErr) throw curErr;
    await freeNameForRename(
      'purities',
      id,
      'name',
      patch.name ?? current.name,
      'Purity',
      { metal_id: patch.metal_id ?? current.metal_id }
    );
  }
  const { error } = await supabase.from('purities').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePurity(id: string) {
  await softDelete('purities', id);
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
export async function listCategories(includeInactive = false): Promise<Category[]> {
  let query = supabase.from('categories').select('*').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data as Category[];
}

export async function createCategory(input: { name: string }): Promise<Category> {
  const existing = await findExisting('categories', 'name', input.name);
  return (await reuseOrInsert(
    'categories',
    existing,
    input,
    { name: input.name },
    'Category',
    input.name
  )) as Category;
}

export async function updateCategory(id: string, patch: Partial<Category>) {
  if (patch.name) await freeNameForRename('categories', id, 'name', patch.name, 'Category');
  const { error } = await supabase.from('categories').update(patch).eq('id', id);
  if (error) throw error;
}

/** Hides the category and its subcategories. Nothing is removed from the database. */
export async function deleteCategory(id: string) {
  await softDelete('categories', id);
  const { error } = await supabase
    .from('subcategories')
    .update({ is_active: false })
    .eq('category_id', id);
  if (error) throw error;
}

// ---------- Subcategories ----------
// Settings-screen version: lists ALL active subcategories (with parent category
// name joined in), unlike products.ts's getSubcategories() which filters to one
// active category_id for the product form dropdown.
export async function listSubcategories(
  includeInactive = false
): Promise<(Subcategory & { categories?: { name: string } })[]> {
  let query = supabase.from('subcategories').select('*, categories(name)').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data as (Subcategory & { categories?: { name: string } })[];
}

export async function createSubcategory(input: {
  category_id: string;
  name: string;
}): Promise<Subcategory> {
  const existing = await findExisting('subcategories', 'name', input.name, {
    category_id: input.category_id,
  });
  return (await reuseOrInsert(
    'subcategories',
    existing,
    input,
    { name: input.name },
    'Subcategory',
    input.name
  )) as Subcategory;
}

export async function updateSubcategory(id: string, patch: Partial<Subcategory>) {
  if (patch.name !== undefined || patch.category_id !== undefined) {
    const { data: current, error: curErr } = await supabase
      .from('subcategories')
      .select('name, category_id')
      .eq('id', id)
      .single();
    if (curErr) throw curErr;
    await freeNameForRename(
      'subcategories',
      id,
      'name',
      patch.name ?? current.name,
      'Subcategory',
      { category_id: patch.category_id ?? current.category_id }
    );
  }
  const { error } = await supabase.from('subcategories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteSubcategory(id: string) {
  await softDelete('subcategories', id);
}

// ---------- Stone Names ----------
export async function listStoneNames(includeInactive = false): Promise<StoneName[]> {
  let query = supabase.from('stones').select('*').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data as StoneName[];
}

export async function createStoneName(input: { name: string }): Promise<StoneName> {
  const existing = await findExisting('stones', 'name', input.name);
  return (await reuseOrInsert(
    'stones',
    existing,
    input,
    { name: input.name },
    'Stone',
    input.name
  )) as StoneName;
}

export async function updateStoneName(id: string, patch: Partial<StoneName>) {
  if (patch.name) await freeNameForRename('stones', id, 'name', patch.name, 'Stone');
  const { error } = await supabase.from('stones').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteStoneName(id: string) {
  await softDelete('stones', id);
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

// ---------- Delete a rate from the Gold Rates list (soft delete) ----------
// NOTE: written against the assumption that rates are logged in a table named
// `metal_rates` (via log_metal_rate_rpc) that has an `is_active` column, and
// that the `current_metal_rates` view only returns rows where is_active = true.
// Adjust the table / column names if your schema differs.
export async function deleteMetalRate(metalId: string, purityId: string) {
  const { error } = await supabase
    .from('metal_rates')
    .update({ is_active: false })
    .eq('metal_id', metalId)
    .eq('purity_id', purityId);
  if (error) throw error;
}