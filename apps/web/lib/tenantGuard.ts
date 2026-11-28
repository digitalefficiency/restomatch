import type { Sql } from 'postgres';
import type { Database } from '@restomatch/db';
import { retryTransientDb } from './bootRetry';
import { assertAppRoleNoBypass, assertRlsEnabled } from './env';

/**
 * The tenant-boundary guard (Epic 0.1/0.3), run on the first tenant query
 * instead of in the boot hook.
 *
 * Why not at boot: Next.js memoizes a rejected instrumentation `register()` for
 * the life of the instance (and base-server keeps the rejected prepare
 * promise), so one CONNECT_TIMEOUT while Vercel froze an instance mid-handshake
 * answered 500 "An error occurred while loading instrumentation hook" on every
 * request to it (/, /pricing, /showcase/*, ...) until it was recycled. The boot
 * hook now does no awaited DB I/O.
 *
 * Still fail-closed: lib/db.ts hands tenant code a client that holds every
 * query and transaction until this guard has PASSED on this instance
 * (gateClient below). Nothing reaches the tenant pool before that, and nothing
 * ever does after a verdict.
 *
 * What is remembered: a PASS and a VERDICT (the database answered, and the role
 * bypasses RLS or a tenant table has RLS off). Nothing else. Every other
 * failure — a dropped or refused connection, DNS, a statement timeout, a pooler
 * error, an error nobody classified — means the guard has not been checked
 * yet: the next tenant query runs it again, and until it passes no tenant SQL
 * is sent.
 */

/**
 * When the guard applies (unchanged from the boot hook): always in production,
 * where the app role is mandatory; in dev/test whenever DATABASE_URL_APP is set
 * (to catch a role pointed at the owner). Only the explicit ALLOW_OWNER_DB /
 * NODE_ENV=test owner fallback skips it — that path bypasses RLS by design.
 */
export function tenantGuardRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.DATABASE_URL_APP || env.NODE_ENV === 'production';
}

/**
 * How long a tenant query waits for a guard that is still running before it is
 * refused (TenantGuardPendingError). Without it, a cold instance with the pooler
 * unreachable held its first tenant requests for retryTransientDb's whole run
 * (4 × postgres.js' 30 s connect_timeout + 3.5 s backoff ≈ 124 s), past every
 * route's maxDuration.
 */
export const TENANT_GUARD_DEADLINE_MS = 10_000;

/**
 * An attempt still running after this long is presumed hung (a socket frozen
 * mid-query, which no connect_timeout covers) and forgotten: the next caller
 * starts a fresh one. Above the ~124 s an attempt that is still making progress
 * can take, so it only ever replaces a hung one.
 */
export const TENANT_GUARD_ATTEMPT_TTL_MS = 150_000;

const VERDICT_BRAND = Symbol.for('restomatch.tenantGuard.verdict');

/**
 * The guard's own answer: the database was reached and said no (the role
 * bypasses RLS, or a tenant table has RLS disabled). The ONLY failure the guard
 * remembers. Same message as the lib/env.ts error it wraps, which is its
 * `cause`.
 */
export class TenantGuardVerdict extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = 'TenantGuardVerdict';
    Object.defineProperty(this, VERDICT_BRAND, { value: true });
  }
}

/** A brand, not instanceof: it holds across duplicated module copies (HMR, vi.resetModules). */
export function isTenantGuardVerdict(err: unknown): err is TenantGuardVerdict {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[VERDICT_BRAND] === true;
}

/** A tenant query refused because the guard did not finish within the deadline. Never remembered. */
export class TenantGuardPendingError extends Error {
  readonly code = 'TENANT_GUARD_PENDING';
  constructor(readonly waitedMs: number) {
    super(
      `[db] tenant guard still running after ${waitedMs} ms — tenant query refused. ` +
        `The guard keeps running; a later tenant query waits for it again.`,
    );
    this.name = 'TenantGuardPendingError';
  }
}

/**
 * The start of the message of each verdict lib/env.ts can reach (env.ts stays
 * as it is). No database, driver, socket or pooler error starts like this, so a
 * failure is a verdict only when the check itself decided it. Pinned by the
 * tests that run the real env.ts checks.
 */
