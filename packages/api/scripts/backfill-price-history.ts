/**
 * Backfill price_history (M1) for already-matched invoices, then recompute
 * price baselines so the leak detective lights up immediately.
 *
 *   DATABASE_URL=postgres://… pnpm exec tsx packages/api/scripts/backfill-price-history.ts [restaurantId]
 *
 * Idempotent: rows are replaced per source invoice. Without an id, runs for every
 * restaurant. Uses the service connection (RLS-bypassing); every write is
 * restaurant-scoped inside backfillPriceHistory.
 */
import { computeBaselines } from '@restomatch/charts';
import { createDb, eq, restaurants } from '@restomatch/db';
import { backfillPriceHistory } from '../src/match/priceHistory';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url);
  const only = process.argv[2];
  const targets = only
    ? await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, only))
    : await db.select({ id: restaurants.id }).from(restaurants);
  for (const r of targets) {
    const res = await backfillPriceHistory(db, r.id);
    const baselines = await computeBaselines(db, r.id);
    console.log(
      `[backfill-price-history] restaurant=${r.id} invoices=${res.invoices} rows=${res.rows} baselines=${baselines.length}`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
