import {
  and,
  eq,
  gte,
  priceBaselines,
  priceHistory,
  products,
  sql,
  suppliers,
  type Database,
} from '@restomatch/db';

export interface LeakRow {
  productId: string;
  productName: string;
  category: string | null;
  supplierId: string;
  supplierName: string;
  baselineP50: number;
  baselineP90: number;
  lastObservedPrice: number;
  lastObservedAt: string;
  deltaPct: number;
  monthExcessIls: number;
  /** Recent unit-price observations (oldest → newest) for a sparkline. */
  series: number[];
}

export interface ComputeLeaksOptions {
  windowDays?: number;
  limit?: number;
  minDeltaPct?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Top "leak" candidates — products where the most recent invoice price exceeds
 * the supplier's p90 baseline by more than `minDeltaPct` (default 5%).
 *
 * Month excess is quantified from the REAL last-30-day quantity (falling back
 * to the observation count, then 1) instead of a constant.
 */
export async function computeLeaks(
  db: Database,
  restaurantId: string,
  options: ComputeLeaksOptions = {},
): Promise<LeakRow[]> {
  const limit = options.limit ?? 20;
  const minDeltaPct = options.minDeltaPct ?? 0.05;
  const windowDays = options.windowDays ?? 90;
  const monthlySince = new Date(Date.now() - 30 * DAY_MS);

  // Latest observed price per (product, supplier).
  const latestPricesSubquery = db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      maxObservedAt: sql<Date>`MAX(${priceHistory.observedAt})`.as('max_observed_at'),
    })
    .from(priceHistory)
    .where(eq(priceHistory.restaurantId, restaurantId))
    .groupBy(priceHistory.productId, priceHistory.supplierId)
    .as('latest');

  // Real 30-day quantity + observation count per (product, supplier).
  const monthlyQtySubquery = db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      qtySum: sql<string>`COALESCE(SUM(${priceHistory.qty}), 0)`.as('qty_sum'),
      obsCount: sql<string>`COUNT(*)`.as('obs_count'),
    })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        gte(priceHistory.observedAt, monthlySince),
      ),
    )
    .groupBy(priceHistory.productId, priceHistory.supplierId)
    .as('monthly');

  const rows = await db
    .select({
      productId: products.id,
      productName: products.canonicalName,
      category: products.category,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      baselineP50: priceBaselines.p50,
      baselineP90: priceBaselines.p90,
      lastObservedPrice: priceHistory.unitPrice,
      lastObservedAt: priceHistory.observedAt,
      qtySum: monthlyQtySubquery.qtySum,
      obsCount: monthlyQtySubquery.obsCount,
    })
    .from(priceHistory)
    .innerJoin(
      latestPricesSubquery,
      and(
        eq(latestPricesSubquery.productId, priceHistory.productId),
        eq(latestPricesSubquery.supplierId, priceHistory.supplierId),
        eq(latestPricesSubquery.maxObservedAt, priceHistory.observedAt),
      ),
    )
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .innerJoin(suppliers, eq(suppliers.id, priceHistory.supplierId))
    .leftJoin(
      priceBaselines,
      and(
        eq(priceBaselines.productId, priceHistory.productId),
        eq(priceBaselines.supplierId, priceHistory.supplierId),
        eq(priceBaselines.windowDays, windowDays),
      ),
    )
    .leftJoin(
      monthlyQtySubquery,
      and(
        eq(monthlyQtySubquery.productId, priceHistory.productId),
        eq(monthlyQtySubquery.supplierId, priceHistory.supplierId),
      ),
    )
    .where(eq(priceHistory.restaurantId, restaurantId));

  const leaks: LeakRow[] = [];
  for (const r of rows) {
    if (!r.baselineP90 || !r.baselineP50) continue;
    const p50 = Number(r.baselineP50);
    const p90 = Number(r.baselineP90);
    const actual = Number(r.lastObservedPrice);
    if (actual <= p90) continue;
    const deltaPct = (actual - p50) / p50;
    if (deltaPct < minDeltaPct) continue;

    const qtySum = Number(r.qtySum ?? 0);
    const obsCount = Number(r.obsCount ?? 0);
    const monthlyQty = qtySum > 0 ? qtySum : obsCount > 0 ? obsCount : 1;

    leaks.push({
      productId: r.productId,
      productName: r.productName,
      category: r.category,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      baselineP50: p50,
      baselineP90: p90,
      lastObservedPrice: actual,
      lastObservedAt: r.lastObservedAt.toISOString(),
      deltaPct,
      monthExcessIls: (actual - p50) * monthlyQty,
      series: [],
    });
  }

  leaks.sort((a, b) => b.deltaPct - a.deltaPct || b.monthExcessIls - a.monthExcessIls);
  const top = leaks.slice(0, limit);

  // Attach a recent price series per leak (one batch query) for sparklines.
  if (top.length > 0) {
    const seriesSince = new Date(Date.now() - windowDays * DAY_MS);
    const points = await db
      .select({
        productId: priceHistory.productId,
        supplierId: priceHistory.supplierId,
        unitPrice: priceHistory.unitPrice,
      })
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.restaurantId, restaurantId),
          gte(priceHistory.observedAt, seriesSince),
        ),
      )
      .orderBy(priceHistory.observedAt);

    const byPair = new Map<string, number[]>();
    for (const pt of points) {
      const key = `${pt.productId}|${pt.supplierId}`;
      const arr = byPair.get(key) ?? [];
      arr.push(Number(pt.unitPrice));
      byPair.set(key, arr);
    }
    for (const leak of top) {
      leak.series = (byPair.get(`${leak.productId}|${leak.supplierId}`) ?? []).slice(-12);
    }
  }

  return top;
}
