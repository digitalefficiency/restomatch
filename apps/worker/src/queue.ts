import { captureException } from '@restomatch/observability';
import { Queue, Worker, type WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export function makeQueue<T>(name: string) {
  return new Queue<T>(name, { connection });
}

/**
 * One log line per failed job. Without it a failure is only visible in Sentry
 * (env-gated), i.e. invisible on a laptop/container without SENTRY_DSN.
 */
export function formatJobFailure(
  name: string,
  job: { id?: string; attemptsMade?: number } | undefined,
  err: unknown,
): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `[${name}] job=${job?.id ?? '?'} attempt=${job?.attemptsMade ?? '?'} failed: ${msg}`;
}

export function makeWorker<T>(
  name: string,
  processor: (job: { data: T; id?: string }) => Promise<unknown>,
  options: Partial<WorkerOptions> = {},
) {
  const worker = new Worker<T>(name, processor as never, { connection, ...options });
  worker.on('failed', (job, err) => {
    console.error(formatJobFailure(name, job, err));
    captureException(err, { queue: name, jobId: job?.id });
  });
  // BullMQ re-emits connection/processing errors as 'error'; an EventEmitter
  // with no 'error' listener throws, which would take the whole process down
  // on a transient Redis blip instead of letting ioredis reconnect.
  worker.on('error', (err) => {
    console.error(`[${name}] worker error: ${err instanceof Error ? err.message : String(err)}`);
  });
  return worker;
}

export { connection };
