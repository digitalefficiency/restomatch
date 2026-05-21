/**
 * BullMQ Repeatable jobs — registered once at worker startup.
 *
 * Cron expressions are evaluated in `Asia/Jerusalem` (IL timezone).
 *
 * Schedule:
 *   • daily-expectations — every day at 06:00 IL: compute today's PO list
 *   • baselines          — every day at 02:00 IL: recompute price baselines
 *   • sync-platforms     — every 30 minutes: sync each restaurant's
 *                          connected procurement platform
 *   • outbox-dispatch    — every 60 seconds: pick up queued notifications
 *                          and dispatch via real provider clients
 */
import { makeQueue } from './queue';
import type { BaselinesJob } from './jobs/baselines';
import type { DailyExpectationsJob } from './jobs/dailyExpectations';
import type { OutboxDispatchJob } from './jobs/outboxDispatch';

const dailyExpectationsQueue = makeQueue<DailyExpectationsJob>('daily-expectations');
const baselinesQueue = makeQueue<BaselinesJob>('baselines');
const outboxQueue = makeQueue<OutboxDispatchJob>('outbox-dispatch');

const TZ = 'Asia/Jerusalem';

export async function registerCronSchedules(): Promise<void> {
  // Daily expectations — every day 06:00 IL
  await dailyExpectationsQueue.upsertJobScheduler(
    'daily-expectations-06',
    { pattern: '0 6 * * *', tz: TZ },
    { name: 'daily-expectations', data: {} },
  );

  // Baselines — every day 02:00 IL
  await baselinesQueue.upsertJobScheduler(
    'baselines-02',
    { pattern: '0 2 * * *', tz: TZ },
    { name: 'baselines', data: {} },
  );

  // Outbox dispatch — every 60 seconds
  await outboxQueue.upsertJobScheduler(
    'outbox-dispatch-60s',
    { every: 60_000 },
    { name: 'outbox-dispatch', data: {} },
  );

  console.log('[cron] registered: daily-expectations(06:00), baselines(02:00), outbox-dispatch(60s)');
}

export async function unregisterCronSchedules(): Promise<void> {
  await dailyExpectationsQueue.removeJobScheduler('daily-expectations-06');
  await baselinesQueue.removeJobScheduler('baselines-02');
  await outboxQueue.removeJobScheduler('outbox-dispatch-60s');
}
