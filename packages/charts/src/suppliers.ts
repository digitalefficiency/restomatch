import {
  and,
  count,
  discrepancies,
  eq,
  gte,
  inArray,
  invoices,
  matchRuns,
  sql,
  suppliers,
  type Database,
} from '@restomatch/db';

export interface SupplierScorecard {
  supplierId: string;
  supplierName: string;
  matchRunsCount: number;
  cleanMatchPct: number;
  avgPriceDeltaPct: number;
  duplicateInvoicesCount: number;
  trend: 'up' | 'down' | 'flat';
}

export interface ComputeSupplierScorecardsOptions {
  /** Look back this many days when computing aggregates. Default 90. */
  windowDays?: number;
}

export async function computeSupplierScorecards(
  db: Database,
  restaurantId: string,
  options: ComputeSupplierScorecardsOptions = {},
): Promise<SupplierScorecard[]> {
  const windowDays = options.windowDays ?? 90;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const supplierRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.restaurantId, restaurantId));

  const scorecards: SupplierScorecard[] = [];

  for (const s of supplierRows) {
    // Match runs in the window — clean vs total
    const matchAgg = await db
      .select({
        total: count(matchRuns.id),
        clean: sql<string>`SUM(CASE WHEN ${matchRuns.overallStatus} = 'clean' THEN 1 ELSE 0 END)`.as(
          'clean',
        ),
      })
      .from(matchRuns)
      .innerJoin(invoices, eq(invoices.id, matchRuns.invoiceId))
      .where(
        and(
          eq(matchRuns.restaurantId, restaurantId),
          eq(invoices.supplierId, s.id),
          gte(matchRuns.runAt, since),
        ),
      );

    const total = Number(matchAgg[0]?.total ?? 0);
    const clean = Number(matchAgg[0]?.clean ?? 0);
    const cleanMatchPct = total === 0 ? 0 : Math.round((clean / total) * 1000) / 10;

    // Avg price delta % from PRICE_HIGHER discrepancies for this supplier's invoices
    const priceAgg = await db
      .select({
        avgDelta: sql<string>`COALESCE(AVG(
          CASE
            WHEN ${discrepancies.expectedValue} > 0
            THEN (${discrepancies.actualValue} - ${discrepancies.expectedValue}) / ${discrepancies.expectedValue}
            ELSE 0
          END
        ), 0)`.as('avg_delta'),
      })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .innerJoin(invoices, eq(invoices.id, matchRuns.invoiceId))
      .where(
        and(
          eq(discrepancies.restaurantId, restaurantId),
          eq(invoices.supplierId, s.id),
          inArray(discrepancies.type, ['PRICE_HIGHER', 'PRICE_LOWER']),
          gte(discrepancies.createdAt, since),
        ),
      );
    const avgPriceDeltaPct = Number(priceAgg[0]?.avgDelta ?? 0);

    // Duplicate invoices count
    const duplicates = await db
      .select({ c: count(discrepancies.id) })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .innerJoin(invoices, eq(invoices.id, matchRuns.invoiceId))
      .where(
        and(
          eq(discrepancies.restaurantId, restaurantId),
          eq(invoices.supplierId, s.id),
          eq(discrepancies.type, 'DUPLICATE_INVOICE'),
          gte(discrepancies.createdAt, since),
        ),
      );

    // Trend: compare second-half-window vs first-half-window cleanPct
    const half = new Date(Date.now() - (windowDays / 2) * 24 * 60 * 60 * 1000);
    const recentAgg = await db
      .select({
        total: count(matchRuns.id),
        clean: sql<string>`SUM(CASE WHEN ${matchRuns.overallStatus} = 'clean' THEN 1 ELSE 0 END)`.as(
          'clean',
        ),
      })
      .from(matchRuns)
      .innerJoin(invoices, eq(invoices.id, matchRuns.invoiceId))
      .where(
        and(
          eq(matchRuns.restaurantId, restaurantId),
          eq(invoices.supplierId, s.id),
          gte(matchRuns.runAt, half),
        ),
      );
    const recentTotal = Number(recentAgg[0]?.total ?? 0);
    const recentClean = Number(recentAgg[0]?.clean ?? 0);
    const recentPct = recentTotal === 0 ? cleanMatchPct : (recentClean / recentTotal) * 100;
    const trend: 'up' | 'down' | 'flat' =
      recentPct - cleanMatchPct > 3 ? 'up' : recentPct - cleanMatchPct < -3 ? 'down' : 'flat';

    scorecards.push({
      supplierId: s.id,
      supplierName: s.name,
      matchRunsCount: total,
      cleanMatchPct,
      avgPriceDeltaPct,
      duplicateInvoicesCount: Number(duplicates[0]?.c ?? 0),
      trend,
    });
  }

  scorecards.sort((a, b) => b.matchRunsCount - a.matchRunsCount);
  return scorecards;
}
