// src/lib/products.ts
import { supabase } from './supabaseClient';
import type { CalculationType } from './pricing';

export type { CalculationType };

// ---------- Lookup data ----------

export async function getMetals() {
  const { data, error } = await supabase.from('metals').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

export async function getPurities(metalId: string) {
  const { data, error } = await supabase
    .from('purities').select('*').eq('metal_id', metalId).eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

export async function getCategories() {
  const { data, error } = await supabase.from('categories').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

export async function getSubcategories(categoryId: string) {
  const { data, error } = await supabase
    .from('subcategories').select('*').eq('category_id', categoryId).eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

export async function getValueAddedChargeTypes() {
  const { data, error } = await supabase
    .from('value_added_charge_types').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

// Stone names for the product form's multi-select. A product can carry more
// than one stone (see setProductStones / product_stones join table below).
export async function getStoneNames() {
  const { data, error } = await supabase.from('stones').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

// Prefers metal+purity+category rule, falls back to metal+purity, then metal-only.
// Still used, but now ONLY at invoice time — never stored on the product.
export async function getMakingChargeRule(metalId: string, purityId: string, categoryId?: string | null) {
  const { data, error } = await supabase
    .from('making_charge_rules').select('*').eq('metal_id', metalId).eq('is_active', true);
  if (error) throw error;
  if (!data?.length) return null;

  const exact = data.find((r) => r.purity_id === purityId && r.category_id === categoryId);
  if (exact) return exact;
  const byPurity = data.find((r) => r.purity_id === purityId && !r.category_id);
  if (byPurity) return byPurity;
  return data.find((r) => !r.purity_id && !r.category_id) || null;
}

// ---------- Metal rates (history table: metal_rates, latest-per-pair view: current_metal_rates) ----------
// Unchanged — this is the single source of truth for "today's rate", read fresh at invoice time.

export async function getCurrentMetalRate(metalId: string, purityId: string) {
  const { data, error } = await supabase
    .from('current_metal_rates').select('*').eq('metal_id', metalId).eq('purity_id', purityId).maybeSingle();
  if (error) throw error;
  return data;
}

export interface MetalRateRow {
  metal_id: string;
  purity_id: string;
  rate_per_gram: number;
  source: 'auto' | 'manual';
  metals?: { name: string };
  purities?: { name: string };
}

export async function getAllCurrentRates(): Promise<MetalRateRow[]> {
  const { data, error } = await supabase
    .from('current_metal_rates')
    .select('*, metals(name), purities(name)')
    .order('metal_id');
  if (error) throw error;
  return data as MetalRateRow[];
}

export async function logAutoRate(metalId: string, purityId: string, ratePerGram: number, staffId: string) {
  const { error } = await supabase.rpc('log_metal_rate_rpc', {
    p_staff_id: staffId,
    p_metal_id: metalId,
    p_purity_id: purityId,
    p_rate: ratePerGram,
    p_source: 'auto',
  });
  if (error) console.warn('Failed to log auto rate', error.message);
}

export async function setManualMetalRate(metalId: string, purityId: string, ratePerGram: number, staffId: string) {
  const { error } = await supabase.rpc('log_metal_rate_rpc', {
    p_staff_id: staffId,
    p_metal_id: metalId,
    p_purity_id: purityId,
    p_rate: ratePerGram,
    p_source: 'manual',
  });
  if (error) throw error;
}

// ---------- Products ----------
// NOTE: no rate, value, charge amount, discount, gst, or selling_price here anymore.
// A product is just a description of the physical item. Pricing happens only
// at invoice time, using getCurrentMetalRate() + getMakingChargeRule() + the
// weights/rules below, computed fresh against THAT day's rate.

export interface StoneEntry { stone_id: string; amount: number }
export interface DiamondEntry { size: string; amount: number }

export interface ProductFormPayload {
  product_name: string;
  category_id: string | null;
  subcategory_id: string | null;
  brand?: string;
  metal_id: string;
  purity_id: string;
  gross_weight: number;
  stone_weight: number;
  other_weight: number;
  net_weight: number;
  hsn_code?: string;
  huid?: string;
  design_number?: string;
  size?: string;
  stone_ids?: string[];          // kept so the edit page keeps compiling
  stones?: StoneEntry[];         // stones WITH amounts (use this on add)
  diamonds?: DiamondEntry[];
  tax_setting_id?: string;       // no longer sent from the add page
}

export async function createProduct(payload: ProductFormPayload, staffId: string) {
  const { size, stone_ids, stones, diamonds, tax_setting_id, ...rpcPayload } = payload;
  const { data, error } = await supabase.rpc('create_product_rpc', {
    p_staff_id: staffId,
    p_product: rpcPayload,
  });
  if (error) throw error;
  if (!data || !data.length) throw new Error('Product creation failed');
  const product = data[0];

  const patch: Record<string, any> = {};
  if (size) patch.size = size;
  if (tax_setting_id) patch.tax_setting_id = tax_setting_id;

  let updated = product;
  if (Object.keys(patch).length) {
    const { data: updatedRow, error: updateError } = await supabase
      .from('products').update(patch).eq('id', product.id).select().single();
    if (updateError) throw updateError;
    updated = updatedRow;
  }

  if (stones?.length) await setProductStones(product.id, stones);
  else if (stone_ids?.length) await setProductStones(product.id, stone_ids);

  if (diamonds?.length) await setProductDiamonds(product.id, diamonds);

  return updated;
}

// ---------- Editing an existing product ----------
// Unlike createProduct (which goes through create_product_rpc so the RPC can
// mint a product_code/barcode), an edit is a plain update — the code/barcode
// and audit fields (created_by, created_at) never change on edit.

export interface ProductUpdatePayload {
  product_name: string;
  category_id: string | null;
  subcategory_id: string | null;
  brand?: string | null;
  metal_id: string;
  purity_id: string;
  gross_weight: number;
  stone_weight: number;
  other_weight: number;
  net_weight: number;
  hsn_code?: string | null;
  huid?: string | null;
  design_number?: string | null;
  size?: string | null;
  tax_setting_id?: string | null;
}

export async function updateProduct(productId: string, payload: ProductUpdatePayload) {
  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Replaces the full set of stones on a product — safe to call on both
// create and edit (clears existing rows first so removed stones don't
// linger on save).
// Accepts plain ids (old callers) or { stone_id, amount } entries.
export async function setProductStones(productId: string, stones: (string | StoneEntry)[]) {
  const { error: delError } = await supabase.from('product_stones').delete().eq('product_id', productId);
  if (delError) throw delError;
  if (!stones.length) return;
  const rows = stones.map((s) =>
    typeof s === 'string'
      ? { product_id: productId, stone_id: s, amount: 0 }
      : { product_id: productId, stone_id: s.stone_id, amount: s.amount }
  );
  const { error } = await supabase.from('product_stones').insert(rows);
  if (error) throw error;
}

// Replaces the full set of diamond size/amount rows on a product.
export async function setProductDiamonds(productId: string, diamonds: DiamondEntry[]) {
  const { error: delError } = await supabase.from('product_diamonds').delete().eq('product_id', productId);
  if (delError) throw delError;
  if (!diamonds.length) return;
  const rows = diamonds.map((d, i) => ({
    product_id: productId, size: d.size, amount: d.amount, sort_order: i,
  }));
  const { error } = await supabase.from('product_diamonds').insert(rows);
  if (error) throw error;
}

export async function updateProductQr(productId: string, qrCodeUrl: string, staffId: string) {
  const { error } = await supabase.rpc('update_product_qr_rpc', {
    p_staff_id: staffId,
    p_product_id: productId,
    p_qr_url: qrCodeUrl,
  });
  if (error) throw error;
}

export interface ProductImageInsert {
  product_id: string;
  storage_path: string;
  is_primary: boolean;
  sort_order: number;
}
export async function insertProductImages(rows: ProductImageInsert[], staffId: string) {
  if (!rows.length) return;
  const { error } = await supabase.rpc('insert_product_images_rpc', {
    p_staff_id: staffId,
    p_images: rows,
  });
  if (error) throw error;
}

// Removes one product image row (used when editing — the user removed a
// previously-saved photo). Does not touch the underlying storage object;
// that cleanup is left to a separate storage-housekeeping pass if needed.
export async function deleteProductImage(imageId: string) {
  const { error } = await supabase.from('product_images').delete().eq('id', imageId);
  if (error) throw error;
}

// Clears the primary flag on every image of a product, so the caller can
// then set exactly one image (existing or newly-inserted) as primary
// without ending up with two rows both flagged is_primary: true.
export async function clearProductImagePrimary(productId: string) {
  const { error } = await supabase
    .from('product_images')
    .update({ is_primary: false })
    .eq('product_id', productId);
  if (error) throw error;
}

export async function setProductImagePrimary(productId: string, imageId: string) {
  await clearProductImagePrimary(productId);
  const { error } = await supabase.from('product_images').update({ is_primary: true }).eq('id', imageId);
  if (error) throw error;
}

// VAC now stores only the RULE (which charge, and how it's calculated),
// never a frozen money amount. The rupee amount is worked out at invoice
// time against that day's metal_value.
export interface VacInsert {
  product_id: string;
  charge_type_id: string | null;
  charge_name: string;
  calculation_type: CalculationType;
  value: number;
  amount: number; // table requires this even though it defaults to 0
}
export async function insertProductValueAddedCharges(rows: VacInsert[], staffId: string) {
  if (!rows.length) return;
  const { error } = await supabase.rpc('insert_product_vac_rpc', {
    p_staff_id: staffId,
    p_rows: rows,
  });
  if (error) throw error;
}

export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select(`
      id, product_name, product_code, net_weight, status,
      metal_id, purity_id, category_id,
      metals(name, type), purities(name), categories(name),
      product_images(storage_path, is_primary)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setProductStatus(
  productId: string,
  status: 'active' | 'inactive' | 'sold' | 'discontinued'
) {
  const { data, error } = await supabase
    .from('products')
    .update({ status })
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getProductById(id: string) {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      metals(name),
      purities(name),
      categories(name),
      subcategories(name),
      product_images(id, storage_path, is_primary, sort_order),
      product_value_added_charges(id, charge_type_id, charge_name, calculation_type, value),
      product_stones(stone_id, amount, stones(name)),
      product_diamonds(id, size, amount, sort_order),
      tax_settings(id, tax_name, tax_percentage, cgst, sgst, igst)
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export interface ProductChargeInput {
  charge_name: 'Value Added Charge' | 'Stone Charge' | 'Making Charge';
  calculation_type: CalculationType;
  value: number;
}

export async function saveProductCharges(
  productId: string,
  charges: ProductChargeInput[],
  staffId: string
) {
  const rows: VacInsert[] = charges
    .filter((c) => c.value > 0)
    .map((c) => ({
      product_id: productId,
      charge_type_id: null,
      charge_name: c.charge_name,
      calculation_type: c.calculation_type,
      value: c.value,
      // `amount` mirrors `value` for fixed ₹ charges (Stone/Making). For a
      // percentage charge (VAC), there's no frozen ₹ amount yet — it's
      // computed fresh at invoice time — so amount stays 0 here.
      amount: c.calculation_type === 'fixed' ? c.value : 0,
    }));
  if (!rows.length) return;
  await insertProductValueAddedCharges(rows, staffId);
}

// Replaces the full set of per-product charges — used on edit, where a
// charge the user has cleared back to 0 must actually disappear instead of
// leaving a stale row behind from before the edit.
export async function updateProductCharges(
  productId: string,
  charges: ProductChargeInput[],
  staffId: string
) {
  const { error: delError } = await supabase
    .from('product_value_added_charges')
    .delete()
    .eq('product_id', productId);
  if (delError) throw delError;
  await saveProductCharges(productId, charges, staffId);
}

// ---------- Barcode scan (invoice page) ----------
// Fetches everything the invoice screen needs in one call: the product,
// its per-product charges, and images. GST still comes from
// getPrimaryTaxSetting() separately, since it's a master setting, not
// something frozen onto the product.

export async function getProductByBarcode(barcode: string) {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      metals(name),
      purities(name),
      categories(name),
      subcategories(name),
      product_images(storage_path, is_primary),
      product_value_added_charges(id, charge_type_id, charge_name, calculation_type, value),
      product_stones(stone_id, amount, stones(name)),
      product_diamonds(id, size, amount, sort_order)
    `)
    .eq('barcode', barcode)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data;
}