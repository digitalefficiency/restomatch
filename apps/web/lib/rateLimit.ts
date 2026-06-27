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

/**
 * A single uniform Hebrew "too many attempts" line shared by every credential
 * surface (login / 2FA / recovery / reset). It deliberately reveals NOTHING
 * about whether the account exists or is locked — only that the caller should
 * back off — so it cannot be used to enumerate accounts or probe lock state.
 */
export const TOO_MANY_ATTEMPTS_HE = 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.';

/**
 * Throttle a credential action on BOTH the canonical email AND the client IP
 * (C.2). The email key collapses +tag / dot aliases so an attacker can't
 * multiply the limit per account; the IP key bounds one source spraying many
 * accounts. Allowed only when BOTH pass — the more restrictive (already-blocked)
 * result is returned so the caller can surface ONE uniform message. Each limiter
 * fails OPEN on a Redis outage; the durable ceiling is the DB lockout backstop
 * (independent of Redis), checked in authorize() and the TOTP path.
 */
export async function enforceEmailAndIpLimit(
  email: string,
  ip: string,
  emailLimit: RateLimitOptions,
  ipLimit: RateLimitOptions,
): Promise<RateLimitResult> {
  const byEmail = await enforceRateLimit(canonicalizeEmail(email), emailLimit);
  const byIp = await enforceRateLimit(ip || 'unknown', ipLimit);
  if (!byEmail.allowed) return byEmail;
  return byIp;
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
 * client IP (B.4 / C.2).
 */
export async function enforcePasswordResetLimit(
  email: string,
  ip: string,
): Promise<RateLimitResult> {
  return enforceEmailAndIpLimit(
    email,
    ip,
    PASSWORD_RESET_MAILBOX_LIMIT,
    PASSWORD_RESET_IP_LIMIT,
  );
}

/** Password-login attempt limit per account: 10 per 15 minutes. */
export const LOGIN_EMAIL_LIMIT: RateLimitOptions = {
  limit: 10,
  windowSec: 15 * 60,
  prefix: 'login:email',
};

/** Password-login attempt limit per client IP: 30 per 15 minutes. */
export const LOGIN_IP_LIMIT: RateLimitOptions = {
  limit: 30,
  windowSec: 15 * 60,
  prefix: 'login:ip',
};

/**
 * Throttle password-login attempts on email AND IP (C.2). This is the Redis
 * front line; the DB lockout backstop in authorizeCredentials is the durable
 * floor that holds even when Redis fails open.
 */
export async function enforceLoginLimit(email: string, ip: string): Promise<RateLimitResult> {
  return enforceEmailAndIpLimit(email, ip, LOGIN_EMAIL_LIMIT, LOGIN_IP_LIMIT);
}

/** Second-factor (TOTP / recovery) attempt limit per account: 8 per 15 minutes. */
export const TWO_FACTOR_EMAIL_LIMIT: RateLimitOptions = {
  limit: 8,
  windowSec: 15 * 60,
  prefix: '2fa:email',
};

/** Second-factor attempt limit per client IP: 20 per 15 minutes. */
export const TWO_FACTOR_IP_LIMIT: RateLimitOptions = {
  limit: 20,
  windowSec: 15 * 60,
  prefix: '2fa:ip',
};

/**
 * Throttle second-factor (TOTP + recovery) verification attempts on email AND
 * IP (C.2). Pairs with the DB lockout backstop in verifySecondFactor so a brute
 * force is bounded even during a Redis outage.
 */
export async function enforceTwoFactorLimit(email: string, ip: string): Promise<RateLimitResult> {
  return enforceEmailAndIpLimit(email, ip, TWO_FACTOR_EMAIL_LIMIT, TWO_FACTOR_IP_LIMIT);
}
