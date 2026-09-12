// src/lib/liveMetalRate.ts

const METAL_API_KEY = process.env.EXPO_PUBLIC_METAL_API_KEY!;

// Purity name (must match your `purities.name` values exactly) -> fraction of pure gold.
const GOLD_PURITY_FACTORS: Record<string, number> = {
  '24K': 1,
  '22K': 22 / 24,
  '18K': 18 / 24,
  '14K': 14 / 24,
};

/** Returns today's live rate per gram, or null if the API call fails. */
export async function fetchLiveMetalRate(metalName: string, purityName: string): Promise<number | null> {
  try {
    const isGold = /gold/i.test(metalName);
    const isSilver = /silver/i.test(metalName);
    if (!isGold && !isSilver) return null;

    const symbol = isGold ? 'XAU' : 'XAG';
    const res = await fetch(`https://www.goldapi.io/api/${symbol}/INR`, {
      headers: { 'x-access-token': METAL_API_KEY },
    });
    if (!res.ok) {
      console.warn('Metal rate API error', res.status, await res.text());
      return null;
    }

    const json = await res.json();
    const pricePerGramPure = json.price_gram_24k as number;
    const factor = isGold ? (GOLD_PURITY_FACTORS[purityName] ?? 1) : 1;

    return Math.round(pricePerGramPure * factor * 100) / 100;
  } catch (e) {
    console.warn('Failed to fetch live metal rate', e);
    return null;
  }
}