const ROLE_VERDICT = /^\[env\] tenant-boundary guard FAILED: /;
const RLS_VERDICT = /^\[env\] RLS provisioning INCOMPLETE: /;

/** Run one env.ts check; its own verdict becomes a TenantGuardVerdict, anything else passes through as is. */
async function verdictOf(signature: RegExp, check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } catch (err) {
    throw err instanceof Error && signature.test(err.message) ? new TenantGuardVerdict(err) : err;
  }
}

/**
 * Wait for the guard. `deadlineMs` overrides the deadline for this caller only;
 * `null` waits until the attempt itself ends (the boot warm-up).
 */
export type EnsureGuard = (opts?: { deadlineMs?: number | null }) => Promise<void>;

export interface GuardTiming {
  /** Default TENANT_GUARD_DEADLINE_MS. */
  deadlineMs?: number;
  /** Default TENANT_GUARD_ATTEMPT_TTL_MS. */
  attemptTtlMs?: number;
  /** Clock for the attempt TTL (tests). */
  now?: () => number;
}

interface Attempt {
  promise: Promise<void>;
  startedAt: number;
  state: 'running' | 'passed' | 'verdict';
}

/**
 * Memoize a guard check for the life of the process.
 *  - Pass: kept; later callers resolve at once.
 *  - Verdict (isTenantGuardVerdict): kept, so every later caller gets the same
 *    rejection and tenant access stays closed on this instance until it is
 *    recycled — as a failed boot did before, but without taking down the pages
 *    that never touch tenant data.
 *  - Anything else, a synchronous throw included: forgotten, so the next caller
 *    runs the check again. A failure that is not a verdict says nothing about
 *    the role or the policies, and keeping it is exactly the outage this file
 *    exists to end.
 * Concurrent callers share one attempt. Each caller waits at most `deadlineMs`
 * for it (TenantGuardPendingError, never remembered — the attempt keeps
 * running and later callers join it). An attempt running longer than
 * `attemptTtlMs` is abandoned for a fresh one; its late outcome is ignored.
 */
export function memoizeGuard(check: () => Promise<void>, timing: GuardTiming = {}): EnsureGuard {
  const deadlineMs = timing.deadlineMs ?? TENANT_GUARD_DEADLINE_MS;
  const attemptTtlMs = timing.attemptTtlMs ?? TENANT_GUARD_ATTEMPT_TTL_MS;
  const now = timing.now ?? Date.now;
  let current: Attempt | null = null;

  const attempt = (): Attempt => {
    if (current && (current.state !== 'running' || now() - current.startedAt < attemptTtlMs)) return current;
    const entry: Attempt = { promise: Promise.resolve(), startedAt: now(), state: 'running' };
    // Promise.resolve().then: a synchronous throw is a rejection too (and not a verdict).
    entry.promise = Promise.resolve()
      .then(check)
      .then(
        () => {
          entry.state = 'passed';
        },
        (err: unknown) => {
          if (isTenantGuardVerdict(err)) entry.state = 'verdict';
          else if (current === entry) current = null;
          throw err;
        },
      );
    // Every caller gets the rejection; an attempt nobody waits on any more
    // (abandoned, or all its callers timed out) must not surface as unhandled.
    entry.promise.catch(() => {});
    current = entry;
    return entry;
  };

  return (opts = {}) => {
    const { promise, state } = attempt();
    const wait = opts.deadlineMs === undefined ? deadlineMs : opts.deadlineMs;
    if (state !== 'running' || wait === null || !Number.isFinite(wait)) return promise;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TenantGuardPendingError(wait)), wait);
      (timer as { unref?: () => void }).unref?.();
      promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  };
}

/**
 * The guard for the tenant pool: both checks from lib/env.ts, with the same
 * connection-error retry the boot hook used. `raw` must be the UNGATED handle
 * on that pool — the checks cannot wait on themselves.
 */
export function tenantGuard(
  raw: Database,
  env: NodeJS.ProcessEnv = process.env,
  timing: GuardTiming = {},
): EnsureGuard {
  return memoizeGuard(async () => {
    if (!tenantGuardRequired(env)) return;
    // A DATABASE_URL_APP pointing at owner/service_role would make RLS silently inert.
    await retryTransientDb('app-role guard', () => verdictOf(ROLE_VERDICT, () => assertAppRoleNoBypass(raw)));
    // And prove the policies were actually applied (no forgotten/new table).
    await retryTransientDb('RLS guard', () => verdictOf(RLS_VERDICT, () => assertRlsEnabled(raw)));
  }, timing);
}

