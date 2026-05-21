import { startBaselinesWorker } from './jobs/baselines.js';
import { startDailyExpectationsWorker } from './jobs/dailyExpectations.js';
import { startOcrInvoiceWorker } from './jobs/ocrInvoice.js';
import { startSyncPlatformsWorker } from './jobs/syncPlatforms.js';

const workers = [
  startSyncPlatformsWorker(),
  startDailyExpectationsWorker(),
  startBaselinesWorker(),
  startOcrInvoiceWorker(),
];

console.log(`[worker] started ${workers.length} workers`);

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
