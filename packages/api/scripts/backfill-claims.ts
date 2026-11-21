/**
 * One-off: create the recovery claims for decisions taken before claims were
 * made at decision time (W2-10a). Approvals now call materializeClaims inside
 * the decision; a finding approved earlier has no claim until this runs (or
 * the daily reminder job's catch-up does).
 *
 *   DATABASE_URL=postgres://… pnpm exec tsx packages/api/scripts/backfill-claims.ts [restaurantId]
 *
 * Idempotent: syncClaims makes at most one claim per discrepancy, so a second
 * run creates nothing. Without an id, runs for every restaurant. Uses the
 * service connection; every write is restaurant-scoped inside syncClaims.
 * New claims belong to whoever decided the discrepancy (d.resolved_by).
 */
import { createDb, eq, restaurants } from '@restomatch/db';
import { syncClaims } from '../src/recovery/service';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url);
  const only = process.argv[2];
  const targets = only
    ? await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, only))
    : await db.select({ id: restaurants.id }).from(restaurants);
  let total = 0;
  for (const r of targets) {
    const created = await syncClaims(db, r.id);
    total += created;
    console.log(`[backfill-claims] restaurant=${r.id} created=${created}`);
  }
  console.log(`[backfill-claims] done — ${targets.length} restaurants, ${total} claims created`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
