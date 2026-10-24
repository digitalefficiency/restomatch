import 'server-only';
import { sql as dsql } from '@restomatch/db';
import {
  canonicalizeEmail,
  checkRateLimit,
  MemoryRateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitStore,
} from '@restomatch/api';
import { withDeadline } from '@restomatch/queue';

/** A rate-limit check may add at most this much latency before failing open. */
export const RATE_LIMIT_DEADLINE_MS = 1_500;
/**
 * The FIRST check of a process also opens the connection (TCP + TLS + SCRAM to
 * the pooler, ~1 s cross-region): that gets its own, longer budget so a cold
 * serverless instance enforces its first logins instead of failing open (the hole
 * S15 found in the old Redis store). Waited for at most once per process.
 */
export const RATE_LIMIT_CONNECT_DEADLINE_MS = 5_000;

/**
 * Postgres fixed-window store (0061 rate_limit_counters; was Redis INCR). One
 * upsert both creates and increments the window's counter and returns the new
 * count; `expires_at` lets the worker prune old windows. All serverless instances
 * share the database, so the limit is global (unlike the in-memory fallback).
 *
 * Runs on the AUTH (owner) connection: limits are checked before any session
 * exists, and the tenant app role has no access to this table.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  private warm: Promise<void> | null = null;

  constructor(private readonly db: { execute: (q: ReturnType<typeof dsql>) => Promise<unknown> }) {}

  /** Open the connection once, outside the per-check deadline. Concurrent first calls share it. */
  private connect(): Promise<void> {
    this.warm ??= withDeadline(
      this.db.execute(dsql`select 1`).then(() => undefined),
      RATE_LIMIT_CONNECT_DEADLINE_MS,
      () => new Error(`rate-limit store: no connection within ${RATE_LIMIT_CONNECT_DEADLINE_MS}ms`),
    ).catch((err: unknown) => {
      // Only the first check pays this wait. After that a dead database costs
      // each check the normal 1.5 s deadline, not 5 s.
      console.warn('[rateLimit] connection warm-up failed:', err instanceof Error ? err.message : err);
    });
    return this.warm;
  }

  async incr(key: string, windowSec: number): Promise<number> {
    await this.connect();
    // Deadline per check: a black-holed database must not make login wait
    // (QA D1). enforceRateLimit fails open.
    return withDeadline(
      (async () => {
        const rows = (await this.db.execute(dsql`
          INSERT INTO rate_limit_counters (key, count, expires_at)
          VALUES (${key}, 1, now() + ${windowSec} * interval '1 second')
          ON CONFLICT (key) DO UPDATE SET count = rate_limit_counters.count + 1
          RETURNING count`)) as unknown as Array<{ count: number }>;
        return Number(rows[0]?.count ?? 0);
      })(),
      RATE_LIMIT_DEADLINE_MS,
      () => new Error(`rate-limit store timed out after ${RATE_LIMIT_DEADLINE_MS}ms`),
    );
  }
}

let store: RateLimitStore | undefined;

async function getStore(): Promise<RateLimitStore> {
  if (store) return store;
  if (process.env.DATABASE_URL || process.env.DATABASE_URL_APP) {
    const { authDb } = await import('./authDb');
    store = new PostgresRateLimitStore(authDb);
  } else {
    // No database configured (unit tests / bare local dev): process-local counter.
    store = new MemoryRateLimitStore();
  }
  return store;
}

/**
 * Enforce a rate limit. Fails OPEN on infra errors (a rate-limit store outage must not
 * lock everyone out of login) — the failure is logged so it is visible.
 */
export async function enforceRateLimit(
  identifier: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    return await checkRateLimit(await getStore(), identifier, opts);
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
 * Public OCR endpoint limit: 10 requests per client IP per hour. The endpoint
 * runs Claude Vision (cost-amplification / DoS surface), so this is intentionally
 * tight — D1.5.
 */
export const SHOWCASE_OCR_LIMIT: RateLimitOptions = {
  limit: 10,
  windowSec: 60 * 60,
  prefix: 'showcase-ocr',
};

/**
 * Number of TRUSTED reverse proxies in front of the app, from
 * `TRUSTED_PROXY_HOPS`. The client IP is then read that many hops from the RIGHT
 * of `x-forwarded-for` (a hop a client cannot forge) instead of the spoofable
 * left-most entry — D1.6. Defaults to 0 (legacy left-most) so attribution only
 * tightens once the proxy depth is declared (e.g. `1` behind Vercel/Cloudflare).
 */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Throttle the public OCR endpoint per client IP. Fails open on a rate-limit store outage. */
export async function enforceOcrLimit(ip: string): Promise<RateLimitResult> {
  return enforceRateLimit(ip, SHOWCASE_OCR_LIMIT);
}

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
 * fails OPEN on a rate-limit store outage; the durable ceiling is the DB lockout backstop
 * (independent of the rate-limit store), checked in authorize() and the TOTP path.
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
 * Throttle password-login attempts on email AND IP (C.2). This is the rate-limit
 * front line; the DB lockout backstop in authorizeCredentials is the durable
 * floor that holds even when the store fails open.
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
 * force is bounded even during a rate-limit store outage.
 */
export async function enforceTwoFactorLimit(email: string, ip: string): Promise<RateLimitResult> {
  return enforceEmailAndIpLimit(email, ip, TWO_FACTOR_EMAIL_LIMIT, TWO_FACTOR_IP_LIMIT);
}
