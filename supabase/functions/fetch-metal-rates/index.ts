// supabase/functions/fetch-metal-rates/index.ts
//
// Deploy:   supabase functions deploy fetch-metal-rates
// Schedule: pg_cron -> invoke-fetch-metal-rates -> 0 4 * * * (04:00 UTC / 9:30 IST)
// Secrets:  supabase secrets set METAL_API_KEY=xxxx   <- no longer required by this
//           version, kept only if you fall back to goldapi.io later.
//
// Source: ibjarates.com — India Bullion and Jewellers Association.
// This is the actual benchmark Indian jewellers price against (RBI-recognized,
// used for gold-loan valuation and sovereign gold bond pricing). Rates already
// include import duty/customs, but EXCLUDE 3% GST and making charges — apply
// those separately at invoice time, same as your existing schema does.
//
// Gold purities (999/995/916/750/585) are shown per 1 GRAM on the page.
// Silver (999 only) is shown per 1 KG in the historical table — divide by 1000.
// On weekends/govt holidays IBJA doesn't publish new rates; the page just
// carries over the last published figure, which is fine for our purposes.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// IBJA purity code -> your purities.name. Only include codes you actually stock.
const GOLD_PURITY_MAP: Record<string, string> = {
  '999': '24K',
  '916': '22K',
  '750': '18K',
  '585': '14K',
};

// You don't have a direct IBJA silver-916/925/946 line, only 999 (fine silver).
// Derive other silver purities as a fraction of the 999 rate, same approach as
// before — adjust this map to match whatever silver purities you actually stock.
const SILVER_PURITY_FACTORS: Record<string, number> = {
  '999': 1,
  '946': 0.946,
  '925': 0.925,
};

interface IbjaRates {
  gold: Record<string, number>; // purity code -> rate per gram
  silverPerGram: number | null;
}

async function fetchIbjaRates(): Promise<IbjaRates> {
  const res = await fetch('https://ibjarates.com/', {
    headers: {
      // Some sites block requests with no browser-like UA — harmless to send.
      'User-Agent': 'Mozilla/5.0 (compatible; jewelry-billing-bot/1.0)',
    },
  });
  if (!res.ok) throw new Error(`IBJA fetch failed: ${res.status}`);
  const html = await res.text();

  const gold: Record<string, number> = {};
  for (const code of Object.keys(GOLD_PURITY_MAP)) {
    const match = html.match(
      new RegExp(`id="GoldRatesCompare${code}">\\s*([\\d.]+)\\s*<`)
    );
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0) gold[code] = value;
    }
  }

  // Silver: pull the first (most recent) row of the AM historical table,
  // "Silver 999" column, which is per KG.
  let silverPerGram: number | null = null;
  const silverMatch = html.match(
    /data-label="Silver 999">\s*([\d.]+)\s*</
  );
  if (silverMatch) {
    const perKg = parseFloat(silverMatch[1]);
    if (!isNaN(perKg) && perKg > 0) silverPerGram = perKg / 1000;
  }

  return { gold, silverPerGram };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const { data: metals, error: metalsErr } = await supabase
      .from('metals')
      .select('id, name')
      .eq('is_active', true);
    if (metalsErr) throw metalsErr;

    const { data: purities, error: puritiesErr } = await supabase
      .from('purities')
      .select('id, name, metal_id')
      .eq('is_active', true);
    if (puritiesErr) throw puritiesErr;

    const ibja = await fetchIbjaRates();

    const rows: any[] = [];
    const skipped: string[] = [];

    for (const metal of metals ?? []) {
      const isGold = /gold/i.test(metal.name);
      const isSilver = /silver/i.test(metal.name);
      if (!isGold && !isSilver) continue;

      for (const purity of (purities ?? []).filter((p) => p.metal_id === metal.id)) {
        let ratePerGram: number | null = null;

        if (isGold) {
          // Reverse-lookup: find the IBJA code whose mapped name matches this purity
          const code = Object.keys(GOLD_PURITY_MAP).find(
            (c) => GOLD_PURITY_MAP[c] === purity.name
          );
          ratePerGram = code ? (ibja.gold[code] ?? null) : null;
        } else if (isSilver && ibja.silverPerGram !== null) {
          const factor = SILVER_PURITY_FACTORS[purity.name] ?? null;
          ratePerGram = factor !== null ? ibja.silverPerGram * factor : null;
        }

        if (ratePerGram === null) {
          skipped.push(`${metal.name} ${purity.name}`);
          console.warn(`No IBJA rate available for ${metal.name} ${purity.name}, skipping`);
          continue;
        }

        rows.push({
          metal_id: metal.id,
          purity_id: purity.id,
          rate_per_gram: Math.round(ratePerGram * 100) / 100,
          source: 'auto',
        });
      }
    }

    if (rows.length) {
      const { error: insertErr } = await supabase.from('metal_rates').insert(rows);
      if (insertErr) throw insertErr;
    }

    return new Response(
      JSON.stringify({ ok: true, inserted: rows.length, skipped, ibja }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});