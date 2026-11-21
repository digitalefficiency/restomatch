import {
  and,
  eq,
  gt,
  inArray,
  priceAlertThresholds,
  priceHistory,
  products,
  restaurants,
  supplierContractPrices,
  type Database,
} from '@restomatch/db';
import { contractInForce, contractPriceInUnit, localDateKey } from '../contracts/core';
import { detectSustainedIncrease, resolveThreshold, type PricePoint, type ThresholdRule } from './detect';

/**
 * W2-12 price-alert impact — the "≈₪N בחודש (הערכה)" estimate, the tone rule,
 * and the threshold preview. Read-only; every query is restaurant-scoped.
 *
 * An ESTIMATE, never part of the leak figure: it says what the price rise costs
 * per month if the restaurant keeps buying what it bought in the last 90 days.
 *
 *   monthly ≈ (end − start) × Σ qty invoiced in the last 90 days ÷ 3
 *
 * Computed in integer arithmetic (price units = 1/10000 ₪, qty in 1/1000) with
 * ONE half-up rounding to agorot at the end.
 */

/** The T2 floor: an alert is act-now only at ≥ this many ₪ per month (code constant; a per-threshold column is H-04). */
export const PRICE_ALERT_T2_FLOOR_ILS = 50;
/** …and only at ≥ this rise (fraction). */
export const PRICE_ALERT_T2_MIN_PCT = 0.03;
/** The look-back the estimate and the median use. */
export const IMPACT_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;
const DEFAULT_TZ = 'Asia/Jerusalem';

const priceUnits = (v: string | number): bigint => BigInt(Math.round(Number(v) * 10_000));
const qtyMilli = (v: string | number): bigint => BigInt(Math.round(Number(v) * 1000));

/**
 * ≈ monthly cost of a rise, integer agorot (≥ 0). `qty90` is the summed qty of
 * the last 90 days. Half-up: agorot = round(Δunits × qtyMilli ÷ (100 × 1000 × 3)).
 */
export function monthlyImpactAgorot(startPrice: string | number, endPrice: string | number, qty90: string | number): number {
  const delta = priceUnits(endPrice) - priceUnits(startPrice);
  const q = qtyMilli(qty90);
  if (delta <= 0n || q <= 0n) return 0;
  const num = delta * q;
  const den = 100n * 1000n * 3n;
  return Number((2n * num + den) / (2n * den));
}

/** T2 (act-now) only at ≥ 3 % AND ≥ ₪50/month; otherwise T4 neutral. Compared in basis points / agorot. */
export function alertTone(pctChange: string | number, monthlyAgorot: number): 't2' | 't4' {
  const bp = Math.round(Number(pctChange) * 10_000);
  return bp >= Math.round(PRICE_ALERT_T2_MIN_PCT * 10_000) && monthlyAgorot >= PRICE_ALERT_T2_FLOOR_ILS * 100 ? 't2' : 't4';
}

/** Median of positive prices, in ₪ at the 4-dp scale (null when empty). */
export function medianPrice(prices: Array<string | number>): number | null {
  const u = prices.map((p) => Math.round(Number(p) * 10_000)).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (u.length === 0) return null;
  const m = Math.floor(u.length / 2);
  const units = u.length % 2 ? u[m]! : Math.round((u[m - 1]! + u[m]!) / 2);
  return units / 10_000;
}

export interface AlertImpact {
  /** Σ qty invoiced for (product, supplier) in the last 90 days. */
  qty90: number;
  monthlyAgorot: number;
  tone: 't2' | 't4';
  /** 90-day median unit price at this supplier (null without history). */
  median90: number | null;
  /** The contract price in force today in the product's default unit (null when none). */
  contractUnitPrice: number | null;
}

/**
 * Impact of each alert, keyed by alert id. Pass the alerts as loaded by
 * `loadAlertDetails` (product/supplier/start/end/pct).
 */
