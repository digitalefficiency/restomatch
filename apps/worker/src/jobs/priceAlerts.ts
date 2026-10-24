/**
 * price-alerts — daily sweep for SUSTAINED price increases in price_history
 * (wave-1 `priceAlerts`, e.g. "tomatoes +18% over 3 weeks"). For every
 * restaurant with the feature on, runPriceAlertSweep persists new
 * `price_alerts` rows (the in-app list) and enqueues one email per
 * owner/manager through the notification outbox (deduped per alert); real
 * delivery happens in outbox-dispatch. Restaurants with the flag off are a no-op.
 */
import { runPriceAlertSweep } from '@restomatch/api';
import { eq, restaurants } from '@restomatch/db';
import { jobDb } from '../db';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl } from '../lib/notifyHelpers';

export interface PriceAlertsJob {
  /** When omitted, sweeps ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "now" (tests). */
  forDate?: string;
}

export function startPriceAlertsWorker() {
  return makeWorker<PriceAlertsJob>('price-alerts', processPriceAlerts);
}

/** The price-alerts job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processPriceAlerts(job: WorkerJob<PriceAlertsJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);
  const now = job.data.forDate ? new Date(job.data.forDate) : new Date();

  const rows = job.data.restaurantId
    ? await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
    : await db.select({ id: restaurants.id }).from(restaurants);

  let created = 0;
  let enqueued = 0;
  let failed = 0;
  for (const r of rows) {
    // One tenant's bad data must not abort the sweep for everyone else.
    try {
      const res = await runPriceAlertSweep(db, r.id, { now, notify: true, appBaseUrl: appBaseUrl() });
      created += res.created;
      enqueued += res.enqueued;
    } catch (err) {
      failed += 1;
      console.error(`[price-alerts] restaurant=${r.id} failed`, err);
    }
  }
  console.log(`[price-alerts] restaurants=${rows.length} created=${created} enqueued=${enqueued} failed=${failed}`);
  return { created, enqueued, failed };
}
