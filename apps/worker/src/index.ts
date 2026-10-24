import { initSentryFromEnv } from '@restomatch/observability';
import { assertWorkerEnv } from './env';
import { registerCronSchedules } from './cron';
import { pingDb, startDbWatchdog, startHealthServer } from './health';
import { startHeartbeat } from './heartbeat';
import { closeJobDbs } from './db';
import { closeQueueSql } from '@restomatch/queue';
import {
  missingQueueTables,
  missingQueueTablesMessage,
  startJobListener,
  startRuntime,
  tickSchedules,
  WORKER_ID,
  workerSql,
} from './queue';
import { startBaselinesWorker } from './jobs/baselines';
import { startDailyExpectationsWorker } from './jobs/dailyExpectations';
import { startImportCatalogWorker } from './jobs/importCatalog';
import { startEndOfDayReportWorker } from './jobs/endOfDayReport';
import { startHealthDigestWorker } from './jobs/healthDigest';
import { startMatchInvoiceWorker } from './jobs/matchInvoice';
import { startOcrInvoiceWorker } from './jobs/ocrInvoice';
import { startOcrSweepWorker } from './jobs/ocrSweep';
import { startOrderRemindersWorker } from './jobs/orderReminders';
import { startOutboxDispatchWorker } from './jobs/outboxDispatch';
import { startRetentionWorker } from './jobs/retention';
import { startSupplierDelaysWorker } from './jobs/supplierDelays';
import { startSyncPlatformsWorker } from './jobs/syncPlatforms';

// Fail fast if the worker is misconfigured (missing DATABASE_URL/keys in prod)
// rather than booting into a process that looks healthy but does nothing.
assertWorkerEnv();

// Sentry: no-op without SENTRY_DSN; with it, needs `pnpm add @sentry/node`
// (see docs/MONITORING.md). Events are PII-scrubbed in beforeSend.
void initSentryFromEnv({ service: 'worker' }).then((r) => {
  if (r.enabled) console.log(`[worker] Sentry enabled (${r.environment})`);
});

// Deploy-order guard: the queue lives in Postgres (0061). Started before the
// migration ran, every claim would error forever — refuse clearly instead. A DB
// that cannot be reached here is left to the DB watchdog below.
try {
  const missing = await missingQueueTables(workerSql());
  if (missing.length > 0) {
    console.error(missingQueueTablesMessage(missing));
    process.exit(1);
  }
} catch (err) {
  console.warn(`[worker] could not check the queue tables at boot: ${err instanceof Error ? err.message : err}`);
}

const workers = [
  startSyncPlatformsWorker(),
  startDailyExpectationsWorker(),
  startBaselinesWorker(),
  startOcrInvoiceWorker(),
  startMatchInvoiceWorker(),
  startImportCatalogWorker(),
  startOutboxDispatchWorker(),
  startOrderRemindersWorker(),
  startSupplierDelaysWorker(),
  startEndOfDayReportWorker(),
  startRetentionWorker(),
  startHealthDigestWorker(),
  startOcrSweepWorker(),
];

console.log(`[worker] started ${workers.length} workers`);

// HTTP health endpoint for the deploy platform's liveness/readiness probe.
const healthServer = startHealthServer(workers.length);

// Liveness beat for the web-side watchdog (/api/cron/worker-heartbeat) — the
// pilot worker runs on a laptop, so a silent stop must page the owner.
const stopHeartbeat = startHeartbeat(workerSql(), WORKER_ID, workers.length);

// Exit (→ platform restart) when the database stays unreachable ~2 min: a worker
// that cannot reach its queue looks healthy on /health but processes nothing.
const stopWatchdog = startDbWatchdog({ ping: pingDb });

// Schedules → jobs, stalled-job recovery, lock renewal, pruning.
const stopRuntime = startRuntime();

// Instant pickup of new jobs (NOTIFY from enqueue); the idle poll backs off to 30 s.
const stopListener = await startJobListener();

void registerCronSchedules()
  .then(() => tickSchedules(workerSql()))
  .catch((err) => {
    console.error('[worker] failed to register cron schedules', err);
  });

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, shutting down`);
  stopHeartbeat();
  stopWatchdog();
  healthServer.close();
  // Drain first: lock renewal (in the runtime) must keep running while the
  // in-flight jobs finish, or a long job looks stalled to the next worker.
  await stopListener().catch(() => {});
  await Promise.all(workers.map((w) => w.close()));
  stopRuntime();
  await closeJobDbs();
  await closeQueueSql();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
