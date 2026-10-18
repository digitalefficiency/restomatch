/**
 * price-alerts — daily sweep for SUSTAINED price increases in price_history
 * (wave-1 `priceAlerts`, e.g. "tomatoes +18% over 3 weeks"). For every
 * restaurant with the feature on, runPriceAlertSweep persists new
 * `price_alerts` rows (the in-app list) and enqueues one email per
 * owner/manager through the notification outbox (deduped per alert); real
 * delivery happens in outbox-dispatch. Restaurants with the flag off are a no-op.
 */
import { runPriceAlertSweep } from '@restomatch/api';
import { createDb, eq, restaurants } from '@restomatch/db';
import { makeWorker } from '../queue';
import { appBaseUrl } from '../lib/notifyHelpers';

export interface PriceAlertsJob {
  /** When omitted, sweeps ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "now" (tests). */
  forDate?: string;
}

export function startPriceAlertsWorker() {
  return makeWorker<PriceAlertsJob>('price-alerts', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);
    const now = job.data.forDate ? new Date(job.data.forDate) : new Date();

    const rows = job.data.restaurantId
      ? await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
      : await db.select({ id: restaurants.id }).from(restaurants);

    let created = 0;
    let enqueued = 0;
    for (const r of rows) {
      const res = await runPriceAlertSweep(db, r.id, { now, notify: true, appBaseUrl: appBaseUrl() });
      created += res.created;
      enqueued += res.enqueued;
    }
    console.log(`[price-alerts] restaurants=${rows.length} created=${created} enqueued=${enqueued}`);
    return { created, enqueued };
  });
}
