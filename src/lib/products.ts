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
}

export async function createProduct(payload: ProductFormPayload, staffId: string) {
  const { data, error } = await supabase.rpc('create_product_rpc', {
    p_staff_id: staffId,
    p_product: payload,
  });
  if (error) throw error;
  if (!data || !data.length) throw new Error('Product creation failed');
  return data[0];
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

// VAC now stores only the RULE (which charge, and how it's calculated),
// never a frozen money amount. The rupee amount is worked out at invoice
// time against that day's metal_value.
export interface VacInsert {
  product_id: string;
  charge_type_id: string | null;
  charge_name: string;
  calculation_type: CalculationType;
  value: number;
}
export async function insertProductValueAddedCharges(rows: VacInsert[], staffId: string) {
  if (!rows.length) return;
  const { error } = await supabase.rpc('insert_product_vac_rpc', {
    p_staff_id: staffId,
    p_rows: rows,
  });
  if (error) throw error;
}

// Added metal_id / purity_id and the joined metals(name) / purities(name) so
// the product list screen can search + filter by metal and purity without
// an extra round trip per product.
export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select(`
      id, product_name, product_code, net_weight, status,
      metal_id, purity_id,
      metals(name), purities(name),
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
      product_images(storage_path, is_primary),
      product_value_added_charges(id, charge_type_id, charge_name, calculation_type, value)
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}