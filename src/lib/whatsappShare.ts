// src/lib/whatsappShare.ts

import { Alert, AppState, Image as RNImage, Linking, Platform, ToastAndroid } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import type { CustomerOrder } from './api/customerOrders';
import type { InvoiceDetail } from '../types/invoices';
import { getCompanySettings } from './api/settings';
import { formatDisplayDate } from './dateUtils';
import { cacheDirectory, moveAsync } from 'expo-file-system/legacy';
// import type { ShareableProduct } from '...'; // <- keep your existing import for ShareableProduct

// react-native-share is a native module: it does not exist in Expo Go.
// Load it lazily so the app still starts there and falls back gracefully.
let RNShare: any = null;
let RNSocial: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-share');
  RNShare = mod?.default ?? mod;
  RNSocial = mod?.Social ?? RNShare?.Social ?? null;
} catch {
  RNShare = null;
  RNSocial = null;
}
// react-native-image-marker is also a native module: load it lazily so Expo Go
// still starts (photos are then sent without numbers / logo).
let MarkerMod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  MarkerMod = require('react-native-image-marker');
} catch {
  MarkerMod = null;
}

export interface ShopShareInfo {
  name: string;
  address: string | null;
  mapsUrl: string | null;
  website?: string | null;
  logoUrl?: string | null; // company logo (public URL) used as the photo watermark
  reviewUrl?: string | null; // Google review link (added to every customer message)
}

// ---------------------------------------------------------
// Shop info from the company settings row.
//
// Field names are read defensively. logo_url is the column used by
// Settings > Company (uploaded to the public "company-assets" bucket).
// ---------------------------------------------------------
export function shopInfoFromCompany(company: any): ShopShareInfo {
  const name =
    company?.company_name ?? company?.shop_name ?? company?.business_name ?? company?.name ?? 'Our Shop';

  const addressParts = [
    company?.address ?? company?.address_line1,
    company?.address_line2,
    company?.city,
    company?.state,
    company?.pincode ?? company?.postal_code,
  ]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);

  const address = addressParts.length ? addressParts.join(', ') : null;

  // Prefer an explicit Google Maps link if the settings have one;
  // otherwise build a search link from the address text.
  const explicitMaps =
    company?.google_maps_url ?? company?.maps_url ?? company?.map_link ?? company?.location_url ?? null;

  const mapsUrl = explicitMaps
    ? String(explicitMaps)
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`
      : null;

  // Website: add https:// if the DB value has no scheme so WhatsApp makes it tappable.
  const rawWebsite =
    company?.website ?? company?.website_url ?? company?.shop_website ?? company?.web_url ?? null;
  let website = rawWebsite ? String(rawWebsite).trim() : '';
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;

  // Logo: full https:// URL (Supabase public URL) or a data:image base64 string.
  const rawLogo = company?.logo_url ?? company?.company_logo ?? company?.logo ?? null;
  const logoUrl = rawLogo ? String(rawLogo).trim() : null;

  return {
    name: String(name).trim(),
    address,
    mapsUrl,
    website: website || null,
    logoUrl: logoUrl || null,
    reviewUrl: reviewUrlFromCompany(company),
  };
}

// ---------------------------------------------------------
// Phone → WhatsApp format (digits only, country code included).
// 10-digit Indian numbers get 91 prepended.
// ---------------------------------------------------------
export function normalizeWhatsAppPhone(raw?: string | null, defaultCountryCode = '91'): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return digits.length >= 11 ? digits : null;
}

// ---------------------------------------------------------
// Shared: open WhatsApp with a text message (directly to a number
// when we have one, otherwise the contact picker).
// ---------------------------------------------------------
async function openWhatsApp(message: string, phone?: string | null): Promise<void> {
  const encoded = encodeURIComponent(message);

  const appUrl = phone ? `whatsapp://send?phone=${phone}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
  const webUrl = phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;

  if (Platform.OS === 'web') {
    await Linking.openURL(webUrl);
    return;
  }

  try {
    const supported = await Linking.canOpenURL(appUrl);
    await Linking.openURL(supported ? appUrl : webUrl);
  } catch {
    await Linking.openURL(webUrl);
  }
}

// Detects "user closed the share sheet / cancelled" errors so we don't
// pop a second screen after the user deliberately backed out.
function isUserCancel(e: any): boolean {
  const msg = String(e?.message ?? '').toLowerCase();
  return msg.includes('cancel') || msg.includes('did not share') || msg.includes('user did not');
}

// =========================================================
// Google review block - appended to EVERY customer message.
// Uses the link passed in; falls back to DEFAULT_GOOGLE_REVIEW_URL.
// =========================================================
const REVIEW_INVITE = 'We would love to hear your feedback — please rate us on Google:';

// Lines to append to a message (starts with a blank line).
function reviewBlock(url?: string | null): string[] {
  const u = String(url ?? DEFAULT_GOOGLE_REVIEW_URL ?? '').trim();
  return u ? ['', REVIEW_INVITE, `⭐ ${u}`] : [];
}

function withReview(message: string, url?: string | null): string {
  const block = reviewBlock(url);
  return block.length ? `${message}\n${block.join('\n')}` : message;
}

// =========================================================
// Products: single + multiple product share
//
// Product photos are sent as real attachments (downloaded to the
// phone first), with the details as the caption. No image URL is
// ever put in the message, so the Supabase address stays hidden.
// =========================================================

export interface ShareableProductWithImage extends ShareableProduct {
  imageUrl?: string | null;
}

// Max products sent in one go (one photo + caption each).
const MAX_SHARE_IMAGES = 10;

function buildProductLines(p: ShareableProduct, imageUrl?: string | null, indent = ''): string[] {
  const lines: string[] = [];
  if (p.metals?.name) lines.push(`${indent}Metal: ${p.metals.name}`);
  if (p.purities?.name) lines.push(`${indent}Purity: ${p.purities.name}`);
  if (p.net_weight != null) lines.push(`${indent}Weight: ${Number(p.net_weight).toFixed(3)} g`);
  // Only used by the text-only builders below. The attachment flow always
  // passes imageUrl = null, so no URL appears in the caption.
  if (imageUrl) lines.push(`${indent}${imageUrl}`);
  return lines;
}

// Shop name on top, review link, then website at the bottom.
function wrapWithShopInfo(body: string, shop?: ShopShareInfo | null): string {
  const name = shop?.name?.trim();
  const header = name ? `*${name}*\n\n` : '';
  const footer = shop?.website ? `\n\n${shop.website}` : '';
  return `${header}${withReview(body, shop?.reviewUrl)}${footer}`;
}

export function buildMultiProductShareMessage(
  products: ShareableProductWithImage[],
  shop?: ShopShareInfo | null
): string {
  const blocks = products.map((p, i) => {
    const lines = [`${i + 1}. *${p.product_name}*`, ...buildProductLines(p, p.imageUrl, '   ')];
    return lines.join('\n');
  });
  return wrapWithShopInfo(blocks.join('\n\n'), shop);
}

export function buildSingleProductShareMessage(
  product: ShareableProduct,
  imageUrl?: string | null,
  shop?: ShopShareInfo | null
): string {
  const lines = [`*${product.product_name}*`, ...buildProductLines(product, imageUrl)];
  return wrapWithShopInfo(lines.join('\n'), shop);
}

export async function getShopShareInfo(): Promise<ShopShareInfo> {
  const company = await getCompanySettings();
  return shopInfoFromCompany(company);
}

