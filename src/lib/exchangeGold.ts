// src\lib\exchangeGold.ts

export interface ExchangeItemInput {
  gross_weight: number;
  stone_weight: number;
  purity_percent: number;
  old_percent: number;
  deduction_percent: number;
  rate_per_gram: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
// DISPLAY ONLY: weight after removing stone/dust, before the old % is applied.
// The saved net_weight (with old % applied) is still what the amount uses.
export function displayNetWeight(item: { gross_weight: number; stone_weight?: number | null }): number {
  return round3(Math.max(0, (Number(item.gross_weight) || 0) - (Number(item.stone_weight) || 0)));
}

// Deduction/wastage is simply the inverse of what old_percent pays out —
// 78% old means 22% is deducted. purity_percent (91.6/REG/925 label) is
// descriptive only and does not factor into this — see computeExchangeItem.
export function deductionFromOldPercent(oldPercent: number): number {
  if (!oldPercent || oldPercent <= 0) return 0;
  return round2(Math.max(0, Math.min(100, 100 - oldPercent)));
}

// Matches the physical shop slip exactly:
//   net_weight = (gross_weight − stone_weight) × old_percent / 100
//   amount     = net_weight × rate_per_gram
//
// purity_percent (91.6/REG/925 — the Claimed Purity dropdown) is
// informational only and does NOT factor into the money calculation.
// old_percent (the touchstone/acid-test result) is the only percentage
// applied, directly against the weight left after removing stone.
//
// net_weight keeps 3-decimal precision (matches the slip's "1.092"-style
// figures) — rounding it to 2 decimals before multiplying by rate silently
// loses rupees on the final amount. Only the final money amount is rounded,
// at the very end.
 export function computeExchangeItem(item: ExchangeItemInput): { net_weight: number; amount: number } {
   const metalWeight = Math.max(0, item.gross_weight - item.stone_weight);
   const oldFraction = Math.max(0, Math.min(100, item.old_percent)) / 100;

  const net_weight = round3(metalWeight * oldFraction);
  const amount = Math.round(net_weight * item.rate_per_gram);
  return { net_weight, amount };
}

export function sumExchangeTotal(items: { amount: number }[]): number {
  return round2(items.reduce((sum, i) => sum + (i.amount || 0), 0));
}

// Only these three purity types are used for old-gold exchange. When real
// Purity records exist in the DB, ExchangeGoldModal filters that table down
// to rows whose name matches one of these — this list is the FALLBACK used
// only when no real Purity records are passed in at all.
// 18K added so it shows in the dropdown. Make sure this matches the
// name of your 18K row in the Purity table (e.g. '18K' or '18').
// export const DISPLAY_PURITY_NAMES = ['22K', '18K', '925', 'REG'];

export const COMMON_PURITIES = [
  { id: null, label: '91.6%', percent: 91.6 },
  { id: null, label: '18K (75%)', percent: 75 },
  { id: null, label: 'REG', percent: 91.6 }, // TODO: set REG's real percent
  { id: null, label: '925 (Silver)', percent: 92.5 },
];

// SAADHA is a local option: it uses the 22K (916) purity and rate,
// but starts with 80% as the Old %.
// export const SAADHA_LABEL = 'SAADHA';
export const SAADHA_OLD_PERCENT = 80;

// Default Old % when a purity is selected (the cashier can still change it)
export function defaultOldPercentForPurity(purityPercent: number): number {
  if (Math.abs(purityPercent - 91.6) < 0.05) return 100; // 22K / 916
  if (Math.abs(purityPercent - 75) < 0.05) return 75;    // 18K / 750
  return 0; // anything else: leave empty
}

export const OLD_PERCENT_STEPS: number[] = [60, 65, 70, 75, 80, 85, 90, 95, 100];