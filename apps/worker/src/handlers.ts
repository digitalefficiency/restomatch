import type { WorkerJob } from './queue';
import { processBaselines } from './jobs/baselines';
import { processDailyExpectations } from './jobs/dailyExpectations';
import { processEndOfDayReport } from './jobs/endOfDayReport';
import { processHealthDigest } from './jobs/healthDigest';
import { processImportCatalog } from './jobs/importCatalog';
import { processMatchInvoice } from './jobs/matchInvoice';
import { processMonthlyReport } from './jobs/monthlyReport';
import { processOcrInvoice } from './jobs/ocrInvoice';
import { processOcrSweep } from './jobs/ocrSweep';
import { processOrderReminders } from './jobs/orderReminders';
import { processOutboxDispatch } from './jobs/outboxDispatch';
import { processPriceAlerts } from './jobs/priceAlerts';
import { processRecoveryReminders } from './jobs/recoveryReminders';
import { processRetention } from './jobs/retention';
import { processSupplierDelays } from './jobs/supplierDelays';
import { processSyncPlatforms } from './jobs/syncPlatforms';

/**
 * Every queue's processor, by queue name — the ONE place the job logic is
 * looked up outside the worker's own start*Worker() functions.
 *
 * The worker (index.ts) starts each queue with its start*Worker(), which hands
 * the same exported process* function to makeWorker. The serverless runner
 * (serverless.ts — the web app's /api/cron/jobs route and its after() kicks)
 * claims a job and calls the processor from this map. Same function, same
 * success / retry / dead-letter recording (runClaimedJob), whichever runs it.
 * handlers.test.ts fails when a makeWorker('<queue>', …) has no entry here.
 */
export type JobProcessor = (job: WorkerJob<never>) => Promise<unknown>;

export const JOB_HANDLERS: Readonly<Record<string, JobProcessor>> = {
  'sync-platforms': processSyncPlatforms,
  'daily-expectations': processDailyExpectations,
  baselines: processBaselines,
  'ocr-invoice': processOcrInvoice,
  'match-invoice': processMatchInvoice,
  'import-catalog': processImportCatalog,
  'outbox-dispatch': processOutboxDispatch,
  'order-reminders': processOrderReminders,
  'supplier-delays': processSupplierDelays,
  'price-alerts': processPriceAlerts,
  'end-of-day-report': processEndOfDayReport,
  retention: processRetention,
  'recovery-reminders': processRecoveryReminders,
  'monthly-report': processMonthlyReport,
  'health-digest': processHealthDigest,
  'ocr-sweep': processOcrSweep,
};

export const HANDLED_QUEUES: readonly string[] = Object.keys(JOB_HANDLERS);
