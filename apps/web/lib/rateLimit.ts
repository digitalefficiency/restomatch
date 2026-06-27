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

/** Password-reset request limit per destination mailbox: 3 per 15 minutes. */
export const PASSWORD_RESET_MAILBOX_LIMIT: RateLimitOptions = {
  limit: 3,
  windowSec: 15 * 60,
  prefix: 'pwreset:mbox',
};

/** Password-reset request limit per client IP: 10 per 15 minutes. */
export const PASSWORD_RESET_IP_LIMIT: RateLimitOptions = {
  limit: 10,
  windowSec: 15 * 60,
  prefix: 'pwreset:ip',
};

/**
 * Throttle password-reset requests on BOTH the destination mailbox AND the
 * client IP (B.4). The mailbox key collapses aliases; the IP key bounds a
 * single source spraying many addresses. Allowed only when BOTH pass. Fails
 * OPEN per limiter on a Redis outage — the durable brute-force ceiling for the
 * login itself is the DB lockout backstop (C.2), independent of Redis.
 */
export async function enforcePasswordResetLimit(
  email: string,
  ip: string,
): Promise<RateLimitResult> {
  const byMailbox = await enforceRateLimit(canonicalizeEmail(email), PASSWORD_RESET_MAILBOX_LIMIT);
  const byIp = await enforceRateLimit(ip || 'unknown', PASSWORD_RESET_IP_LIMIT);
  // Return the more restrictive (already-blocked) result so the caller surfaces
  // a single, uniform "too many attempts" message.
  if (!byMailbox.allowed) return byMailbox;
  return byIp;
}
