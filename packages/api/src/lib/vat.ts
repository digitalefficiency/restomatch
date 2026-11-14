/**
 * Israel's standard VAT rate since 01.01.2025 (18%), as a fraction. It matches
 * the `restaurants.vat_rate` DB default. Use this one constant wherever a
 * missing VAT rate falls back, so no code path can persist or compute with a
 * stale 0.17.
 */
export const DEFAULT_VAT_RATE = 0.18;

/** NUMERIC vat_rate (Drizzle returns a string) → fraction, falling back to 18%. */
export function vatRateOf(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_VAT_RATE;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_VAT_RATE;
}
