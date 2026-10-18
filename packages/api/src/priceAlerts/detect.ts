/**
 * Price-trend alerts (wave-1 `priceAlerts`) — pure detection, no DB.
 *
 * A (product, supplier) series from price_history is a SUSTAINED increase when,
 * inside the look-back window (windowDays, ending at `now`), after collapsing
 * observations to ONE per restaurant-local day (two lines on one invoice are
 * one point):
 *   • there are ≥ MIN_OBSERVATIONS days,
 *   • baseline = MEDIAN of the earlier half (robust to a one-off promo low),
 *   • the later half's MEAN is ≥ baseline × (1 + thresholdPct),
 *   • no later point is below baseline × (1 + thresholdPct / 2) (it stayed up), and
 *   • it is current: the latest point is in the newer half of the window.
 * Reported pct = later-half mean / baseline − 1.
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
  tz = 'Asia/Jerusalem',
): TrendResult | null {
  const from = now.getTime() - threshold.windowDays * DAY_MS;
  const inWindow = points
    .filter((p) => p.observedAt.getTime() > from && p.observedAt.getTime() <= now.getTime())
    .filter((p) => Number.isFinite(Number(p.unitPrice)) && Number(p.unitPrice) > 0);

  // One point per RESTAURANT-LOCAL calendar day (the day's average, price units).
  const byDay = new Map<string, { observedAt: Date; sum: number; n: number }>();
  for (const p of inWindow) {
    const k = localDay(p.observedAt, tz);
    const e = byDay.get(k) ?? { observedAt: p.observedAt, sum: 0, n: 0 };
    e.sum += units(p.unitPrice);
    e.n += 1;
    if (p.observedAt > e.observedAt) e.observedAt = p.observedAt;
    byDay.set(k, e);
  }
  const days = [...byDay.values()]
    .map((e) => ({ observedAt: e.observedAt, u: Math.round(e.sum / e.n) }))
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  if (days.length < MIN_OBSERVATIONS) return null;

  const last = days[days.length - 1]!;
  // Current: the latest point is in the newer half of the window.
  if (now.getTime() - last.observedAt.getTime() > (threshold.windowDays * DAY_MS) / 2) return null;

  // Robust baseline: MEDIAN of the earlier half, so one promo/credit-line low
  // can't anchor a fake "increase"; the later half's MEAN must clear it.
  const split = Math.floor(days.length / 2);
  const earlier = days.slice(0, split).map((d) => d.u);
  const later = days.slice(split).map((d) => d.u);
  const baseline = median(earlier);
  if (baseline <= 0) return null;
  const laterMean = later.reduce((a, b) => a + b, 0) / later.length;
  if (laterMean + 1e-9 < baseline * (1 + threshold.thresholdPct)) return null;
  // Sustained: no later point fell back to (near) the baseline.
  if (later.some((u) => u + 1e-9 < baseline * (1 + threshold.thresholdPct / 2))) return null;

  return {
    startPrice: Math.round(baseline) / 10_000,
    endPrice: last.u / 10_000,
    pctChange: Math.round((laterMean / baseline - 1) * 10_000) / 10_000,
    startAt: days[0]!.observedAt,
    endAt: last.observedAt,
    observations: days.length,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
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
