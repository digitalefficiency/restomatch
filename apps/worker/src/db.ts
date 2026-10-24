import { createDb, type Database } from '@restomatch/db';

/**
 * One Postgres pool per worker process (per connection string).
 *
 * Every job used to call createDb(url) on each run. postgres.js pools never
 * close idle connections by default, so each run leaked its connection(s) for
 * the life of the process — outbox-dispatch alone ticks every 60 s, so a
 * long-running worker grew until Postgres / the Supabase pooler refused new
 * connections. Jobs now share this pool (createDb caps it at 10).
 */
// On globalThis: inside the web app (serverless runner) Next can load this module
// once per bundle — the cron route and the after() kick must share one pool.
const memo = globalThis as unknown as { __restomatchJobDbs?: Map<string, Database> };
const pools = (memo.__restomatchJobDbs ??= new Map<string, Database>());

/** Idle connections of the worker's pools close after 5 min (web: 20 s). */
export const WORKER_IDLE_TIMEOUT_SEC = 300;
/** The web app's idle timeout (packages/db createDb default, packages/queue queueSql). */
export const SERVERLESS_IDLE_TIMEOUT_SEC = 20;

let idleTimeoutSec = WORKER_IDLE_TIMEOUT_SEC;

/**
 * Jobs run inside the web app (serverless.ts): short-lived instances, many of
 * them on the Supabase pooler — release idle connections like the web does
 * instead of holding them 5 min. Call before the first jobDb()/workerSql().
 */
export function useServerlessPools(): void {
  idleTimeoutSec = SERVERLESS_IDLE_TIMEOUT_SEC;
}

/** Idle timeout for the job pools of this process (worker 300 s, serverless 20 s). */
export function jobIdleTimeoutSec(): number {
  return idleTimeoutSec;
}

export function jobDb(url: string): Database {
  let db = pools.get(url);
  if (!db) {
    // Long-lived process: keep connections warm (outbox-dispatch runs every
    // 60 s) instead of reconnecting each minute — see WORKER_IDLE_TIMEOUT_SEC.
    db = createDb(url, { idleTimeoutSec });
    pools.set(url, db);
  }
  return db;
}

/** Graceful shutdown: drain every pool (in-flight queries finish first). */
export async function closeJobDbs(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(
    all.map((db) => (db as unknown as { $client?: { end?: (o?: { timeout?: number }) => Promise<void> } }).$client?.end?.({ timeout: 5 })),
  );
}

/** Test hook: how many distinct pools exist. */
export function jobDbPoolCount(): number {
  return pools.size;
}
