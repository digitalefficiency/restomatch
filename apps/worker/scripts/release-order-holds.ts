/**
 * G-08 kill switch — run it AFTER the web AND worker redeploy that carries
 * `FEATURES_OFF=orderQuestions` (an env change needs a redeploy; until both run
 * with it, a job could hold an invoice again). It releases the invoices already waiting for an
 * order's "זה אותו מוצר?" questions and re-queue their match:
 *
 *   DATABASE_URL=... pnpm --filter @restomatch/worker run release-order-holds [--restaurant <uuid>]
 *
 * (A per-restaurant flip in the admin console, settings.features.orderQuestions
 * = false, does this by itself.) Each released invoice stays pinned to the order it
 * waited for; one left 'matched' with no run (a failed enqueue) is re-queued. Safe
 * to run again. Prints a one-line JSON summary. Refuses to run while the switch is
 * still ON for the scope (nothing would be released).
 */
import { featureEnabled, releaseOrderQuestionHolds } from '@restomatch/api';
import { createDb, eq, restaurants } from '@restomatch/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const i = process.argv.indexOf('--restaurant');
const restaurantId = i >= 0 ? process.argv[i + 1] : undefined;
if (i >= 0 && !/^[0-9a-f-]{36}$/i.test(restaurantId ?? '')) {
  console.error('--restaurant needs a restaurant uuid');
  process.exit(1);
}
const db = createDb(url);
if (restaurantId) {
  const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r) {
    console.error(`restaurant ${restaurantId} not found`);
    process.exit(1);
  }
  if (featureEnabled(r.settings, 'orderQuestions')) {
    console.error('orderQuestions is still ON for this restaurant — set FEATURES_OFF=orderQuestions (redeploy) or flip it in admin first');
    process.exit(1);
  }
} else if (featureEnabled(null, 'orderQuestions')) {
  console.error('FEATURES_OFF does not include orderQuestions here — set it first (or pass --restaurant for one tenant turned off in admin)');
  process.exit(1);
}
const out = await releaseOrderQuestionHolds(db, restaurantId ?? 'all');
console.log(JSON.stringify(out));
process.exit(0);
