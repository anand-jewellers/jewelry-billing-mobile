// src/lib/pricing.ts

export type CalculationType = 'fixed' | 'per_gram' | 'percentage';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * value      - the numeric charge value entered (e.g. 500 for fixed, 8 for %, 250 for per-gram)
 * netWeight  - product's net weight in grams
 * metalValue - net weight * metal rate, used as the base for percentage charges
 */
export function calcChargeAmount(
  type: CalculationType,
  value: number,
  netWeight: number,
  metalValue: number
): number {
  switch (type) {
    case 'per_gram':
      return value * netWeight;
    case 'percentage':
      return (value / 100) * metalValue;
    case 'fixed':
    default:
      return value;
  }
}

/** Simple percentage GST on the taxable value (metal + making + other charges - discount). */
export function calcGst(taxableValue: number, gstRatePercent: number): number {
  return round2(taxableValue * (gstRatePercent / 100));
}