const SHARE_FILE_PREFIX = 'share_';

function extFromUrl(url: string): 'jpg' | 'png' | 'webp' {
  const m = url.split('?')[0].match(/\.(jpe?g|png|webp)$/i);
  const e = (m?.[1] ?? 'jpg').toLowerCase();
  return e === 'png' ? 'png' : e === 'webp' ? 'webp' : 'jpg';
}

const mimeFromExt = (e: string) =>
  e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';

// Downloads a remote image into the cache with the correct extension.
// Gives up after 20 s so a bad connection can never leave the button spinning.
async function downloadToCache(url: string, index: number): Promise<{ uri: string; mime: string } | null> {
  try {
    const ext = extFromUrl(url);
    const dest = `${FileSystem.cacheDirectory}${SHARE_FILE_PREFIX}${Date.now()}_${index}.${ext}`;
    const result = await Promise.race([
      FileSystem.downloadAsync(url, dest),
      new Promise<null>((r) => setTimeout(() => r(null), 20000)),
    ]);
    if (!result || result.status !== 200) return null;
    return { uri: result.uri, mime: mimeFromExt(ext) };
  } catch {
    return null;
  }
}

// Deletes photos left from PREVIOUS shares. Runs at the start of the next
// share, so WhatsApp always has time to finish reading the current files.
async function cleanupOldShareFiles(): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    const names = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      names
        .filter((n) => n.startsWith(SHARE_FILE_PREFIX))
        .map((n) => FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true }))
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------
// Web: the browser's native share sheet (Web Share API with files).
// Works on mobile browsers and some desktop browsers (Chrome/Edge on
// Windows, Safari on Mac). Returns false when unsupported so the caller
// can fall back to a text-only WhatsApp message.
// (No logo watermark on web: the native image-marker module is not available.)
// ---------------------------------------------------------
async function shareImagesOnWeb(urls: string[], caption: string): Promise<boolean> {
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    const FileCtor: any = (globalThis as any).File;
    if (!nav?.share || !nav?.canShare || !FileCtor) return false;

    const files: any[] = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i]);
        if (!res.ok) continue;
        const blob = await res.blob();
        const ext = extFromUrl(urls[i]);
        files.push(new FileCtor([blob], `product_${i + 1}.${ext}`, { type: blob.type || mimeFromExt(ext) }));
      } catch {
        /* skip this image */
      }
    }
    if (!files.length || !nav.canShare({ files })) return false;

    await nav.share({ files, text: caption });
    return true;
  } catch (e: any) {
    if (e?.name === 'AbortError') return true; // user closed the share sheet
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------
// Detects "the user left our app (to WhatsApp) and came back".
// Create it BEFORE launching a share so no transition is missed, then
// call wait() after the share has been launched.
//
// wait() resolves:
//   true  -> the user went to WhatsApp and is back in the app
//   false -> the app never left within awayMs (WhatsApp did not open),
//            or the user took longer than maxMs -> stop the sequence
// ---------------------------------------------------------
export function watchAwayAndBack() {
  let left = AppState.currentState !== 'active';
  let returned = false;
  let notify: (() => void) | null = null;

  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') left = true;
    else if (left) {
      returned = true;
      notify?.();
    }
  });

  return {
    wait(awayMs = 5000, maxMs = 5 * 60 * 1000): Promise<boolean> {
      return new Promise((resolve) => {
        let t1: ReturnType<typeof setTimeout> | undefined;
        let t2: ReturnType<typeof setTimeout> | undefined;
        const done = (ok: boolean) => {
          if (t1) clearTimeout(t1);
          if (t2) clearTimeout(t2);
          sub.remove();
          resolve(ok);
        };
        if (returned) {
          done(true);
          return;
        }
        notify = () => done(true);
        t1 = setTimeout(() => {
          if (!left) done(false);
        }, awayMs);
        t2 = setTimeout(() => done(false), maxMs);
      });
    },
    cancel() {
      sub.remove();
    },
  };
}

// react-native-share's promise does not always settle when WhatsApp opens
// (on some Android versions it never does). So we never wait on it for
// more than a moment: if it has not failed or been cancelled by then, the
// share is treated as launched.
async function launchShare(call: Promise<any>, waitMs = 2500): Promise<'launched' | 'cancelled' | 'error'> {
  const settled = call.then(
    () => 'launched' as const,
    (e: any) => (isUserCancel(e) ? ('cancelled' as const) : ('error' as const))
  );
  const timeout = sleep(waitMs).then(() => 'launched' as const);
  return Promise.race([settled, timeout]);
}

// Yes/No step between products. Native uses an Alert, web uses confirm().
function confirmStep(title: string, message: string, okLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const c = (globalThis as any).confirm;
    return Promise.resolve(typeof c === 'function' ? !!c(`${title}\n\n${message}`) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Stop', style: 'cancel', onPress: () => resolve(false) },
        { text: okLabel, onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

type ShareResult = 'shared' | 'cancelled';

// Launches ONE product: its photo (with the company logo in the top-right
// corner) as an attachment with its own details as the caption.
// Falls back to a text-only WhatsApp message on any problem.
async function shareOneProduct(
  product: ShareableProductWithImage,
  shop: ShopShareInfo | null | undefined,
  phone: string | null,
  index: number
): Promise<ShareResult> {
  const caption = buildSingleProductShareMessage(product, null, shop);
  const url = product.imageUrl || null;

  // ---- Web ----
  if (Platform.OS === 'web') {
    if (url && (await shareImagesOnWeb([url], caption))) return 'shared';
    await openWhatsApp(caption, phone);
    return 'shared';
  }

  // ---- Expo Go (no native module) or product has no photo ----
  if (!RNShare || !url) {
    await openWhatsApp(caption, phone);
    return 'shared';
  }

  const file = await downloadToCache(url, index);
  if (!file) {
    await openWhatsApp(caption, phone);
    return 'shared';
  }

  // Company logo in the top-right corner (falls back to the plain photo on any problem)
  let fileUri = file.uri;
  let fileMime = file.mime;
  if (ENABLE_LOGO_WATERMARK) {
    const logo = await prepareLogoFile(shop);
    if (logo) {
      const r = await stampLogoOnImage(fileUri, logo);
      if (r.ok) {
        fileUri = r.uri;
        fileMime = 'image/jpeg';
      } else {
        debugToast(r.note ?? 'Logo watermark failed');
      }
    }
  }

  // Safety net: WhatsApp (especially on iPhone) can drop the caption
  await Clipboard.setStringAsync(caption);

  const call =
    Platform.OS === 'android' && RNShare.shareSingle && RNSocial?.Whatsapp
      ? RNShare.shareSingle({
        social: RNSocial.Whatsapp,
        url: fileUri,
        type: fileMime,
        message: caption,
        whatsAppNumber: phone ?? undefined, // opens that customer's chat directly
      })
      : RNShare.open({ urls: [fileUri], type: fileMime, message: caption, failOnCancel: false });

  const outcome = await launchShare(call);
  if (outcome === 'cancelled') return 'cancelled';
  if (outcome === 'error') await openWhatsApp(caption, phone);
  return 'shared';
}

function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    RNImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null)
    );
  });
}

// v2 may return a string path or an object; extract the file path from either.
function extractMarkerPath(res: any): string {
  if (!res) return '';
  if (typeof res === 'string') return res;
  const p = res.uri ?? res.path ?? res.filePath ?? res.url ?? res.destPath ?? '';
  return typeof p === 'string' ? p : '';
}

