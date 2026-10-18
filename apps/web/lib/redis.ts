import 'server-only';
import IORedis from 'ioredis';
import { failFastRedisOptions, redisUrlProblem, withDeadline } from '@restomatch/queue';

/**
 * Shared, lazily-created Redis client for non-rate-limit web reads (worker
 * heartbeat, health). Returns null when REDIS_URL is unset so callers degrade
 * explicitly instead of throwing at import. apps/web/lib/rateLimit.ts keeps its
 * own client on purpose (immutability list).
 */
let client: IORedis | null | undefined;

export function getRedis(): IORedis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url || redisUrlProblem(url)) {
    client = null;
    return null;
  }
  // Fail fast: these reads run inside page renders (dashboard banner) and the
  // cron route — a dead Redis must never stall them (QA D1).
  client = new IORedis(url, failFastRedisOptions());
  client.on('error', (err) => {
    console.warn('[redis] error:', err.message);
  });
  return client;
}

/** Max time a request-path Redis read may take before the caller treats Redis as down. */
export const REDIS_READ_DEADLINE_MS = 1_500;

/** GET with a hard deadline; rejects on timeout like any other Redis error. */
export function redisGetWithDeadline(redis: IORedis, key: string): Promise<string | null> {
  return withDeadline(redis.get(key), REDIS_READ_DEADLINE_MS, () => new Error(`redis GET ${key} timed out`));
}
