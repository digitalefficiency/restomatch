import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createDb } from '@restomatch/db';
import { clearAlerted, getAlerted, readHeartbeatRaw, setAlerted } from '../workerHeartbeatStore';
import { evaluateHeartbeat } from '../workerHeartbeat';

/** The worker liveness signal on Postgres (0061 worker_heartbeats + ops_kv). */
const URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
const raw = postgres(URL, { max: 1, prepare: false, onnotice: () => {} });
const db = createDb(URL);

beforeAll(async () => {
  await raw`DELETE FROM worker_heartbeats`;
  await clearAlerted(db);
});
afterAll(async () => {
  await raw`DELETE FROM worker_heartbeats`;
  await clearAlerted(db);
  await raw.end();
});

describe('worker heartbeat store', () => {
  it('no row → missing (the banner shows)', async () => {
    expect(evaluateHeartbeat(await readHeartbeatRaw(db)).state).toBe('missing');
  });

  it('reads the NEWEST worker row as the heartbeat document', async () => {
    await raw`INSERT INTO worker_heartbeats (worker_id, host, pid, workers, started_at, beat_at) VALUES
      ('old', 'mac', 1, 12, now() - interval '2 days', now() - interval '1 day'),
      ('new', 'fly', 2, 13, now() - interval '1 hour', now() - interval '30 seconds')`;
    const doc = JSON.parse((await readHeartbeatRaw(db))!) as { host: string; workers: number };
    expect(doc).toMatchObject({ host: 'fly', workers: 13 });
    expect(evaluateHeartbeat(await readHeartbeatRaw(db)).state).toBe('ok');
  });

  it('a stale newest beat is "stale"', async () => {
    await raw`UPDATE worker_heartbeats SET beat_at = now() - interval '20 minutes'`;
    expect(evaluateHeartbeat(await readHeartbeatRaw(db)).state).toBe('stale');
  });

  it('alert marker: set with expiry, read, clear; expired counts as not alerted', async () => {
    expect(await getAlerted(db)).toBe(false);
    await setAlerted(3600, db);
    expect(await getAlerted(db)).toBe(true);
    await clearAlerted(db);
    expect(await getAlerted(db)).toBe(false);
    await setAlerted(3600, db);
    await raw`UPDATE ops_kv SET expires_at = now() - interval '1 second' WHERE key = 'worker:alerted'`;
    expect(await getAlerted(db)).toBe(false);
  });
});
