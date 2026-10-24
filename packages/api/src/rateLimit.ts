/**
 * Store-agnostic fixed-window rate limiting.
 *
 * The window is bucketed by floor(now / windowSec): every key gets one counter
 * per window, incremented atomically, with an expiry so it can be pruned. A
 * Postgres upsert store is the production backing (apps/web/lib/rateLimit.ts); the
 * in-memory store here backs tests and single-process dev.
 */

export interface RateLimitStore {
  /**
   * Atomically increment the counter for `key` and return the new value.
   * MUST set/refresh a TTL of `windowSec` on the key's first increment so the
   * counter cannot live forever.
   */
  incr(key: string, windowSec: number): Promise<number>;
  /** Optional: drop the counter for `key` (resetRateLimit; e.g. a successful login). */
  del?(key: string): Promise<void>;
}

export interface RateLimitOptions {
  /** Max events allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Namespacing prefix so unrelated limiters never collide. */
  prefix?: string;
  /** Injectable clock (ms since epoch) for deterministic tests. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Count after this event. */
  count: number;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. */
  resetSec: number;
}

/** The counter key of `identifier`'s current window (shared by check and reset). */
function windowKey(identifier: string, opts: RateLimitOptions, now: number): { key: string; windowIndex: number } {
  const windowIndex = Math.floor(now / 1000 / opts.windowSec);
  return { key: `${opts.prefix ?? 'rl'}:${identifier}:${windowIndex}`, windowIndex };
}

export async function checkRateLimit(
  store: RateLimitStore,
  identifier: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = opts.now ? opts.now() : Date.now();
  const { key, windowIndex } = windowKey(identifier, opts, now);

  const count = await store.incr(key, opts.windowSec);
  const nextWindowStartMs = (windowIndex + 1) * opts.windowSec * 1000;
  const resetSec = Math.max(0, Math.ceil((nextWindowStartMs - now) / 1000));

  return {
    allowed: count <= opts.limit,
    count,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - count),
    resetSec,
  };
}

/**
 * Forget `identifier`'s count in the current window (no-op for a store without
 * `del`). Used to stop SUCCESSFUL logins from counting toward a per-account
 * lockout: every attempt still increments atomically (so parallel guesses stay
 * bounded), and a success clears the account's counter.
 */
export async function resetRateLimit(store: RateLimitStore, identifier: string, opts: RateLimitOptions): Promise<void> {
  if (!store.del) return;
  const now = opts.now ? opts.now() : Date.now();
  await store.del(windowKey(identifier, opts, now).key);
}

/**
 * In-memory store. Process-local (no good across serverless instances) — for
 * tests and single-process dev only.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async incr(key: string, windowSec: number): Promise<number> {
    const t = this.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= t) {
      this.counters.set(key, { count: 1, expiresAt: t + windowSec * 1000 });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async del(key: string): Promise<void> {
    this.counters.delete(key);
  }

  /** Test helper: drop all counters. */
  reset(): void {
    this.counters.clear();
  }
}

export class RateLimitError extends Error {
  constructor(
    readonly result: RateLimitResult,
    message = 'rate limit exceeded',
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}
