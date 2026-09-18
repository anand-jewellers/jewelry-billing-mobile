// supabase/functions/fetch-metal-rates/index.ts
//
// Deploy:   supabase functions deploy fetch-metal-rates
// Schedule: Supabase Dashboard -> Edge Functions -> fetch-metal-rates -> Cron Trigger
//           e.g. "0 4 * * *" (04:00 UTC = 09:30 IST) so today's rate is ready before opening.
// Secrets:  supabase secrets set METAL_API_KEY=xxxx
//
// This example calls goldapi.io (https://www.goldapi.io) — swap fetchSpotPricePerGram24k()
// for whichever provider you have a key for (metals-api.com, metalpriceapi.com, etc.)
// all follow a similar "spot price per troy ounce/gram" response shape.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const METAL_API_KEY = Deno.env.get('METAL_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Purity name (must match `purities.name` exactly) -> fraction of pure metal.
// Add a row here whenever a new purity is added to the `purities` table, or it
// will be skipped (see the `factor === null` check below) rather than silently
// mispriced.
const GOLD_PURITY_FACTORS: Record<string, number> = {
  '24K': 1,
  '22K': 22 / 24,
  '20K': 20 / 24,
  '18K': 18 / 24,
  '14K': 14 / 24,
};

const SILVER_PURITY_FACTORS: Record<string, number> = {
  '999': 1,
  '946': 0.946,
  '925': 0.925,
};

async function fetchSpotPricePerGram24k(metalSymbol: 'XAU' | 'XAG'): Promise<number> {
  const res = await fetch(`https://www.goldapi.io/api/${metalSymbol}/INR`, {
    headers: { 'x-access-token': METAL_API_KEY, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Rate API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  // goldapi.io returns price_gram_24k directly for gold; for silver use price_gram_24k too
  // (their /XAG endpoint gives pure silver per gram already).
  return json.price_gram_24k as number;
}

Deno.serve(async () => {
  try {
    const { data: metals, error: metalsErr } = await supabase.from('metals').select('id, name').eq('is_active', true);
    if (metalsErr) throw metalsErr;

    const { data: purities, error: puritiesErr } = await supabase
      .from('purities')
      .select('id, name, metal_id')
      .eq('is_active', true);
    if (puritiesErr) throw puritiesErr;

    const rows: any[] = [];
    const skipped: string[] = [];

    for (const metal of metals ?? []) {
      const isGold = /gold/i.test(metal.name);
      const isSilver = /silver/i.test(metal.name);
      if (!isGold && !isSilver) continue; // skip metals you don't have a feed for

      const pricePerGramPure = await fetchSpotPricePerGram24k(isGold ? 'XAU' : 'XAG');

      for (const purity of (purities ?? []).filter((p) => p.metal_id === metal.id)) {
        const factor = isGold
          ? (GOLD_PURITY_FACTORS[purity.name] ?? null)
          : (SILVER_PURITY_FACTORS[purity.name] ?? null);

        if (factor === null) {
          // Unmapped purity name — skip rather than silently insert a wrong
          // (pure-metal) rate. Check the warning in the function logs and
          // either fix the purity name in the DB or add it to the map above.
          skipped.push(`${metal.name} ${purity.name}`);
          console.warn(`No purity factor for ${metal.name} ${purity.name}, skipping`);
          continue;
        }

        rows.push({
          metal_id: metal.id,
          purity_id: purity.id,
          rate_per_gram: Math.round(pricePerGramPure * factor * 100) / 100,
          source: 'auto',
        });
      }
    }

    if (rows.length) {
      const { error: insertErr } = await supabase.from('metal_rates').insert(rows);
      if (insertErr) throw insertErr;
    }

    return new Response(JSON.stringify({ ok: true, inserted: rows.length, skipped }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});