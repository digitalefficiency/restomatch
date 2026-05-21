import {
  and,
  desc,
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
}

export interface ComputeLeaksOptions {
  windowDays?: number;
  limit?: number;
  minDeltaPct?: number;
}

/**
 * Top "leak" candidates — products where the most recent invoice price
 * exceeds the supplier's p90 baseline by more than `minDeltaPct` (default 5%).
 *
 * Returns rows ordered by impact: deltaPct DESC, then estimated month excess.
 */
export async function computeLeaks(
  db: Database,
  restaurantId: string,
  options: ComputeLeaksOptions = {},
): Promise<LeakRow[]> {
  const limit = options.limit ?? 20;
  const minDeltaPct = options.minDeltaPct ?? 0.05;
  const windowDays = options.windowDays ?? 90;

  // For each (product, supplier) in this restaurant, get:
  //   - the latest observed price
  //   - the latest baseline
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
    // Rough month excess estimate: (actual - p50) × monthly typical qty (10)
    // Replace with real qty aggregation when available.
    const monthExcessIls = (actual - p50) * 10;
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
      monthExcessIls,
    });
  }

  leaks.sort((a, b) => b.deltaPct - a.deltaPct || b.monthExcessIls - a.monthExcessIls);
  return leaks.slice(0, limit);
}

/* unused-import guard */
void desc;
void gte;
