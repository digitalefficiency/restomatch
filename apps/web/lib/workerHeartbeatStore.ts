import 'server-only';
import { sql } from '@restomatch/db';

/**
 * Where the worker liveness signal lives (0061; was Redis keys): the freshest
 * row of worker_heartbeats, and the one-email-per-outage marker in ops_kv.
 * Read on the AUTH (owner) connection — the tenant app role has no access to
 * these tables. evaluateHeartbeat() (lib/workerHeartbeat.ts) stays pure: this
 * module only turns the row back into the JSON document it always took.
 */
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

async function authDbLazy(): Promise<Exec> {
  return (await import('./authDb')).authDb;
}

/** The newest heartbeat as the JSON document evaluateHeartbeat() expects, or null. */
export async function readHeartbeatRaw(db?: Exec): Promise<string | null> {
  const conn = db ?? (await authDbLazy());
  const rows = (await conn.execute(sql`
    SELECT host, pid, workers, started_at, beat_at FROM worker_heartbeats
     ORDER BY beat_at DESC LIMIT 1`)) as unknown as Array<{
    host: string;
    pid: number;
    workers: number;
    started_at: Date | string;
    beat_at: Date | string;
  }>;
  const r = rows[0];
  if (!r) return null;
  const iso = (v: Date | string) => new Date(v).toISOString();
  return JSON.stringify({ at: iso(r.beat_at), pid: r.pid, host: r.host, workers: r.workers, startedAt: iso(r.started_at) });
}

export const ALERTED_KEY = 'worker:alerted';

export async function getAlerted(db?: Exec): Promise<boolean> {
  const conn = db ?? (await authDbLazy());
  const rows = (await conn.execute(sql`
    SELECT 1 FROM ops_kv WHERE key = ${ALERTED_KEY} AND (expires_at IS NULL OR expires_at > now())`)) as unknown as unknown[];
  return rows.length > 0;
}

export async function setAlerted(ttlSec: number, db?: Exec): Promise<void> {
  const conn = db ?? (await authDbLazy());
  await conn.execute(sql`
    INSERT INTO ops_kv (key, value, expires_at) VALUES (${ALERTED_KEY}, 'true'::jsonb, now() + ${ttlSec} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`);
}

export async function clearAlerted(db?: Exec): Promise<void> {
  const conn = db ?? (await authDbLazy());
  await conn.execute(sql`DELETE FROM ops_kv WHERE key = ${ALERTED_KEY}`);
}
