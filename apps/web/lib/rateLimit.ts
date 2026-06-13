import 'server-only';
import IORedis from 'ioredis';
import {
  canonicalizeEmail,
  checkRateLimit,
  MemoryRateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitStore,
} from '@restomatch/api';

/**
 * Redis-backed fixed-window store. INCR creates the counter; EXPIRE on the
 * first increment gives it a TTL so it self-cleans. Multiple serverless
 * instances share one Redis, so the limit is global (unlike the in-memory
 * fallback).
 */
class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: IORedis) {}

  async incr(key: string, windowSec: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
    }
    return count;
  }
}

let store: RateLimitStore | undefined;

function getStore(): RateLimitStore {
  if (store) return store;
  const url = process.env.REDIS_URL;
  if (url) {
    const redis = new IORedis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    redis.on('error', (err) => {
      console.warn('[rateLimit] redis error:', err.message);
    });
    store = new RedisRateLimitStore(redis);
  } else {
    // No Redis configured (local dev / tests): process-local counter.
    store = new MemoryRateLimitStore();
  }
  return store;
}

/**
 * Enforce a rate limit. Fails OPEN on infra errors (a Redis outage must not
 * lock everyone out of login) — the failure is logged so it is visible.
 */
export async function enforceRateLimit(
  identifier: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    return await checkRateLimit(getStore(), identifier, opts);
  } catch (err) {
    console.warn(
      `[rateLimit] store error for ${opts.prefix ?? 'rl'} — failing open:`,
      err instanceof Error ? err.message : err,
    );
    return { allowed: true, count: 0, limit: opts.limit, remaining: opts.limit, resetSec: 0 };
  }
}

/** Magic-link request limit: 3 per email per 15 minutes. */
export const MAGIC_LINK_LIMIT: RateLimitOptions = {
  limit: 3,
  windowSec: 15 * 60,
  prefix: 'magiclink',
};

/**
 * Throttle magic-link sends per destination MAILBOX (collapsing +tag / dot
 * aliases) so an attacker can't multiply the limit by cycling aliases that all
 * reach one inbox. Returns whether the send is allowed plus minutes-to-reset.
 */
export async function enforceMagicLinkLimit(
  email: string,
): Promise<RateLimitResult> {
  return enforceRateLimit(canonicalizeEmail(email), MAGIC_LINK_LIMIT);
}