/**
 * The boot hook's warm-up: start the guard at boot so a verdict is reported
 * there, without register() waiting for the database. It has no deadline:
 * nobody waits on it (register() has returned; tenant queries join the same
 * attempt with their own deadline), so it reports how the attempt really ended
 * — a verdict, or the failure that outlasted the retries — not "still pending".
 * It never rejects and never throws: an escaped rejection would be an
 * unhandledRejection in the server process.
 */
export function warmUpTenantGuard(
  ensure: EnsureGuard,
  captureException: (error: unknown, context?: Record<string, unknown>) => void,
): Promise<void> {
  return Promise.resolve()
    .then(() => ensure({ deadlineMs: null }))
    .then(
      () => undefined,
      (err: unknown) => {
        try {
          const verdict = isTenantGuardVerdict(err);
          try {
            const message = err instanceof Error ? err.message : String(err);
            if (verdict) {
              console.error(`[boot] tenant guard FAILED — tenant DB access is blocked on this instance: ${message}`);
            } else {
              console.warn(
                `[boot] tenant guard not checked yet (${message}); tenant queries stay held and the next one runs it again`,
              );
            }
          } catch {
            /* logging must never break the boot */
          }
          captureException(err, { stage: 'tenant-guard-warmup', verdict });
        } catch {
          /* observability must never break the boot */
        }
      },
    );
}

/** Members of the root client that send no SQL; everything else that is a function is refused. */
const PASS_THROUGH = new Set<PropertyKey>([
  'options',
  'parameters',
  'end',
  'close',
  'CLOSE',
  'END',
  'PostgresError',
  'types',
  'typed',
  'array',
  'json',
]);

/**
 * The tenant pool's postgres.js client as Drizzle sees it. Drizzle's postgres-js
 * driver sends every statement through `unsafe()` and opens every transaction
 * with `begin()` (the statements inside run on the transaction's own connection,
 * which only exists once the guard passed) — both wait for `ready()` here.
 *
 * Any other way to send SQL on the root client — the tagged template,
 * `reserve`, `file`, `listen`/`notify`, `subscribe`, `largeObject`, or a
 * member a later postgres.js adds — throws instead: nothing in the web app uses
 * them, and an unknown path must fail loudly, never skip the guard.
 */
export function gateClient(client: Sql, ready: () => Promise<void>): Sql {
  const unsafe = (...args: Parameters<Sql['unsafe']>) => new GatedQuery(ready, () => client.unsafe(...args));
  const begin = (...args: unknown[]) =>
    ready().then(() => (client.begin as (...a: unknown[]) => Promise<unknown>)(...args));
  return new Proxy(client, {
    apply() {
      throw refused('the tagged-template query');
    },
    get(target, prop) {
      if (prop === 'unsafe') return unsafe;
      if (prop === 'begin') return begin;
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== 'function' || PASS_THROUGH.has(prop)) return value;
      return () => {
        throw refused(`sql.${String(prop)}()`);
      };
    },
  });
}

function refused(what: string): Error {
  return new Error(
    `[db] ${what} on the tenant pool would bypass the tenant guard — use Drizzle (db.execute / db.select / db.transaction).`,
  );
}

/**
 * Stand-in for the PendingQuery that `unsafe()` returns. Lazy like the real one
 * — nothing is created or sent until it is awaited — so `.values()`, the one
 * modifier Drizzle applies, still works. The real query is created only once
 * `ready()` resolved. Any other PendingQuery method is absent and throws: loud,
 * never ungated.
 */
class GatedQuery implements PromiseLike<unknown> {
  private arrays = false;
  private run: Promise<unknown> | null = null;

  constructor(
    private readonly ready: () => Promise<void>,
    private readonly issue: () => ReturnType<Sql['unsafe']>,
  ) {}

  values(): this {
    this.arrays = true;
    return this;
  }

  then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.run ??= this.ready().then(() => {
      const query = this.issue();
      return this.arrays ? query.values() : query;
    });
    return this.run.then(onFulfilled, onRejected);
  }
}
