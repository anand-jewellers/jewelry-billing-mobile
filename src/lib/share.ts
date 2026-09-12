import { Linking, Platform } from 'react-native';
export interface ShareableProductWithImage extends ShareableProduct {
  imageUrl?: string | null;
}

/**
 * Builds one WhatsApp message covering multiple products. Note: WhatsApp
 * only renders a link-preview thumbnail for the FIRST url it finds in a
 * message, so only the first product's image will show as a preview — the
 * rest are still included as plain tappable links.
 */
export function buildMultiProductShareMessage(products: ShareableProductWithImage[]): string {
  const blocks = products.map((p, i) => {
    const lines: string[] = [`${i + 1}. *${p.product_name}*`, `   Code: ${p.product_code}`];
    if (p.metals?.name) lines.push(`   Metal: ${p.metals.name}y`);
    if (p.purities?.name) lines.push(`   Purity: ${p.purities.name}`);
    if (p.net_weight != null) lines.push(`   Weight: ${Number(p.net_weight).toFixed(3)} g`);
    if (p.imageUrl) lines.push(`   ${p.imageUrl}`);
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

export async function shareProductsOnWhatsApp(products: ShareableProductWithImage[]): Promise<void> {
  if (!products.length) return;
  const message = buildMultiProductShareMessage(products);
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

export async function shareProductOnWhatsApp(
  product: ShareableProduct,
  imageUrl?: string | null
): Promise<void> {
  const lines: string[] = [`*${product.product_name}*`, `Code: ${product.product_code}`];
  if (product.metals?.name) lines.push(`Metal: ${product.metals.name}`);
  if (product.purities?.name) lines.push(`Purity: ${product.purities.name}`);
  if (product.net_weight != null) lines.push(`Weight: ${Number(product.net_weight).toFixed(3)} g`);
  if (imageUrl) lines.push(imageUrl);

  const message = lines.join('\n');
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