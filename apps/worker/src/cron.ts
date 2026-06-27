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
import type { EndOfDayReportJob } from './jobs/endOfDayReport';
import type { OrderRemindersJob } from './jobs/orderReminders';
import type { OutboxDispatchJob } from './jobs/outboxDispatch';
import type { RetentionJob } from './jobs/retention';
import type { SupplierDelaysJob } from './jobs/supplierDelays';

const dailyExpectationsQueue = makeQueue<DailyExpectationsJob>('daily-expectations');
const baselinesQueue = makeQueue<BaselinesJob>('baselines');
const outboxQueue = makeQueue<OutboxDispatchJob>('outbox-dispatch');
const orderRemindersQueue = makeQueue<OrderRemindersJob>('order-reminders');
const supplierDelaysQueue = makeQueue<SupplierDelaysJob>('supplier-delays');
const endOfDayReportQueue = makeQueue<EndOfDayReportJob>('end-of-day-report');
const retentionQueue = makeQueue<RetentionJob>('retention');

const TZ = 'Asia/Jerusalem';

/** Retention is opt-in: only schedule it when explicitly enabled (E.8). */
const RETENTION_CRON_ENABLED = process.env.RETENTION_CRON_ENABLED === '1';

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

  // Order reminders — every day 09:00 IL: alert on order-days with no PO placed
  await orderRemindersQueue.upsertJobScheduler(
    'order-reminders-09',
    { pattern: '0 9 * * *', tz: TZ },
    { name: 'order-reminders', data: {} },
  );

  // Supplier delays — every day 10:00 IL: alert on placed POs past delivery
  await supplierDelaysQueue.upsertJobScheduler(
    'supplier-delays-10',
    { pattern: '0 10 * * *', tz: TZ },
    { name: 'supplier-delays', data: {} },
  );

  // End-of-day report — every day 19:00 IL: open-credits digest to managers
  await endOfDayReportQueue.upsertJobScheduler(
    'end-of-day-report-19',
    { pattern: '0 19 * * *', tz: TZ },
    { name: 'end-of-day-report', data: {} },
  );

  // Retention purge — every day 03:30 IL. Opt-in via RETENTION_CRON_ENABLED; even
  // when scheduled it dry-runs unless RETENTION_PURGE_ENABLED=1 (see retention.ts).
  if (RETENTION_CRON_ENABLED) {
    await retentionQueue.upsertJobScheduler(
      'retention-0330',
      { pattern: '30 3 * * *', tz: TZ },
      { name: 'retention', data: {} },
    );
  }

  console.log(
    '[cron] registered: daily-expectations(06:00), baselines(02:00), outbox-dispatch(60s), ' +
      'order-reminders(09:00), supplier-delays(10:00), end-of-day-report(19:00)' +
      (RETENTION_CRON_ENABLED ? ', retention(03:30)' : ''),
  );
}

export async function unregisterCronSchedules(): Promise<void> {
  await dailyExpectationsQueue.removeJobScheduler('daily-expectations-06');
  await baselinesQueue.removeJobScheduler('baselines-02');
  await outboxQueue.removeJobScheduler('outbox-dispatch-60s');
  await orderRemindersQueue.removeJobScheduler('order-reminders-09');
  await supplierDelaysQueue.removeJobScheduler('supplier-delays-10');
  await endOfDayReportQueue.removeJobScheduler('end-of-day-report-19');
  await retentionQueue.removeJobScheduler('retention-0330');
}