type StampResult = { uri: string; ok: boolean; note?: string };

// Stamps a big number (top-left) on a local image using react-native-image-marker v2.
// Tries the possible `position` shapes until one works. If all fail, returns the
// original photo plus the real error text.
async function stampNumberOnImage(uri: string, n: number): Promise<StampResult> {
  const Marker = MarkerMod?.default ?? MarkerMod;
  if (!Marker?.markText) {
    return {
      uri,
      ok: false,
      note: `image-marker not loaded (${MarkerMod ? Object.keys(MarkerMod).join(',') : 'null'})`,
    };
  }

  const size = await Promise.race([getImageSize(uri), sleep(3000).then(() => null)]);
  const base = Math.min(size?.width ?? 1000, size?.height ?? 1000);
  const fontSize = Math.max(48, Math.round(base * 0.16));
  const pad = Math.round(fontSize * 0.3);
  const margin = Math.round(fontSize * 0.35);
  const text = `${n}`;

  const bgTypes = MarkerMod?.TextBackgroundType ?? Marker?.TextBackgroundType;
  const bgType = bgTypes?.stretchX ?? 'stretchX';
  const fmt = (MarkerMod?.ImageFormat ?? Marker?.ImageFormat)?.jpg;
  const PositionEnum = MarkerMod?.Position ?? Marker?.Position;

  const withFile = uri.startsWith('file://') ? uri : `file://${uri}`;
  const noFile = uri.replace(/^file:\/\//, '');

  // Possible shapes of `position` in v2 (first one that the library accepts wins)
  const positions: any[] = [
    { X: margin, Y: margin },
    ...(PositionEnum?.topLeft ? [{ position: PositionEnum.topLeft }] : []),
    { position: 'topLeft' },
  ];

  const sources: any[] = [{ uri: withFile }, noFile, withFile];

  const make = (src: any, position: any, withBg: boolean) => ({
    backgroundImage: { src, scale: 1 },
    watermarkTexts: [
      {
        text,
        position,
        style: {
          color: '#DC2626',
          fontSize,
          bold: true,
          shadowStyle: { dx: 2, dy: 2, radius: 4, color: '#FFFFFF' },
        },
      },
    ],
    quality: 90,
    ...(fmt ? { saveFormat: fmt } : {}),
  });

  let out = '';
  const errs: string[] = [];
  outer: for (const withBg of [false]) {
    for (const position of positions) {
      for (const src of sources) {
        try {
          const res = await Marker.markText(make(src, position, withBg));
          out = extractMarkerPath(res);
          if (out) break outer;
          errs.push(`unexpected result: ${JSON.stringify(res)?.slice(0, 140)}`);
        } catch (e: any) {
          errs.push(String(e?.message ?? e).slice(0, 140));
        }
      }
    }
  }

  if (!out) {
    const unique = Array.from(new Set(errs));
    return {
      uri,
      ok: false,
      note: `Stamp failed.\n${unique.slice(0, 3).join('\n')}`,
    };
  }

  const stampedUri = out.startsWith('file://') ? out : `file://${out}`;
  return { uri: stampedUri, ok: true };
}

// ---------------------------------------------------------
// Company logo watermark (top-right corner of every shared product photo)
// ---------------------------------------------------------

// Set to false to turn the logo watermark off.
const ENABLE_LOGO_WATERMARK = true;

// Logo size as a fraction of the photo width, and its opacity.
// 0.12 = 12% of the photo width. Make it smaller/bigger here.
const LOGO_WIDTH_RATIO = 0.12;
const LOGO_ALPHA = 0.95;
// Gap from the top and right edges, as a fraction of the photo width.
const LOGO_MARGIN_RATIO = 0.03;

// expo-image-manipulator is used to shrink the logo to the exact pixel size
// BEFORE stamping, so the size never depends on how the marker library scales.
// (npx expo install expo-image-manipulator). Optional: without it we fall back
// to the marker's own scale.
let Manipulator: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Manipulator = require('expo-image-manipulator');
} catch {
  Manipulator = null;
}

// The logo is downloaded once and reused for every photo in the same share.
let logoCache: { src: string; uri: string } | null = null;

