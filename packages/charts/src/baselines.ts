import { and, eq, gte, priceBaselines, priceHistory, sql, type Database } from '@restomatch/db';

export interface ComputeBaselinesOptions {
  /** Look back this many days when computing percentiles. */
  windowDays?: number;
  /** Minimum samples required before a baseline is meaningful. */
  minSamples?: number;
}

export interface BaselineRow {
  productId: string;
  supplierId: string;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
  sampleSize: number;
}

/**
 * Compute price baselines for each (product, supplier) pair in the
 * restaurant, using Postgres percentile_cont over the last N days.
 *
 * Returns the rows (also useful for tests) and upserts each one into
 * `price_baselines` keyed by (product_id, supplier_id, window_days).
 */
export async function computeBaselines(
  db: Database,
  restaurantId: string,
  options: ComputeBaselinesOptions = {},
): Promise<BaselineRow[]> {
  const windowDays = options.windowDays ?? 90;
  const minSamples = options.minSamples ?? 3;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      p50: sql<string>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${priceHistory.unitPrice})`.as(
        'p50',
      ),
      p90: sql<string>`PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ${priceHistory.unitPrice})`.as(
        'p90',
      ),
      mean: sql<string>`AVG(${priceHistory.unitPrice})`.as('mean'),
      stddev: sql<string>`COALESCE(STDDEV_POP(${priceHistory.unitPrice}), 0)`.as('stddev'),
      sampleSize: sql<string>`COUNT(*)`.as('sample_size'),
    })
    .from(priceHistory)
    .where(and(eq(priceHistory.restaurantId, restaurantId), gte(priceHistory.observedAt, since)))
    .groupBy(priceHistory.productId, priceHistory.supplierId)
    .having(sql`COUNT(*) >= ${minSamples}`);

  const baselines: BaselineRow[] = rows.map((r) => ({
    productId: r.productId,
    supplierId: r.supplierId,
    p50: Number(r.p50),
    p90: Number(r.p90),
    mean: Number(r.mean),
    stddev: Number(r.stddev),
    sampleSize: Number(r.sampleSize),
  }));

  // Upsert each — manual since Drizzle's onConflictDoUpdate per-row needs explicit chaining
  for (const b of baselines) {
    const existing = await db
      .select({ id: priceBaselines.id })
      .from(priceBaselines)
      .where(
        and(
          eq(priceBaselines.productId, b.productId),
          eq(priceBaselines.supplierId, b.supplierId),
          eq(priceBaselines.windowDays, windowDays),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(priceBaselines)
        .set({
          p50: b.p50.toString(),
          p90: b.p90.toString(),
          mean: b.mean.toString(),
          stddev: b.stddev.toString(),
          sampleSize: b.sampleSize,
          computedAt: new Date(),
        })
        .where(eq(priceBaselines.id, existing[0].id));
    } else {
      await db.insert(priceBaselines).values({
        restaurantId,
        productId: b.productId,
        supplierId: b.supplierId,
        windowDays,
        p50: b.p50.toString(),
        p90: b.p90.toString(),
        mean: b.mean.toString(),
        stddev: b.stddev.toString(),
        sampleSize: b.sampleSize,
      });
    }
  }

  return baselines;
}
