import { registerCronSchedules } from './cron';
import { startBaselinesWorker } from './jobs/baselines';
import { startDailyExpectationsWorker } from './jobs/dailyExpectations';
import { startMatchInvoiceWorker } from './jobs/matchInvoice';
import { startOcrInvoiceWorker } from './jobs/ocrInvoice';
import { startOutboxDispatchWorker } from './jobs/outboxDispatch';
import { startSyncPlatformsWorker } from './jobs/syncPlatforms';

const workers = [
  startSyncPlatformsWorker(),
  startDailyExpectationsWorker(),
  startBaselinesWorker(),
  startOcrInvoiceWorker(),
  startMatchInvoiceWorker(),
  startOutboxDispatchWorker(),
];

console.log(`[worker] started ${workers.length} workers`);

void registerCronSchedules().catch((err) => {
  console.error('[worker] failed to register cron schedules', err);
});

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