// Gets the shop logo as a local file (downloads it, or decodes a data: URI).
async function prepareLogoFile(shop?: ShopShareInfo | null): Promise<string | null> {
  const src = shop?.logoUrl;
  if (!src) return null;

  try {
    // Reuse the copy from earlier in this share if it is still on disk
    if (logoCache && logoCache.src === src) {
      const info = await FileSystem.getInfoAsync(logoCache.uri);
      if (info.exists) return logoCache.uri;
    }

    let uri: string | null = null;

    if (src.startsWith('data:image')) {
      const base64 = src.split(',')[1];
      if (!base64) return null;
      const dest = `${FileSystem.cacheDirectory}${SHARE_FILE_PREFIX}logo_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
      uri = dest;
    } else if (/^https?:\/\//i.test(src)) {
      // Supabase public URL (the ?v=... cache-buster is handled by extFromUrl)
      const d = await downloadToCache(src, 900);
      uri = d?.uri ?? null;
    }
    // A local file:/content: path or a bare storage path is not usable here

    if (uri) logoCache = { src, uri };
    return uri;
  } catch {
    return null;
  }
}

// Stamps the logo in the TOP-RIGHT corner, fully inside the photo.
// On any failure it returns the original photo untouched plus the real error text.
async function stampLogoOnImage(uri: string, logoUri: string): Promise<StampResult> {
  const Marker = MarkerMod?.default ?? MarkerMod;
  if (!Marker?.markImage) return { uri, ok: false, note: 'markImage not available' };

  const size = await Promise.race([getImageSize(uri), sleep(3000).then(() => null)]);
  if (!size) return { uri, ok: false, note: 'could not read photo size' };

  const targetW = Math.max(40, Math.round(size.width * LOGO_WIDTH_RATIO));
  const margin = Math.round(size.width * LOGO_MARGIN_RATIO);

  // The marker library sizes the logo relative to the PHOTO width
  // (scale 1 = full photo width), so the scale is simply the fraction we want.
  const useLogo = logoUri;
  const logoW = targetW;
  // The marker sizes the logo relative to the photo HEIGHT, so convert the
  // wanted width (a share of the photo width) into that scale.
  const scale = (LOGO_WIDTH_RATIO * size.width) / size.height;

  const X = Math.max(0, size.width - logoW - margin);
  const Y = margin;

  const fmt = (MarkerMod?.ImageFormat ?? Marker?.ImageFormat)?.jpg;
  const PositionEnum = MarkerMod?.Position ?? Marker?.Position;

  const withFile = (u: string) => (u.startsWith('file://') ? u : `file://${u}`);
  const noFile = (u: string) => u.replace(/^file:\/\//, '');

  // Exact pixel position first; the library's own top-right anchor as a backup
  const positions: any[] = [
    { X, Y },
    ...(PositionEnum?.topRight ? [{ position: PositionEnum.topRight }] : []),
    { position: 'topRight' },
  ];
  const bgSources: any[] = [{ uri: withFile(uri) }, noFile(uri)];
  const logoSources: any[] = [{ uri: withFile(useLogo) }, noFile(useLogo)];

  const errs: string[] = [];
  for (const position of positions) {
    for (const bg of bgSources) {
      for (const logo of logoSources) {
        try {
          const res = await Marker.markImage({
            backgroundImage: { src: bg, scale: 1 },
            watermarkImages: [{ src: logo, scale, alpha: LOGO_ALPHA, position }],
            quality: 90,
            ...(fmt ? { saveFormat: fmt } : {}),
          });
          const out = extractMarkerPath(res);
          if (out) return { uri: withFile(out), ok: true };
          errs.push(`unexpected result: ${JSON.stringify(res)?.slice(0, 120)}`);
        } catch (e: any) {
          errs.push(String(e?.message ?? e).slice(0, 120));
        }
      }
    }
  }
  return { uri, ok: false, note: `Logo failed. ${Array.from(new Set(errs)).slice(0, 2).join(' | ')}` };
}

// Set to false to share the plain photos exactly like before (no numbers).
// Use this to check whether the numbering is what is breaking the photo share.
const ENABLE_NUMBER_STAMP = true;

// Shares files via react-native-share and returns the real error text if it fails.
async function tryShareFiles(
  files: string[],
  caption: string
): Promise<{ outcome: 'launched' | 'cancelled' | 'error'; error?: string }> {
  let error = '';
  const call = RNShare.open({ urls: files, type: 'image/*', message: caption, failOnCancel: false }).catch(
    (e: any) => {
      error = String(e?.message ?? e);
      throw e;
    }
  );
  const outcome = await launchShare(call);
  return { outcome, error };
}

function debugToast(msg: string) {
  console.warn('[share]', msg);
  if (Platform.OS === 'android') ToastAndroid.show(msg.slice(0, 120), ToastAndroid.LONG);
}

// Sends ALL selected products in ONE WhatsApp send: every photo attached
// together (numbered top-left, company logo top-right), plus one caption
// listing the products in the same order as the photos (1., 2., 3.).
// One tap, one Send.
async function shareProductsTogether(
  list: ShareableProductWithImage[],
  shop: ShopShareInfo | null | undefined,
  phone: string | null
): Promise<void> {
  const caption = buildMultiProductShareMessage(
    list.map((p) => ({ ...p, imageUrl: null })), // no image URLs in the text
    shop
  );

  // Each photo keeps its product's position in the list, so the badge number
  // always matches the caption (1., 2., 3.) even if some products have no photo.
  const withImages = list
    .map((p, index) => ({ url: p.imageUrl, number: index + 1 }))
    .filter((x): x is { url: string; number: number } => !!x.url);
  const urls = withImages.map((x) => x.url);

  // ---- Web: browser share sheet with all photos ----
  if (Platform.OS === 'web') {
    if (urls.length && (await shareImagesOnWeb(urls, caption))) return;
    await openWhatsApp(caption);
    return;
  }

  if (!RNShare) {
    debugToast('Photo share module not available in this build');
    await openWhatsApp(caption, phone);
    return;
  }
  if (!urls.length) {
    debugToast('No product photo found (imageUrl is empty)');
    await openWhatsApp(caption, phone);
    return;
  }

  // 1) Download the originals (same as the old working code)
  const downloaded = await Promise.all(withImages.map((x, i) => downloadToCache(x.url, i)));
  const plainFiles = downloaded.filter((d): d is { uri: string; mime: string } => !!d).map((d) => d.uri);
  if (!plainFiles.length) {
    debugToast('Could not download the photos (check internet / image URL)');
    await openWhatsApp(caption, phone);
    return;
  }

  // 2) Numbered + logo copies (each step falls back to the previous file if it fails)
  const logoFile = ENABLE_LOGO_WATERMARK ? await prepareLogoFile(shop) : null;

  let numberedFiles: string[] = [];
  if (ENABLE_NUMBER_STAMP || logoFile) {
    const results = await Promise.race([
      (async () => {
        const out: string[] = [];
        let numberNote: string | undefined;
        for (let i = 0; i < downloaded.length; i++) {
          const d = downloaded[i];
          if (!d) continue;
          let cur = d.uri;

          if (ENABLE_NUMBER_STAMP) {
            const r = await stampNumberOnImage(cur, withImages[i].number);
            if (r.ok) cur = r.uri;
            else numberNote = numberNote ?? r.note;
          }
          if (logoFile) {
            const r = await stampLogoOnImage(cur, logoFile);
            if (r.ok) cur = r.uri;
            else debugToast(r.note ?? 'Logo watermark failed');
          }
          out.push(cur);
        }
        if (numberNote) Alert.alert('Numbering failed', numberNote);
        return out;
      })(),
      sleep(30000).then(() => null), // never let stamping block the share
    ]);

    if (results && results.length === plainFiles.length) {
      numberedFiles = results;
    } else {
      debugToast('Watermarking took too long, sending original photos');
    }
  }

  // WhatsApp often drops the caption when several photos are attached
  await Clipboard.setStringAsync(caption);
  if (Platform.OS === 'android') {
    ToastAndroid.show('Details copied. If the caption is empty, long-press and paste.', ToastAndroid.LONG);
  }

  // 3) Try stamped photos first (only if they really differ from the originals)
  if (numberedFiles.length && numberedFiles.some((f, i) => f !== plainFiles[i])) {
    const r = await tryShareFiles(numberedFiles, caption);
    if (r.outcome === 'launched' || r.outcome === 'cancelled') return;
    debugToast(`Stamped photos failed: ${r.error || 'unknown error'}`);
  }

  // 4) Plain photos (the original behaviour)
  const r2 = await tryShareFiles(plainFiles, caption);
  if (r2.outcome === 'launched' || r2.outcome === 'cancelled') return;

  // 5) Last resort: details only, but now we show WHY
  debugToast(`Photo share failed: ${r2.error || 'unknown error'}`);
  await openWhatsApp(caption, phone);
}

/**
 * Shares products ONE BY ONE from a SINGLE tap: photo + its own details,
 * then the next photo + its details, and so on.
 *
 * WhatsApp never lets an app press "Send" for the user, so the user still
 * taps Send inside WhatsApp for each product. What the app does
 * automatically: when the user comes back from WhatsApp, the next product
 * opens by itself.
 *
 * This function resolves as soon as the FIRST product has been handed to
 * WhatsApp, so the caller's loading spinner stops right away. The remaining
 * products continue in the background.
 *
 * - Android: each product opens the customer's chat (when opts.phone is
 *   given). Tap Send, press back, the next one opens.
 * - iPhone: one notice at the start; for each product choose WhatsApp,
 *   paste the caption (already copied), Send, and come back.
 * - Web: a confirm box is shown between products (browsers need a fresh
 *   tap per share).
 *
 * Every photo carries the company logo in its top-right corner.
 *
 * opts.phone        customer's number, opens that chat directly on Android.
 * opts.confirmEach  true = show a "Share next?" prompt between products.
 * opts.mode         'together' (default): ALL photos in one WhatsApp send with
 *                   one numbered caption. 'oneByOne': separate sends, as above.
 */
export async function shareProductsWithImages(
  products: ShareableProductWithImage[],
  shop?: ShopShareInfo | null,
  opts?: { phone?: string | null; confirmEach?: boolean; mode?: 'together' | 'oneByOne' }
): Promise<void> {
  if (!products.length) return;

  const list = products.slice(0, MAX_SHARE_IMAGES);
  const total = list.length;
  const phone = normalizeWhatsAppPhone(opts?.phone ?? null);
  const isWeb = Platform.OS === 'web';
  const promptBetween = !!opts?.confirmEach || isWeb;

  if (!isWeb) {
    logoCache = null; // its file is about to be deleted with the other share_ files
    await cleanupOldShareFiles(); // previous share's photos, not this one's
  }

  const together = total > 1 && (opts?.mode ?? 'together') === 'together';

  // iPhone: one notice up front (WhatsApp there ignores the attached caption)
  if (Platform.OS === 'ios' && list.some((p) => p.imageUrl)) {
    const ok = await confirmStep(
      total > 1 ? `Sharing ${total} products` : 'Details copied',
      together
        ? 'All photos open in WhatsApp together. Choose WhatsApp, long-press the caption box and tap Paste to add the details, then Send.'
        : total > 1
          ? 'Products open in WhatsApp one by one. For each: choose WhatsApp, long-press the caption box and tap Paste, then Send and come back to the app.'
          : 'Choose WhatsApp, then long-press the caption box and tap Paste.',
      'Start'
    );
    if (!ok) return;
  }

  if (together) {
    await shareProductsTogether(list, shop, phone);
    return;
  }

  let releaseCaller: () => void = () => { };
  const firstLaunched = new Promise<void>((resolve) => {
    releaseCaller = resolve;
  });

  const run = async () => {
    try {
      for (let i = 0; i < total; i++) {
        const p = list[i];

        if (promptBetween && i > 0) {
          const ok = await confirmStep(
            `Product ${i + 1} of ${total}`,
            `${p.product_name}\n\nShare this product next?`,
            'Share'
          );
          if (!ok) return;
        }

        // Start watching BEFORE launching so the app->WhatsApp->app trip is never missed
        const watcher = !promptBetween && i < total - 1 ? watchAwayAndBack() : null;

        const result = await shareOneProduct(list[i], shop, phone, i);
        if (i === 0) releaseCaller(); // stop the caller's spinner after the first launch

        if (result === 'cancelled') {
          watcher?.cancel();
          return; // user backed out, stop the sequence
        }

        if (watcher) {
          const backInApp = await watcher.wait();
          if (!backInApp) return; // WhatsApp never opened, or user took too long
          await sleep(400);
        }
      }
    } catch (e) {
      console.warn('Product share sequence stopped', e);
    } finally {
      releaseCaller();
    }
  };

  void run();
  await firstLaunched;
}

// ---------------------------------------------------------
// Backwards-compatible wrappers: existing screens keep calling these
// and automatically get the new behaviour.
// ---------------------------------------------------------
export async function shareProductsOnWhatsApp(
  products: ShareableProductWithImage[],
  shop?: ShopShareInfo | null,
  opts?: { phone?: string | null; confirmEach?: boolean; mode?: 'together' | 'oneByOne' }
): Promise<void> {
  await shareProductsWithImages(products, shop, opts);
}

export async function shareProductOnWhatsApp(
  product: ShareableProduct,
  imageUrl?: string | null,
  shop?: ShopShareInfo | null,
  opts?: { phone?: string | null; confirmEach?: boolean; mode?: 'together' | 'oneByOne' }
): Promise<void> {
  await shareProductsWithImages([{ ...product, imageUrl }], shop, opts);
}

// =========================================================
// Order-ready message
// Thank-you note + shop location (no review link).
// No order number, item details, weights, dates or amounts.
// =========================================================
export function buildOrderReadyMessage(
  order: CustomerOrder,
  customerName: string | null,
  shop: ShopShareInfo
): string {
  const lines: string[] = [`*${shop.name}*`, ''];

  lines.push(customerName ? `Hello ${customerName},` : 'Hello,');
  lines.push('Your jewel order is ready! 🎉', '');

  if (shop.address || shop.mapsUrl) {
    lines.push('📍 *Visit us*');
    if (shop.address) lines.push(shop.address);
    if (shop.mapsUrl) lines.push(shop.mapsUrl);
    lines.push('');
  }

  lines.push('Thank you for choosing us! 🙏');
  return lines.join('\n');
}

export async function shareOrderReadyOnWhatsApp(params: {
  order: CustomerOrder;
  customerName: string | null;
  customerPhone: string | null;
  shop: ShopShareInfo;
}): Promise<void> {
  const { order, customerName, customerPhone, shop } = params;

  const message = buildOrderReadyMessage(order, customerName, shop);
  const phone = normalizeWhatsAppPhone(customerPhone);

  await openWhatsApp(message, phone);
}

// =========================================================
// Goldsmith: reference picture(s) + design details only
// (goes to the goldsmith, not a customer: no review link)
// =========================================================
export function buildSmithOrderMessage(order: CustomerOrder): string {
  const lines: string[] = ['*New Jewel Order*', ''];
  lines.push(`Category: ${order.category}`);
  lines.push(`Metal: ${order.metal}`);
  lines.push(`Purity: ${order.purity}`);
  if (order.notes?.trim()) lines.push(`Remarks: ${order.notes.trim()}`);
  return lines.join('\n');
}

export async function shareOrderWithGoldsmithOnWhatsApp(params: {
  order: CustomerOrder;
  imageUrls?: string[];     // public URLs (used from the order screen)
  base64Images?: string[];  // pictures still on the phone (used right after creating the order)
}): Promise<void> {
  const { order } = params;
  const message = buildSmithOrderMessage(order);
  const phone = normalizeWhatsAppPhone(order.goldsmith_phone);
  const urls = (params.imageUrls ?? []).slice(0, MAX_SHARE_IMAGES);
  const b64s = (params.base64Images ?? []).slice(0, MAX_SHARE_IMAGES);

  // Web
  if (Platform.OS === 'web') {
    if (urls.length && (await shareImagesOnWeb(urls, message))) return;
    await openWhatsApp(message, phone);
    return;
  }

  if (!RNShare) {
    debugToast('Photo sharing needs the dev/production build (not Expo Go). Sending text only.');
    await openWhatsApp(message, phone);
    return;
  }

  if (!urls.length && !b64s.length) {
    debugToast('No reference picture on this order. Sending text only.');
    await openWhatsApp(message, phone);
    return;
  }

  await cleanupOldShareFiles();

  // Prefer local copies (no network needed); otherwise download from storage
  const files: { uri: string; mime: string }[] = [];
  if (b64s.length) {
    for (let i = 0; i < b64s.length; i++) {
      try {
        const uri = `${FileSystem.cacheDirectory}${SHARE_FILE_PREFIX}smith_${Date.now()}_${i}.jpg`;
        await FileSystem.writeAsStringAsync(uri, b64s[i], { encoding: FileSystem.EncodingType.Base64 });
        files.push({ uri, mime: 'image/jpeg' });
      } catch (e: any) {
        console.warn('Could not write local image', e);
      }
    }
  } else {
    const downloaded = await Promise.all(urls.map((u, i) => downloadToCache(u, i)));
    files.push(...downloaded.filter((d): d is { uri: string; mime: string } => !!d));
  }

  if (!files.length) {
    debugToast('Could not prepare the picture (check internet / bucket is public). Sending text only.');
    await openWhatsApp(message, phone);
    return;
  }

  await Clipboard.setStringAsync(message); // safety net if WhatsApp drops the caption

  const call =
    files.length === 1 && Platform.OS === 'android' && RNShare.shareSingle && RNSocial?.Whatsapp
      ? RNShare.shareSingle({
        social: RNSocial.Whatsapp,
        url: files[0].uri,
        type: files[0].mime,
        message,
        whatsAppNumber: phone ?? undefined,
      })
      : RNShare.open({ urls: files.map((f) => f.uri), type: 'image/*', message, failOnCancel: false });

  const outcome = await launchShare(call);
  if (outcome === 'error') {
    debugToast('WhatsApp photo share failed. Sending text only.');
    await openWhatsApp(message, phone);
  }
}

// =========================================================
// Invoice: PDF + thank-you note + Google review link
// in ONE WhatsApp message.
// The TEXT contains no invoice number, amount, GST or bill details.
// =========================================================

// Fallback if your company settings don't have a review link column.
// Paste your Google review link here (Google Business Profile →
// "Ask for reviews" → copy link, e.g. https://g.page/r/XXXX/review).
// export const DEFAULT_GOOGLE_REVIEW_URL = 'https://g.page/r/CStZEpxYDNSqECE/review';
export const DEFAULT_GOOGLE_REVIEW_URL = 'https://g.page/r/CSNGRroWAfTyEBM/review';

export function reviewUrlFromCompany(company: any): string | null {
  const raw =
    company?.google_review_url ??
    company?.google_review_link ??
    company?.review_url ??
    company?.review_link ??
    null;

  const trimmed = raw ? String(raw).trim() : '';
  return trimmed || DEFAULT_GOOGLE_REVIEW_URL || null;
}

export function buildInvoiceThanksMessage(
  invoice: InvoiceDetail,
  shopName: string | null,
  reviewUrl: string | null
): string {
  const lines: string[] = [];
  const name =
    invoice.customer_name && invoice.customer_name !== 'Walk-in Customer' ? invoice.customer_name : 'there';
  lines.push(`Hi ${name},`);
  lines.push(`Thank you for shopping with *${shopName?.trim() || 'us'}*! 🙏`);
  lines.push(...reviewBlock(reviewUrl));
  return lines.join('\n');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Thank-you + Google review block that gets printed at the end of the invoice PDF. */
export function buildThankYouHtmlBlock(shopName: string | null, reviewUrl: string | null): string {
  const name = escapeHtml(shopName ?? 'us');
  const url = reviewUrl ? escapeHtml(reviewUrl) : '';
  return `
  <div style="margin-top:24px;padding:14px 16px;border:1px solid #ddd;border-radius:8px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:#333;page-break-inside:avoid;">
    <div style="font-size:15px;font-weight:bold;margin-bottom:6px;">Thank you for shopping with ${name}! 🙏</div>
    ${url
      ? `<div>We would love to hear your feedback. Please rate us on Google:</div>
           <div style="margin-top:4px;"><a href="${url}" style="color:#0B3D91;word-break:break-all;">${url}</a></div>`
      : ''
    }
  </div>`;
}

/** Inserts a block just before </body> (or appends it if there is no body tag). */
export function appendToHtml(html: string, block: string): string {
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + block : html.slice(0, i) + block + html.slice(i);
}

/**
 * Renders the invoice HTML to a PDF and returns a local file:// URI
 * named after the invoice number (e.g. INV-202609-00024.pdf).
 * NATIVE ONLY (expo-print does not produce a file on web).
 */
export async function createInvoicePdfFile(html: string, invoiceNumber: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const safeName = invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dest = `${FileSystem.cacheDirectory}${safeName}.pdf`;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: dest });
  return dest;
}

// ---------------------------------------------------------
// WEB ONLY: render invoice HTML to a PDF Blob in the browser.
//
// html2pdf.js is loaded from a CDN <script> at runtime instead of via
// import(): Metro's web dev server cannot resolve lazy-loaded chunks
// ("Requiring unknown module"). No npm package is needed.
// ---------------------------------------------------------
const HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
let html2pdfLoading: Promise<any> | null = null;

function loadHtml2Pdf(): Promise<any> {
  const w: any = globalThis as any;
  if (w.html2pdf) return Promise.resolve(w.html2pdf);
  if (html2pdfLoading) return html2pdfLoading;

  html2pdfLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HTML2PDF_CDN;
    s.async = true;
    s.onload = () => (w.html2pdf ? resolve(w.html2pdf) : reject(new Error('html2pdf not available')));
    s.onerror = () => {
      html2pdfLoading = null; // allow retry
      reject(new Error('Could not load the PDF library (check internet connection)'));
    };
    document.head.appendChild(s);
  });
  return html2pdfLoading;
}

