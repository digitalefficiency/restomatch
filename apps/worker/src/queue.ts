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
  return new Worker<T>(name, processor as never, { connection, ...options });
}

export { connection };
