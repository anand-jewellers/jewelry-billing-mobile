// src/lib/storage.ts
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabaseClient'; // adjust path if your client lives elsewhere

const PRODUCT_IMAGES_BUCKET = 'product-images';

/** Preferred path: upload the base64 that ImagePickerGrid already compressed. */
export async function uploadProductImageBase64(productId: string, base64: string, index: number) {
  const path = `${productId}/${Date.now()}_${index}.jpg`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return { storagePath: path, publicUrl: data.publicUrl };
}

/** Fallback for a raw uri without a pre-compressed base64 payload. */
export async function uploadProductImage(productId: string, localUri: string, index: number) {
  const ext = localUri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${productId}/${Date.now()}_${index}.${ext}`;
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, decode(base64), { contentType, upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return { storagePath: path, publicUrl: data.publicUrl };
}

export async function uploadBarcodeImage(productId: string, base64Png: string) {
  const path = `${productId}/barcode_${Date.now()}.png`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, decode(base64Png), { contentType: 'image/png', upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return { storagePath: path, publicUrl: data.publicUrl };
}

export function removeProductImage(path: string) {
  return supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);
}

export function getProductImageUrl(path: string) {
  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}