/** Call once when the invoice screen opens on web so the first share is instant. */
export function preloadHtml2PdfWeb(): void {
  if (Platform.OS === 'web') void loadHtml2Pdf().catch(() => { });
}

export async function createInvoicePdfBlobWeb(html: string): Promise<Blob> {
  const html2pdf = await loadHtml2Pdf();

  // Split the full HTML document so its <style> blocks and <body> content survive
  // being placed inside a <div>. `body`/`html` selectors are re-pointed to our root.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const css = Array.from(parsed.querySelectorAll('style'))
    .map((st) => st.textContent || '')
    .join('\n')
    .replace(/(^|[},\s])(html|body)(?=\s*[{,])/g, '$1.pdf-root');

  // Outer box is hidden OFF-SCREEN; the element handed to html2pdf is a plain,
  // un-positioned child. (html2pdf clones the element, so an off-screen
  // position on the element itself would produce a blank page.)
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;overflow:visible;pointer-events:none;';

  const root = document.createElement('div');
  root.className = 'pdf-root';
  root.style.cssText = `width:794px;background:#fff;${parsed.body.getAttribute('style') || ''}`;
  root.innerHTML = `<style>${css}</style>${parsed.body.innerHTML}`;

  host.appendChild(root);
  document.body.appendChild(host);

  try {
    // Wait for images (logo etc.) and fonts so they are not captured blank
    await Promise.all(
      Array.from(root.querySelectorAll('img')).map((img: HTMLImageElement) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((r) => {
            img.onload = () => r();
            img.onerror = () => r();
          })
      )
    );
    try {
      await (document as any).fonts?.ready;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 150));

    return await html2pdf()
      .set({
        margin: 0,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: 794,
          x: 0,
          y: 0,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(root)
      .outputPdf('blob');
  } finally {
    document.body.removeChild(host);
  }
}

// WEB: share the PDF via the browser's native share sheet (choose WhatsApp).
// If the browser can't share files: download the PDF, copy the note, and open
// the customer's WhatsApp Web chat with the note prefilled (user attaches the PDF).
async function shareInvoiceOnWeb(
  getPdfBlob: () => Promise<Blob>,
  invoiceNumber: string,
  message: string,
  phone: string | null
): Promise<void> {
  const blob = await getPdfBlob();
  const fileName = `${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  const FileCtor: any = (globalThis as any).File;

  // 1) Native share sheet with the PDF attached
  if (FileCtor && nav?.share && nav?.canShare) {
    const file = new FileCtor([blob], fileName, { type: 'application/pdf' });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], text: message });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // user closed the sheet
        // otherwise fall through to the download fallback
      }
    }
  }

  // 2) Fallback: download the PDF + copy the note + open WhatsApp chat
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  try {
    await nav?.clipboard?.writeText(message);
  } catch {
    /* ignore */
  }

  await openWhatsApp(message, phone); // text goes in the chat; user attaches the downloaded PDF
}

/**
 * One tap: PDF + thank-you note + review link in a single WhatsApp message.
 *
 * - Dev build / production build: uses react-native-share to open the
 *   customer's WhatsApp chat with the PDF attached and the note as caption.
 * - Web: browser share sheet with the PDF (or download + WhatsApp Web text).
 * - Expo Go / WhatsApp missing: copies the note to the clipboard and opens the
 *   normal share sheet with the PDF; the user pastes the note as the caption.
 */
export async function shareInvoiceOnWhatsApp(params: {
  invoice: InvoiceDetail;
  shopName: string | null;
  reviewUrl: string | null;
  /** Returns a local file:// URI of the generated PDF (native). */
  getPdfUri: () => Promise<string>;
  /** Returns the PDF as a Blob (web). */
  getPdfBlob?: () => Promise<Blob>;
  /** Plain share sheet / print dialog, used as fallback. */
  sharePdfFallback: () => Promise<void>;
}): Promise<void> {
  const { invoice, shopName, reviewUrl, getPdfUri, getPdfBlob, sharePdfFallback } = params;

  const message = buildInvoiceThanksMessage(invoice, shopName, reviewUrl);
  const phone = normalizeWhatsAppPhone(invoice.customer_mobile);

  if (Platform.OS === 'web') {
    if (getPdfBlob) {
      try {
        await shareInvoiceOnWeb(getPdfBlob, invoice.invoice_number, message, phone);
        return;
      } catch (e) {
        console.warn('Web WhatsApp share failed, falling back', e);
      }
    }
    await sharePdfFallback();
    return;
  }

  const pdfUri = await getPdfUri();

  // WhatsApp often ignores the text when a PDF is attached, so the note is
  // always on the clipboard as a safety net. Paste it into the caption box
  // if it doesn't appear on its own.
  await Clipboard.setStringAsync(message);
  if (Platform.OS === 'android') {
    ToastAndroid.show('Note copied. If the caption is empty, long-press and paste.', ToastAndroid.LONG);
  }

  // Native module missing (Expo Go)
  if (!RNShare?.shareSingle || !RNSocial?.Whatsapp) {
    Alert.alert('Message copied', 'Pick WhatsApp, then paste the message as the caption.', [
      { text: 'OK', onPress: () => void sharePdfFallback() },
    ]);
    return;
  }

  try {
    await RNShare.shareSingle({
      social: RNSocial.Whatsapp,
      url: pdfUri,
      type: 'application/pdf',
      filename: invoice.invoice_number,
      message,
      whatsAppNumber: phone ?? undefined, // opens the customer's chat directly
    });
  } catch (e: any) {
    const msg = String(e?.message ?? '').toLowerCase();

    // User closed WhatsApp / cancelled -> do nothing
    if (msg.includes('cancel') || msg.includes('did not share')) return;

    // WhatsApp not installed or intent failed -> normal share sheet
    await sharePdfFallback();
  }
}

// =========================================================
// Discount broadcast: one customer at a time
// (the note is whatever the user types; the review link is added
// automatically by wrapWithShopInfo)
// =========================================================
export async function shareDiscountToCustomer(params: {
  imageUri: string;
  note: string;
  customerName: string | null;
  phone: string;
  shop?: ShopShareInfo | null;
}): Promise<ShareResult> {
  const { imageUri, note, customerName, phone, shop } = params;

  const greeting = customerName ? `Hi ${customerName},\n\n` : '';
  const caption = wrapWithShopInfo(`${greeting}${note.trim()}`, shop);
  const mime = mimeFromExt(extFromUrl(imageUri));

  // Expo Go / web: no native share module, so send the text only
  if (Platform.OS === 'web' || !RNShare) {
    await openWhatsApp(caption, phone);
    return 'shared';
  }

  // Safety net: WhatsApp can drop the caption, so keep it on the clipboard
  await Clipboard.setStringAsync(caption);

  const call =
    Platform.OS === 'android' && RNShare.shareSingle && RNSocial?.Whatsapp
      ? RNShare.shareSingle({
        social: RNSocial.Whatsapp,
        url: imageUri,
        type: mime,
        message: caption,
        whatsAppNumber: phone, // opens this customer's chat directly
      })
      : RNShare.open({ urls: [imageUri], type: mime, message: caption, failOnCancel: false });

  const outcome = await launchShare(call);
  if (outcome === 'cancelled') return 'cancelled';
  if (outcome === 'error') await openWhatsApp(caption, phone);
  return 'shared';
}

// =========================================================
// Estimate: thermal-style PDF + short note + shop location on WhatsApp
// (no review link). No amount in the text. `amount` is still accepted (and ignored)
// so existing callers keep compiling.
// =========================================================

export function buildEstimateShareMessage(
  customerName: string | null,
  shopName: string | null,
  _amount?: number,
  shop?: ShopShareInfo | null
): string {
  const name = customerName && customerName !== 'Walk-in Customer' ? customerName : 'there';
  const lines: string[] = [
    `Hi ${name},`,
    `Your estimate from *${shopName?.trim() || shop?.name?.trim() || 'us'}* is attached.`,
    '',
  ];

  if (shop?.address || shop?.mapsUrl) {
    lines.push('📍 *Visit us*');
    if (shop.address) lines.push(shop.address);
    if (shop.mapsUrl) lines.push(shop.mapsUrl);
    lines.push('');
  }

  lines.push('Thank you! 🙏');
  return lines.join('\n');
}

/**
 * Renders thermal receipt HTML to a narrow, tall PDF (looks like the paper slip).
 * widthPt: 226 ≈ 80 mm paper, 164 ≈ 58 mm paper.
 * Height cannot be measured by expo-print, so the caller passes an estimate.
 */
export async function createThermalPdfFile(
  html: string,
  fileBaseName: string,
  opts: { widthPt?: number; heightPt: number }
): Promise<string> {
  const widthPt = opts.widthPt ?? 226;
  const reset = '<style>@page{margin:0}html,body{margin:0;padding:0}</style>';
  const fullHtml = html.includes('</head>') ? html.replace('</head>', `${reset}</head>`) : reset + html;

  const { uri } = await Print.printToFileAsync({ html: fullHtml, width: widthPt, height: opts.heightPt });
  const safe = fileBaseName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dest = `${FileSystem.cacheDirectory}${safe}.pdf`;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: dest });
  return dest;
}

export async function shareEstimateOnWhatsApp(params: {
  html: string;
  customerName: string | null;
  customerPhone: string | null;
  shopName: string | null;
  amount?: number; // kept for compatibility, not used in the message
  shop?: ShopShareInfo | null; // optional; loaded from company settings if not given
  heightPt: number;
  widthPt?: number;
}): Promise<void> {
  const { html, customerName, customerPhone, shopName, heightPt, widthPt } = params;

  // Location link comes from the shop info (fetched here if the caller did not pass it)
  let shopInfo: ShopShareInfo | null = params.shop ?? null;
  if (!shopInfo) {
    try {
      shopInfo = await getShopShareInfo();
    } catch {
      shopInfo = null;
    }
  }

  const message = buildEstimateShareMessage(customerName, shopName, undefined, shopInfo);
  const phone = normalizeWhatsAppPhone(customerPhone);

  // ---- Web: A4 PDF through the browser share sheet ----
  if (Platform.OS === 'web') {
    await shareInvoiceOnWeb(() => createInvoicePdfBlobWeb(html), 'Estimate', message, phone);
    return;
  }

  // ---- No native share module (Expo Go): text only ----
  if (!RNShare) {
    await openWhatsApp(message, phone);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const pdfUri = await createThermalPdfFile(html, `Estimate_${stamp}`, { widthPt, heightPt });

  await Clipboard.setStringAsync(message); // safety net if WhatsApp drops the caption
  if (Platform.OS === 'android') {
    ToastAndroid.show('Note copied. If the caption is empty, long-press and paste.', ToastAndroid.LONG);
  }

  const call =
    Platform.OS === 'android' && RNShare.shareSingle && RNSocial?.Whatsapp
      ? RNShare.shareSingle({
        social: RNSocial.Whatsapp,
        url: pdfUri,
        type: 'application/pdf',
        filename: 'Estimate',
        message,
        whatsAppNumber: phone ?? undefined,
      })
      : RNShare.open({ urls: [pdfUri], type: 'application/pdf', message, failOnCancel: false });

  const outcome = await launchShare(call);
  if (outcome === 'error') await openWhatsApp(message, phone); // last resort: text only
}

// =========================================================
// Repair / service receipt: PDF + short note on WhatsApp
// (no amounts or receipt details in the text)
//  - before delivery: "receipt attached" + review link
//  - after delivery:  thank you + review link
// =========================================================
export function buildRepairShareMessage(
  customerName: string,
  shopName: string | null,
  opts?: { delivered?: boolean; reviewUrl?: string | null }
): string {
  const shop = shopName?.trim() || 'us';
  const lines: string[] = [`Hi ${customerName || 'there'},`];

  if (opts?.delivered) {
    lines.push(`Thank you for choosing *${shop}*! 🙏`);
  } else {
    lines.push(`Your repair receipt from *${shop}* is attached.`, '', 'Thank you! 🙏');
  }
  lines.push(...reviewBlock(opts?.reviewUrl));
  return lines.join('\n');
}

export async function shareRepairReceiptOnWhatsApp(params: {
  html: string;
  receipt: {
    receiptNo: string; // only used for the PDF file name
    customerName: string;
    phone: string;
  };
  shopName: string | null;
  heightPt: number;
  widthPt?: number;
  delivered?: boolean;
  reviewUrl?: string | null;
}): Promise<void> {
  const { html, receipt, shopName, heightPt, widthPt, delivered, reviewUrl } = params;

  const message = buildRepairShareMessage(receipt.customerName, shopName, { delivered, reviewUrl });
  const phone = normalizeWhatsAppPhone(receipt.phone);

  if (Platform.OS === 'web') {
    await shareInvoiceOnWeb(() => createInvoicePdfBlobWeb(html), receipt.receiptNo, message, phone);
    return;
  }

  if (!RNShare) {
    await openWhatsApp(message, phone);
    return;
  }

  const pdfUri = await createThermalPdfFile(html, receipt.receiptNo, { widthPt, heightPt });

  await Clipboard.setStringAsync(message);
  if (Platform.OS === 'android') {
    ToastAndroid.show('Note copied. If the caption is empty, long-press and paste.', ToastAndroid.LONG);
  }

  const call =
    Platform.OS === 'android' && RNShare.shareSingle && RNSocial?.Whatsapp
      ? RNShare.shareSingle({
        social: RNSocial.Whatsapp,
        url: pdfUri,
        type: 'application/pdf',
        filename: receipt.receiptNo,
        message,
        whatsAppNumber: phone ?? undefined,
      })
      : RNShare.open({ urls: [pdfUri], type: 'application/pdf', message, failOnCancel: false });

  const outcome = await launchShare(call);
  if (outcome === 'error') await openWhatsApp(message, phone);
}

// =========================================================
// Repair ready message (text only): item + location link + review link.
// No receipt number, no amounts.
// =========================================================
export function buildRepairReadyMessage(
  customerName: string | null,
  item: string,
  shop: ShopShareInfo
): string {
  const lines: string[] = [`*${shop.name}*`, ''];

  lines.push(customerName ? `Hello ${customerName},` : 'Hello,');
  lines.push('Your jewel is ready! 🎉', '');
  lines.push(`Item: ${item}`);

  if (shop.address || shop.mapsUrl) {
    lines.push('', '📍 *Collect it from us*');
    if (shop.address) lines.push(shop.address);
    if (shop.mapsUrl) lines.push(shop.mapsUrl);
  }

  lines.push('', 'Thank you for choosing us!');
  lines.push(...reviewBlock(shop.reviewUrl));
  return lines.join('\n');
}

export async function shareRepairReadyOnWhatsApp(params: {
  customerName: string | null;
  customerPhone: string | null;
  item: string;
  shop: ShopShareInfo;
}): Promise<void> {
  const { customerName, customerPhone, item, shop } = params;
  const message = buildRepairReadyMessage(customerName, item, shop);
  const phone = normalizeWhatsAppPhone(customerPhone);
  await openWhatsApp(message, phone);
}

// ===================================================================
// Generic "PDF + note on WhatsApp" - used by the cash purchase receipt
// (the caller supplies `message`; build it with the helpers below so
// it contains no amounts and includes the review link)
// ===================================================================

export async function shareReceiptPdfOnWhatsApp(params: {
  html: string;
  fileName: string;
  message: string;
  phone: string | null;
  heightPt: number;
  widthPt?: number;
}): Promise<void> {
  const { html, fileName, message, heightPt, widthPt } = params;
  const phone = normalizeWhatsAppPhone(params.phone);

  // Web: browser share sheet with the PDF
  if (Platform.OS === 'web') {
    await shareInvoiceOnWeb(() => createInvoicePdfBlobWeb(html), fileName, message, phone);
    return;
  }

  // No native share module (Expo Go): text only
  if (!RNShare) {
    await openWhatsApp(message, phone);
    return;
  }

  const pdfUri = await createThermalPdfFile(html, fileName, { widthPt, heightPt });

  await Clipboard.setStringAsync(message); // safety net if WhatsApp drops the caption
  if (Platform.OS === 'android') {
    ToastAndroid.show('Note copied. If the caption is empty, long-press and paste.', ToastAndroid.LONG);
  }

  const call =
    Platform.OS === 'android' && RNShare.shareSingle && RNSocial?.Whatsapp
      ? RNShare.shareSingle({
        social: RNSocial.Whatsapp,
        url: pdfUri,
        type: 'application/pdf',
        filename: fileName,
        message,
        whatsAppNumber: phone ?? undefined,
      })
      : RNShare.open({ urls: [pdfUri], type: 'application/pdf', message, failOnCancel: false });

  const outcome = await launchShare(call);
  if (outcome === 'error') await openWhatsApp(message, phone); // last resort: text only
}

// =========================================================
// Cash purchase receipt: PDF + thank-you note + Google review link
// No receipt number, amount or payment details in the text.
// =========================================================
export function buildPurchaseReceiptShareMessage(
  customerName: string | null,
  shopName: string | null,
  reviewUrl?: string | null
): string {
  return [
    `Hi ${customerName?.trim() || 'there'},`,
    `Your cash purchase receipt from *${shopName?.trim() || 'us'}* is attached.`,
    '',
    `Thank you for choosing *${shopName?.trim() || 'us'}*! 🙏`,
    ...reviewBlock(reviewUrl),
  ].join('\n');
}

export async function sharePurchaseReceiptOnWhatsApp(params: {
  html: string;
  receiptNo: string; // only used for the PDF file name
  customerName: string | null;
  customerPhone: string | null;
  shopName: string | null;
  reviewUrl?: string | null; // optional; falls back to the default review link
  heightPt: number;
  widthPt?: number;
}): Promise<void> {
  const { html, receiptNo, customerName, customerPhone, shopName, reviewUrl, heightPt, widthPt } = params;

  await shareReceiptPdfOnWhatsApp({
    html,
    fileName: receiptNo,
    message: buildPurchaseReceiptShareMessage(customerName, shopName, reviewUrl),
    phone: customerPhone,
    heightPt,
    widthPt,
  });
}