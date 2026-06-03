import { captureException } from '@restomatch/observability';
import { Queue, Worker, type WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export function makeQueue<T>(name: string) {
  return new Queue<T>(name, { connection });
}

export function makeWorker<T>(
  name: string,
  processor: (job: { data: T; id?: string }) => Promise<unknown>,
  options: Partial<WorkerOptions> = {},
) {
  const worker = new Worker<T>(name, processor as never, { connection, ...options });
  worker.on('failed', (job, err) => {
    captureException(err, { queue: name, jobId: job?.id });
  });
  return worker;
}

export { connection };