export async function loadAlertImpacts(
  db: Database,
  restaurantId: string,
  alerts: Array<{ id: string; productId: string; supplierId: string; startPrice: string; endPrice: string; pctChange: string }>,
  opts: { now?: Date } = {},
): Promise<Map<string, AlertImpact>> {
  const out = new Map<string, AlertImpact>();
  if (alerts.length === 0) return out;
  const now = opts.now ?? new Date();
  const [restaurant] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tz = restaurant?.timezone ?? DEFAULT_TZ;
  const productIds = [...new Set(alerts.map((a) => a.productId))];
  const since = new Date(now.getTime() - IMPACT_WINDOW_DAYS * DAY_MS);

  const history = await db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      unitPrice: priceHistory.unitPrice,
      qty: priceHistory.qty,
      observedAt: priceHistory.observedAt,
    })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        inArray(priceHistory.productId, productIds),
        gt(priceHistory.observedAt, since),
      ),
    );
  const contracts = await db
    .select({
      id: supplierContractPrices.id,
      supplierId: supplierContractPrices.supplierId,
      productId: supplierContractPrices.productId,
      unit: supplierContractPrices.unit,
      defaultUnit: products.defaultUnit,
      contractPrice: supplierContractPrices.contractPrice,
      validFrom: supplierContractPrices.validFrom,
      validTo: supplierContractPrices.validTo,
    })
    .from(supplierContractPrices)
    .innerJoin(products, eq(products.id, supplierContractPrices.productId))
    .where(and(eq(supplierContractPrices.restaurantId, restaurantId), inArray(supplierContractPrices.productId, productIds)));
  const today = localDateKey(now, tz);

  for (const a of alerts) {
    const series = history.filter(
      (h) => h.productId === a.productId && h.supplierId === a.supplierId && h.observedAt.getTime() <= now.getTime(),
    );
    const qtyM = series.reduce((s, h) => s + (h.qty == null ? 0n : qtyMilli(h.qty)), 0n);
    const qty90 = Number(qtyM) / 1000;
    const monthlyAgorot = monthlyImpactAgorot(a.startPrice, a.endPrice, qty90);
    const rows = contracts
      .filter((c) => c.productId === a.productId && c.supplierId === a.supplierId)
      .map((c) => ({ ...c, unit: c.unit ?? c.defaultUnit }));
    const inForce = contractInForce(rows, today);
    out.set(a.id, {
      qty90,
      monthlyAgorot,
      tone: alertTone(a.pctChange, monthlyAgorot),
      median90: medianPrice(series.map((h) => h.unitPrice)),
      contractUnitPrice: inForce ? contractPriceInUnit(inForce, inForce.defaultUnit ?? inForce.unit ?? '') : null,
    });
  }
  return out;
}

export interface ThresholdPreviewInput {
  supplierId: string | null;
  category: string | null;
  thresholdPct: number;
  windowDays: number;
}

/**
 * How many (product, supplier) series WOULD have alerted at least once in the
 * last 90 days under a candidate rule — re-runs the pure detector at weekly
 * checkpoints over the stored price history. Writes nothing.
 *
 * The candidate replaces the rule for its own scope; series outside the scope
 * keep their current rule (so the number is what this edit would change to).
 */
export async function previewThresholdCount(
  db: Database,
  restaurantId: string,
  input: ThresholdPreviewInput,
  opts: { now?: Date } = {},
): Promise<{ count: number; series: number }> {
  const now = opts.now ?? new Date();
  const [restaurant] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tz = restaurant?.timezone ?? DEFAULT_TZ;
  const stored: ThresholdRule[] = (
    await db
      .select({
        supplierId: priceAlertThresholds.supplierId,
        category: priceAlertThresholds.category,
        thresholdPct: priceAlertThresholds.thresholdPct,
        windowDays: priceAlertThresholds.windowDays,
        enabled: priceAlertThresholds.enabled,
      })
      .from(priceAlertThresholds)
      .where(eq(priceAlertThresholds.restaurantId, restaurantId))
  ).map((r) => ({ ...r, thresholdPct: Number(r.thresholdPct) }));
  const rules: ThresholdRule[] = [
    ...stored.filter((r) => !(r.supplierId === input.supplierId && r.category === input.category)),
    { supplierId: input.supplierId, category: input.category, thresholdPct: input.thresholdPct, windowDays: input.windowDays, enabled: true },
  ];

  const maxWindow = Math.max(input.windowDays, ...rules.map((r) => r.windowDays));
  const since = new Date(now.getTime() - (IMPACT_WINDOW_DAYS + maxWindow) * DAY_MS);
  const rows = await db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      observedAt: priceHistory.observedAt,
      unitPrice: priceHistory.unitPrice,
      category: products.category,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(and(eq(priceHistory.restaurantId, restaurantId), gt(priceHistory.observedAt, since)));

  const series = new Map<string, { supplierId: string; category: string | null; points: PricePoint[] }>();
  for (const r of rows) {
    if (input.supplierId && r.supplierId !== input.supplierId) continue;
    if (input.category && r.category !== input.category) continue;
    const k = `${r.productId}:${r.supplierId}`;
    const s = series.get(k) ?? { supplierId: r.supplierId, category: r.category, points: [] };
    s.points.push({ observedAt: r.observedAt, unitPrice: r.unitPrice });
    series.set(k, s);
  }

  let count = 0;
  for (const s of series.values()) {
    const th = resolveThreshold(rules, s.supplierId, s.category);
    if (!th.enabled) continue;
    for (let back = 0; back <= IMPACT_WINDOW_DAYS; back += 7) {
      const at = new Date(now.getTime() - back * DAY_MS);
      if (detectSustainedIncrease(s.points, th, at, tz)) {
        count += 1;
        break;
      }
    }
  }
  return { count, series: series.size };
}
