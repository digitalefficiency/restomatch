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
const pools = new Map<string, Database>();

export function jobDb(url: string): Database {
  let db = pools.get(url);
  if (!db) {
    db = createDb(url);
    pools.set(url, db);
  }
  return db;
}

/** Test hook: how many distinct pools exist. */
export function jobDbPoolCount(): number {
  return pools.size;
}
