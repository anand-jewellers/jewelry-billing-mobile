// src/lib/storage.ts
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabaseClient';

const LOGO_BUCKET = 'company-assets';
const PRODUCT_IMAGES_BUCKET = 'product-images';

/**
 * Picks an image, uploads it to the "company-assets" Storage bucket under a
 * fixed filename, and returns its public URL (with a cache-busting query
 * param so the UI doesn't keep showing a stale cached copy).
 *
 * File read: uses expo-file-system/legacy's readAsStringAsync + base64
 * decode. This works identically on web, iOS, and Android — no
 * Platform.OS branching needed.
 *
 * The upload path is fixed ("logo/company-logo.<ext>") rather than
 * timestamped, and upsert:true overwrites it in place on re-upload, so we
 * don't accumulate a new logo file on every upload. If the file extension
 * changes between uploads (e.g. you pick a .png after previously using a
 * .jpg), we also delete any other "company-logo.*" files first so there's
 * only ever one logo file at a time.
 */
export async function pickAndUploadLogo(): Promise<string> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission was denied.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled || !result.assets?.[0]) {
    throw new Error('CANCELED');
  }

  const asset = result.assets[0];
  const extMatch = asset.uri.match(/\.(\w+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const contentType = asset.mimeType ?? (ext === 'png' ? 'image/png' : 'image/jpeg');
  const fileName = `company-logo.${ext}`;
  const path = `logo/${fileName}`;

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decode(base64);
  console.log('Logo upload: read local file, bytes =', bytes.byteLength);

  if (bytes.byteLength < 1024) {
    // A real photo at quality 0.7 is virtually never under 1KB — this
    // almost always means the file read failed silently. Fail loudly
    // instead of uploading a broken image.
    throw new Error(
      `Read file looks too small (${bytes.byteLength} bytes) — the image may not have loaded correctly.`
    );
  }

  // Remove any previous logo file with a different extension so re-uploading
  // in a different format doesn't leave the old one behind.
  const { data: existingFiles } = await supabase.storage.from(LOGO_BUCKET).list('logo');
  const staleFiles = (existingFiles ?? [])
    .filter((f) => f.name.startsWith('company-logo.') && f.name !== fileName)
    .map((f) => `logo/${f.name}`);
  if (staleFiles.length > 0) {
    await supabase.storage.from(LOGO_BUCKET).remove(staleFiles);
  }

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadError) {
    console.error('Logo upload: Supabase Storage upload error:', uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  // Cache-bust: same path every time means the same URL every time, which
  // <Image> and CDNs may cache. Appending a changing query param forces a
  // fresh fetch so the new logo shows immediately after overwriting.
  const bustedUrl = `${data.publicUrl}?v=${Date.now()}`;
  console.log('Logo upload: public URL =', bustedUrl);
  return bustedUrl;
}

/**
 * Builds the public URL for a product image given its storage path
 * (the value stored in product_images.storage_path). This bucket is
 * public-read (see "public read product-images" RLS policy), so no
 * signing is needed — getPublicUrl() just builds the CDN URL.
 */
export function getProductImageUrl(storagePath: string): string {
  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Uploads a picked image (from expo-image-picker) to the product-images
 * bucket under a unique path, and returns the storage_path to save on
 * the product_images row (NOT the public URL — store the path so the
 * URL can be rebuilt later, e.g. if the bucket/CDN domain ever changes).
 */
export async function uploadProductImage(
  productId: string,
  asset: { uri: string; mimeType?: string | null }
): Promise<string> {
  const extMatch = asset.uri.match(/\.(\w+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const contentType = asset.mimeType ?? (ext === 'png' ? 'image/png' : 'image/jpeg');
  const fileName = `${Date.now()}.${ext}`;
  const path = `${productId}/${fileName}`;

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decode(base64);

  if (bytes.byteLength < 1024) {
    // A real photo is virtually never under 1KB — this almost always
    // means the file read failed silently. Fail loudly instead of
    // uploading a broken image.
    throw new Error(
      `Read file looks too small (${bytes.byteLength} bytes) — the image may not have loaded correctly.`
    );
  }

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadError) {
    console.error('Product image upload error:', uploadError);
    throw uploadError;
  }

  return path;
}

/**
 * Deletes one or more product images from Storage by their storage_path.
 * Call this alongside deleting the corresponding product_images row(s)
 * so Storage doesn't accumulate orphaned files.
 */
export async function deleteProductImages(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return;
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove(storagePaths);
  if (error) {
    console.error('Product image delete error:', error);
    throw error;
  }
}