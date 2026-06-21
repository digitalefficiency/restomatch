import { registerSentryClient } from '@restomatch/observability';
import { registerCronSchedules } from './cron';
import { startBaselinesWorker } from './jobs/baselines';
import { startDailyExpectationsWorker } from './jobs/dailyExpectations';
import { startImportCatalogWorker } from './jobs/importCatalog';
import { startEndOfDayReportWorker } from './jobs/endOfDayReport';
import { startMatchInvoiceWorker } from './jobs/matchInvoice';
import { startOcrInvoiceWorker } from './jobs/ocrInvoice';
import { startOrderRemindersWorker } from './jobs/orderReminders';
import { startOutboxDispatchWorker } from './jobs/outboxDispatch';
import { startSupplierDelaysWorker } from './jobs/supplierDelays';
import { startSyncPlatformsWorker } from './jobs/syncPlatforms';

interface SentryNode {
  init(o: { dsn: string; environment?: string }): void;
  captureException(e: unknown, ctx?: unknown): void;
  captureMessage(m: string, level?: string): void;
  setUser(u: { id: string; email?: string }): void;
  setTag(k: string, v: string): void;
}

// Env-gated: only activates when SENTRY_DSN is set AND @sentry/node is installed.
async function initObservability(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const pkg = '@sentry/node';
    const Sentry = (await import(pkg)) as unknown as SentryNode;
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENV });
    registerSentryClient({
      captureException: (e, c) => Sentry.captureException(e, c ? { extra: c } : undefined),
      captureMessage: (m, level) => Sentry.captureMessage(m, level),
      setUser: (u) => Sentry.setUser(u),
      setTag: (k, v) => Sentry.setTag(k, v),
    });
    console.log('[worker] Sentry observability registered');
  } catch (err) {
    console.warn(
      '[worker] Sentry not initialised (install @sentry/node to enable):',
      err instanceof Error ? err.message : err,
    );
  }
}

void initObservability();

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
