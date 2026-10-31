import { afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { loadJobRunner } from '../jobKick';

/**
 * The serverless job runner on production's 2026-10-24 environment: DATABASE_URL
 * pasted beyond repair, the Supabase integration's POSTGRES_URL fine. The queue
 * (queueDbUrl) and every job read DATABASE_URL themselves — before the repair
 * the tick threw "Invalid URL" (→ /api/cron/jobs 500 every minute, nothing ran).
 * loadJobRunner (the cron route's and the kick's loader) puts the repaired owner
 * URL there first; the REAL runServerlessTick then beats and ticks 'ok'.
 *
 * budgetMs 0: the tick turns due schedules into jobs but runs none of them here;
 * the rows it wrote are removed afterwards.
 */
const TEST_DB = process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
const HOST = 'dbenv-probe';
const check = postgres(TEST_DB, { max: 1, onnotice: () => {} });
let firstTicksBefore: string[] = [];
let lastJobBefore = '0';

afterAll(async () => {
  vi.unstubAllEnvs();
  await check`DELETE FROM job_queue WHERE id > ${lastJobBefore}::bigint AND starts_with(dedupe_key, 'cron:')`;
  await check`DELETE FROM worker_heartbeats WHERE worker_id = ${HOST}`;
  await check`DELETE FROM ops_kv WHERE starts_with(key, 'cron:first_tick:') AND NOT (key = ANY(${firstTicksBefore}::text[]))`;
  await check.end({ timeout: 5 });
  const { closeQueueSql } = await import('@restomatch/queue');
  await closeQueueSql();
});

describe('serverless runner with DATABASE_URL beyond repair + POSTGRES_URL', () => {
  it('runServerlessTick reaches the database and answers ok', async () => {
    firstTicksBefore = (await check<Array<{ key: string }>>`SELECT key FROM ops_kv WHERE starts_with(key, 'cron:first_tick:')`).map(
      (r) => r.key,
    );
    const [last] = await check<Array<{ id: string }>>`SELECT coalesce(max(id), 0)::text AS id FROM job_queue`;
    lastJobBefore = last!.id;
    vi.stubEnv('DATABASE_URL', 'just-a-password');
    vi.stubEnv('POSTGRES_URL', TEST_DB);
    vi.stubEnv('QUEUE_DATABASE_URL', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runServerlessTick } = await loadJobRunner();
    expect(process.env.DATABASE_URL).not.toBe('just-a-password');
    const r = await runServerlessTick({ budgetMs: 0, heartbeatHost: HOST });
    expect(r).toMatchObject({ ok: true, maintenance: 'ok', jobs: { ran: 0, stoppedBy: 'budget' } });
    const [beat] = await check<Array<{ fresh: boolean }>>`
      SELECT beat_at > now() - interval '1 minute' AS fresh FROM worker_heartbeats WHERE worker_id = ${HOST}`;
    expect(beat).toEqual({ fresh: true });
  }, 60_000);
});
