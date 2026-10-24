import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { insertJob, queueCounts, queueSql } from '@restomatch/queue';
import {
  dispatcherFor,
  IDLE_MAX_MS,
  IDLE_MIN_MS,
  makeWorker,
  missingQueueTables,
  missingQueueTablesMessage,
  nextIdleMs,
  startJobListener,
  wakeDispatchers,
} from '../queue';

/**
 * Idle egress (Supabase free plan: 5 GB/month). One dispatcher claims for every
 * queue with ONE query, backs off 1 s → 30 s while idle, and wakes at once on a
 * local insert or a NOTIFY from another process.
 */
const url = testDbUrl();
const sql = queueSql(url, 2);
const other = queueSql(url, 3); // a different pool = "another process" (the web)
const Q = `disp-${process.pid}`;

beforeEach(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
});
afterAll(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
});

const until = async (cond: () => Promise<boolean> | boolean, ms = 10_000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('idle backoff', () => {
  it('doubles from 1 s and caps at 30 s', () => {
    const seq = [IDLE_MIN_MS];
    while (seq.length < 8) seq.push(nextIdleMs(seq[seq.length - 1]!));
    expect(seq).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(IDLE_MAX_MS).toBe(30_000);
  });

  it('one claim query serves every queue, and an idle worker backs off (≈3 claims in 3.5 s, not 13 × 3.5)', async () => {
    const queues = Array.from({ length: 13 }, (_, i) => `${Q}-${i}`);
    const ws = queues.map((q) => makeWorker(q, async () => undefined, { sql }));
    await new Promise((r) => setTimeout(r, 3_500)); // claims at ~0 s, 1 s, 3 s
    const d = dispatcherFor(sql)!;
    expect(d.claims).toBeGreaterThanOrEqual(2);
    expect(d.claims).toBeLessThanOrEqual(4);
    expect(d.idleMs).toBeGreaterThanOrEqual(4_000);
    await Promise.all(ws.map((w) => w.close()));
  }, 10_000);

  it('a local insert wakes the idle dispatcher at once, and a claimed job resets the backoff', async () => {
    const seen: number[] = [];
    const w = makeWorker<{ n: number }>(`${Q}-wake`, async (job) => void seen.push(job.data.n), { sql });
    await new Promise((r) => setTimeout(r, 3_200)); // idle: next sleep is 4 s
    const t0 = Date.now();
    await insertJob(sql, `${Q}-wake`, { n: 1 });
    wakeDispatchers(); // what makeQueue.add / the scheduler do
    await until(() => seen.length === 1, 2_000);
    expect(Date.now() - t0).toBeLessThan(1_000);
    await until(async () => (await queueCounts(sql, `${Q}-wake`)).done === 1);
    expect(dispatcherFor(sql)!.idleMs).toBeLessThanOrEqual(2_000); // reset to 1 s, at most one empty claim since
    await w.close();
  }, 10_000);
});

describe('LISTEN / NOTIFY', () => {
  it('a job enqueued by ANOTHER process is picked up within ~1 s while the idle poll sleeps 30 s', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const seen: string[] = [];
    const w = makeWorker(`${Q}-notify`, async (job) => void seen.push(job.id), { sql });
    const stop = await startJobListener(sql, { DATABASE_URL: url } as NodeJS.ProcessEnv);
    await until(() => dispatcherFor(sql)!.listening, 5_000);
    await new Promise((r) => setTimeout(r, 300)); // let it go idle (listening → 30 s sleep)
    const claimsBefore = dispatcherFor(sql)!.claims;
    const t0 = Date.now();
    const job = await insertJob(other, `${Q}-notify`, {}); // no local wake: only the NOTIFY
    await until(() => seen.length === 1, 3_000);
    expect(seen).toEqual([job!.id]);
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(dispatcherFor(sql)!.claims - claimsBefore).toBeLessThanOrEqual(3);
    await stop();
    await w.close();
  }, 15_000);

  it('is skipped on the transaction pooler (6543), where LISTEN cannot work', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = await startJobListener(sql, { DATABASE_URL: 'postgres://u:p@pooler.supabase.com:6543/postgres' } as NodeJS.ProcessEnv);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/LISTEN disabled/));
    await stop();
  });
});

describe('deploy-order guard', () => {
  it('finds no missing tables on a migrated database, and the refusal is bilingual', async () => {
    expect(await missingQueueTables(sql)).toEqual([]);
    const msg = missingQueueTablesMessage(['job_queue']);
    expect(msg).toMatch(/REFUSING TO START: migration 0061/);
    expect(msg).toMatch(/מיגרציה 0061/);
  });
});
