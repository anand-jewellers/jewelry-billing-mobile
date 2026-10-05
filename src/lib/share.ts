import { Linking, Platform } from 'react-native';
import { shopInfoFromCompany } from './whatsappShare'; // adjust path if needed
// import { ShareableProduct } from '...'; // keep your existing import/definition

export interface ShopProductShareInfo {
  name: string;
  website: string | null;
}

export interface ShareableProductWithImage extends ShareableProduct {
  imageUrl?: string | null;
}

/**
 * Builds shop name + website from the company settings row.
 * The name reuses shopInfoFromCompany so both share files stay consistent.
 * Website column names are read defensively; add yours to the chain if different.
 */
export function productShopInfoFromCompany(company: any): ShopProductShareInfo {
  const { name } = shopInfoFromCompany(company);

  const raw = company?.website ?? company?.website_url ?? company?.shop_website ?? company?.web_url ?? null;
  let website = raw ? String(raw).trim() : '';
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;

  return { name, website: website || null };
}

function buildProductLines(
  p: ShareableProduct,
  imageUrl?: string | null,
  indent = ''
): string[] {
  const lines: string[] = [];
  if (p.metals?.name) lines.push(`${indent}Metal: ${p.metals.name}`);
  if (p.purities?.name) lines.push(`${indent}Purity: ${p.purities.name}`);
  if (p.net_weight != null) lines.push(`${indent}Weight: ${Number(p.net_weight).toFixed(3)} g`);
  if (imageUrl) lines.push(`${indent}${imageUrl}`);
  return lines;
}

function wrapWithShopInfo(body: string, shop?: ShopProductShareInfo | null): string {
  const header = shop?.name ? `*${shop.name}*\n\n` : '';
  const footer = shop?.website ? `\n\n${shop.website}` : '';
  return `${header}${body}${footer}`;
}

/**
 * Builds one WhatsApp message covering multiple products. Note: WhatsApp
 * only renders a link-preview thumbnail for the FIRST url it finds in a
 * message, so only the first product's image will show as a preview — the
 * rest are still included as plain tappable links.
 */
export function buildMultiProductShareMessage(
  products: ShareableProductWithImage[],
  shop?: ShopProductShareInfo | null
): string {
  const blocks = products.map((p, i) => {
    const lines = [
      `${i + 1}. *${p.product_name}*`,
      ...buildProductLines(p, p.imageUrl, '   '),
    ];
    return lines.join('\n');
  });
  return wrapWithShopInfo(blocks.join('\n\n'), shop);
}

export function buildSingleProductShareMessage(
  product: ShareableProduct,
  imageUrl?: string | null,
  shop?: ShopProductShareInfo | null
): string {
  const lines = [`*${product.product_name}*`, ...buildProductLines(product, imageUrl)];
  return wrapWithShopInfo(lines.join('\n'), shop);
}

async function openWhatsApp(message: string): Promise<void> {
  const encoded = encodeURIComponent(message);
  const appUrl = `whatsapp://send?text=${encoded}`;
  const webUrl = `https://wa.me/?text=${encoded}`;

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

export async function shareProductsOnWhatsApp(
  products: ShareableProductWithImage[],
  shop?: ShopProductShareInfo | null
): Promise<void> {
  if (!products.length) return;
  await openWhatsApp(buildMultiProductShareMessage(products, shop));
}

export async function shareProductOnWhatsApp(
  product: ShareableProduct,
  imageUrl?: string | null,
  shop?: ShopProductShareInfo | null
): Promise<void> {
  await openWhatsApp(buildSingleProductShareMessage(product, imageUrl, shop));
}