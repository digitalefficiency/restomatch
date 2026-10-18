import 'server-only';
import IORedis from 'ioredis';

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
  if (!url) {
    client = null;
    return null;
  }
  client = new IORedis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  client.on('error', (err) => {
    console.warn('[redis] error:', err.message);
  });
  return client;
}
