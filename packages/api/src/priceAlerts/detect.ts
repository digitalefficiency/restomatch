/**
 * Price-trend alerts (wave-1 `priceAlerts`) — pure detection, no DB.
 *
 * A (product, supplier) series from price_history is a SUSTAINED increase when,
 * inside the look-back window (windowDays, ending at `now`):
 *   • there are ≥ MIN_OBSERVATIONS observations,
 *   • the latest price is ≥ first price × (1 + thresholdPct), and
 *   • it is not a one-off spike: the later half of the observations all sit at
 *     or above first × (1 + thresholdPct / 2) (the price stayed up).
 * Prices are compared in integer price units (1/10000 ₪, NUMERIC(12,4) scale).
 */

export const MIN_OBSERVATIONS = 3;
export const DEFAULT_THRESHOLD_PCT = 0.1;
export const DEFAULT_WINDOW_DAYS = 21;

export interface PricePoint {
  observedAt: Date;
  /** Shekels (NUMERIC string or number). */
  unitPrice: string | number;
}

export interface ThresholdRule {
  supplierId: string | null;
  category: string | null;
  thresholdPct: number;
  windowDays: number;
  enabled: boolean;
}

export interface ResolvedThreshold {
  thresholdPct: number;
  windowDays: number;
  enabled: boolean;
}

export interface TrendResult {
  startPrice: number;
  endPrice: number;
  /** Fraction, e.g. 0.18 = +18%. */
  pctChange: number;
  startAt: Date;
  endAt: Date;
  observations: number;
}

const DAY_MS = 86_400_000;
const units = (p: string | number): number => Math.round(Number(p) * 10_000);

/**
 * Most specific rule wins: supplier+category > supplier > category > default
 * (both null) > built-in default.
 */
export function resolveThreshold(
  rules: ThresholdRule[],
  supplierId: string,
  category: string | null,
): ResolvedThreshold {
  const rank = (r: ThresholdRule): number => {
    if (r.supplierId && r.supplierId !== supplierId) return -1;
    if (r.category && r.category !== category) return -1;
    return (r.supplierId ? 2 : 0) + (r.category ? 1 : 0);
  };
  let best: ThresholdRule | null = null;
  let bestRank = -1;
  for (const r of rules) {
    const k = rank(r);
    if (k > bestRank) {
      best = r;
      bestRank = k;
    }
  }
  if (!best) {
    return { thresholdPct: DEFAULT_THRESHOLD_PCT, windowDays: DEFAULT_WINDOW_DAYS, enabled: true };
  }
  return { thresholdPct: best.thresholdPct, windowDays: best.windowDays, enabled: best.enabled };
}

/** Detect a sustained increase in one series, or null. */
export function detectSustainedIncrease(
  points: PricePoint[],
  threshold: Pick<ResolvedThreshold, 'thresholdPct' | 'windowDays'>,
  now: Date,
): TrendResult | null {
  const from = now.getTime() - threshold.windowDays * DAY_MS;
  const inWindow = points
    .filter((p) => p.observedAt.getTime() > from && p.observedAt.getTime() <= now.getTime())
    .filter((p) => Number.isFinite(Number(p.unitPrice)) && Number(p.unitPrice) > 0)
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  if (inWindow.length < MIN_OBSERVATIONS) return null;

  const first = inWindow[0]!;
  const last = inWindow[inWindow.length - 1]!;
  const start = units(first.unitPrice);
  const end = units(last.unitPrice);
  if (start <= 0 || end <= start) return null;

  const pct = (end - start) / start;
  if (pct + 1e-9 < threshold.thresholdPct) return null;

  const holdFloor = start * (1 + threshold.thresholdPct / 2);
  const laterHalf = inWindow.slice(Math.floor(inWindow.length / 2));
  if (laterHalf.some((p) => units(p.unitPrice) + 1e-9 < holdFloor)) return null;

  return {
    startPrice: start / 10_000,
    endPrice: end / 10_000,
    pctChange: Math.round(pct * 10_000) / 10_000,
    startAt: first.observedAt,
    endAt: last.observedAt,
    observations: inWindow.length,
  };
}

/** Lowest offer strictly below `currentPrice` among other suppliers, or null. */
export function cheaperOffer(
  currentPrice: number,
  offers: Array<{ supplierId: string; price: number }>,
): { supplierId: string; price: number } | null {
  let best: { supplierId: string; price: number } | null = null;
  for (const o of offers) {
    if (!(o.price > 0) || units(o.price) >= units(currentPrice)) continue;
    if (!best || o.price < best.price) best = o;
  }
  return best;
}
