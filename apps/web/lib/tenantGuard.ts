import type { Sql } from 'postgres';
import type { Database } from '@restomatch/db';
import { isTransientDbError, retryTransientDb } from './bootRetry';
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
 * ever does after a verdict failure.
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
 * Memoize a guard check for the life of the process.
 *  - Pass: cached; later callers resolve at once.
 *  - Connection failure (isTransientDbError): forgotten, so the next caller runs
 *    the check again. A dropped connection says nothing about the role or the
 *    policies, and caching it is exactly the outage this file exists to end.
 *  - Anything else is a verdict (role bypasses RLS, a table without RLS, or an
 *    error we cannot classify): cached, so every later caller gets the same
 *    rejection and tenant access stays closed on this instance until it is
 *    recycled — as a failed boot did before, but without taking down the pages
 *    that never touch tenant data.
 */
export function memoizeGuard(check: () => Promise<void>): () => Promise<void> {
  let verdict: Promise<void> | null = null;
  return () => {
    if (!verdict) {
      // Promise.resolve().then: a synchronous throw is a rejection (a verdict) too.
      const attempt: Promise<void> = Promise.resolve()
        .then(check)
        .catch((err: unknown) => {
          if (isTransientDbError(err) && verdict === attempt) verdict = null;
          throw err;
        });
      verdict = attempt;
    }
    return verdict;
  };
}

/**
 * The guard for the tenant pool: both checks from lib/env.ts, with the same
 * connection-error retry the boot hook used. `raw` must be the UNGATED handle
 * on that pool — the checks cannot wait on themselves.
 */
export function tenantGuard(raw: Database, env: NodeJS.ProcessEnv = process.env): () => Promise<void> {
  return memoizeGuard(async () => {
    if (!tenantGuardRequired(env)) return;
    // A DATABASE_URL_APP pointing at owner/service_role would make RLS silently inert.
    await retryTransientDb('app-role guard', () => assertAppRoleNoBypass(raw));
    // And prove the policies were actually applied (no forgotten/new table).
    await retryTransientDb('RLS guard', () => assertRlsEnabled(raw));
  });
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
