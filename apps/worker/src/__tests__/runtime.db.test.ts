import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { claimJob, insertJob, queueCounts, queueSql } from '@restomatch/queue';
import {
  assertPattern,
  dueSlot,
  firstTickKey,
  makeQueue,
  makeWorker,
  resetSchedulesForTests,
  runMaintenance,
  tickSchedules,
  type WorkerJob,
} from '../queue';

/** The Postgres job runtime that replaced BullMQ (real database). */
const sql = queueSql(testDbUrl());
const Q = `rt-${process.pid}`;

beforeEach(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
  await sql`DELETE FROM ops_kv WHERE starts_with(key, ${firstTickKey(Q)})`;
  resetSchedulesForTests();
});
afterAll(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
  await sql`DELETE FROM ops_kv WHERE starts_with(key, ${firstTickKey(Q)})`;
});

const until = async (cond: () => Promise<boolean>, ms = 10_000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('makeWorker', () => {
  it('processes queued jobs and marks them done', async () => {
    const seen: number[] = [];
    const w = makeWorker<{ n: number }>(Q, async (job) => void seen.push(job.data.n), { pollMs: 50, sql });
    for (let i = 0; i < 5; i++) await insertJob(sql, Q, { n: i });
    await until(async () => (await queueCounts(sql, Q)).done === 5);
    await w.close();
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('a throwing processor is retried (max_attempts) and then failed, with the error kept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const w = makeWorker(Q, async () => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    }, { pollMs: 50, sql });
    await insertJob(sql, Q, {}, { maxAttempts: 2 });
    await until(async () => (await queueCounts(sql, Q)).delayed === 1);
    await sql`UPDATE job_queue SET run_at = now() WHERE queue = ${Q}`; // skip the 5 s backoff
    await until(async () => (await queueCounts(sql, Q)).failed === 1);
    await w.close();
    expect(calls).toBe(2);
    const [row] = await sql<Array<{ last_error: string; attempts: number }>>`SELECT last_error, attempts FROM job_queue WHERE queue = ${Q}`;
    expect(row).toMatchObject({ last_error: 'boom 2', attempts: 2 });
  });

  it('close() waits for the in-flight job (graceful drain)', async () => {
    let finished = false;
    const w = makeWorker(Q, async () => {
      await new Promise((r) => setTimeout(r, 300));
      finished = true;
    }, { pollMs: 50, sql });
    await insertJob(sql, Q, {});
    await until(async () => (await queueCounts(sql, Q)).active === 1);
    await w.close();
    expect(finished).toBe(true);
    expect((await queueCounts(sql, Q)).done).toBe(1);
  });
});

describe('schedules', () => {
  const tz = 'Asia/Jerusalem';
  const at = (pattern: string, iso: string, z = tz) => dueSlot({ pattern, tz: z }, new Date(iso));

  it('every-N slots are floor(now / N) and are never a catch-up', () => {
    expect(dueSlot({ every: 60_000 }, new Date('2026-10-24T06:00:42Z'))).toEqual({
      at: Date.parse('2026-10-24T06:00:00Z'),
      label: '2026-10-24T06:00:00.000Z',
      catchUp: false,
    });
  });

  it('daily slots are local time in the zone; on time at the slot, a catch-up after it, gone after 6 h', () => {
    const slot = Date.parse('2026-10-24T03:45:00Z'); // 06:45 IDT (UTC+3)
    expect(at('45 6 * * *', '2026-10-24T03:44:59Z')?.at).not.toBe(slot); // still yesterday's
    expect(at('45 6 * * *', '2026-10-24T03:45:00Z')).toEqual({ at: slot, label: '2026-10-24T06:45', catchUp: false });
    expect(at('45 6 * * *', '2026-10-24T05:44:00Z')).toMatchObject({ at: slot, catchUp: true });
    expect(at('45 6 * * *', '2026-10-24T09:44:00Z')).toMatchObject({ at: slot, catchUp: true });
    expect(at('45 6 * * *', '2026-10-24T09:46:00Z')).toBeNull();
    // Winter (IST, UTC+2): the same wall clock is an hour later in UTC.
    expect(at('0 6 * * *', '2026-12-01T04:00:30Z')).toMatchObject({ at: Date.parse('2026-12-01T04:00:00Z'), catchUp: false });
  });

  it('DST fall-back day in Israel, 2026-10-25 (02:00 IDT → 01:00 IST): every cron.ts slot is right', () => {
    // 02:00 exists once (IST) → 00:00Z; 03:30 → 01:30Z; 06:00 → 04:00Z; 19:00 → 17:00Z.
    expect(at('0 2 * * *', '2026-10-25T00:00:10Z')).toMatchObject({ at: Date.parse('2026-10-25T00:00:00Z'), label: '2026-10-25T02:00' });
    expect(at('30 3 * * *', '2026-10-25T01:30:10Z')).toMatchObject({ at: Date.parse('2026-10-25T01:30:00Z') });
    expect(at('0 6 * * *', '2026-10-25T04:00:10Z')).toMatchObject({ at: Date.parse('2026-10-25T04:00:00Z'), catchUp: false });
    expect(at('0 19 * * *', '2026-10-25T17:00:10Z')).toMatchObject({ at: Date.parse('2026-10-25T17:00:00Z') });
    // The day before is still IDT (UTC+3).
    expect(at('0 6 * * *', '2026-10-24T03:00:10Z')).toMatchObject({ at: Date.parse('2026-10-24T03:00:00Z') });
    // The repeated hour (01:xx twice) collapses to ONE wall-clock label → one dedupe key.
    expect(at('30 1 * * *', '2026-10-24T22:30:10Z')?.label).toBe('2026-10-25T01:30');
    expect(at('30 1 * * *', '2026-10-24T23:30:10Z')?.label).toBe('2026-10-25T01:30');
  });

  it('monthly slots (S12 "45 7 1 * *") are caught up for 3 days', () => {
    const first = Date.parse('2026-11-01T05:45:00Z'); // 07:45 IST
    expect(at('45 7 1 * *', '2026-11-01T05:45:05Z')).toMatchObject({ at: first, catchUp: false });
    expect(at('45 7 1 * *', '2026-11-03T12:00:00Z')).toMatchObject({ at: first, catchUp: true });
    expect(at('45 7 1 * *', '2026-11-04T06:00:00Z')).toBeNull();
  });

  it('accepts every pattern the wave-1 schedule uses and rejects bad ones at registration', async () => {
    for (const p of ['0 6 * * *', '0 2 * * *', '0 9 * * *', '0 10 * * *', '0 19 * * *', '0 7 * * *', '30 8 * * *', '45 7 1 * *', '45 6 * * *', '30 3 * * *']) {
      expect(() => assertPattern(p, tz)).not.toThrow();
    }
    expect(() => assertPattern('0 6 * *', tz)).toThrow(/5 fields/);
    expect(() => assertPattern('61 6 * * *', tz)).toThrow();
    await expect(makeQueue(Q).upsertJobScheduler('bad', { pattern: '0 25 * * *', tz }, { name: 'x', data: {} })).rejects.toThrow();
    await expect(makeQueue(Q).upsertJobScheduler('bad', { every: 0 }, { name: 'x', data: {} })).rejects.toThrow();
  });

  it('a slot becomes exactly one job, even when two workers tick it', async () => {
    const now = new Date('2026-10-24T06:00:30Z');
    const q = makeQueue(Q);
    await q.upsertJobScheduler(`${Q}-every`, { every: 60_000 }, { name: 'x', data: { from: 'cron' } });
    expect(await tickSchedules(sql, now)).toEqual([`${Q}-every`]);
    // "Second worker": a fresh process has no in-memory lastSlot.
    resetSchedulesForTests();
    await q.upsertJobScheduler(`${Q}-every`, { every: 60_000 }, { name: 'x', data: { from: 'cron' } });
    expect(await tickSchedules(sql, now)).toEqual([]);
    expect((await queueCounts(sql, Q)).waiting).toBe(1);
    // Next minute → next job.
    expect(await tickSchedules(sql, new Date('2026-10-24T06:01:05Z'))).toEqual([`${Q}-every`]);
    expect((await queueCounts(sql, Q)).waiting).toBe(2);
  });

  it('cron pattern + tz: on-time slot fires once; a missed slot is caught up when the worker wakes', async () => {
    const id = `${Q}-daily`;
    const q = makeQueue(Q);
    await q.upsertJobScheduler(id, { pattern: '0 6 * * *', tz }, { name: 'x', data: { from: 'cron' } });
    // Day 1, on time.
    expect(await tickSchedules(sql, new Date('2026-10-24T03:00:05Z'))).toEqual([id]);
    expect(await tickSchedules(sql, new Date('2026-10-24T03:00:15Z'))).toEqual([]);
    // Day 2 (DST day): the Mac slept through 06:00 and wakes at 09:30 local → caught up once.
    resetSchedulesForTests();
    await q.upsertJobScheduler(id, { pattern: '0 6 * * *', tz }, { name: 'x', data: { from: 'cron' } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await tickSchedules(sql, new Date('2026-10-25T07:30:00Z'))).toEqual([id]);
    expect(await tickSchedules(sql, new Date('2026-10-25T07:31:00Z'))).toEqual([]);
    const keys = await sql<Array<{ dedupe_key: string }>>`SELECT dedupe_key FROM job_queue WHERE queue = ${Q} ORDER BY id`;
    expect(keys.map((k) => k.dedupe_key)).toEqual([`cron:${id}:2026-10-24T06:00`, `cron:${id}:2026-10-25T06:00`]);
  });

  it("the first tick of a schedule on a fresh database does not replay a slot BullMQ already ran (cutover)", async () => {
    const id = `${Q}-cutover`;
    await makeQueue(Q).upsertJobScheduler(id, { pattern: '0 6 * * *', tz }, { name: 'x', data: {} });
    // Deployed at 08:00 local; 06:00 already ran on the old worker.
    expect(await tickSchedules(sql, new Date('2026-10-24T05:00:00Z'))).toEqual([]);
    const rows = await sql<Array<{ status: string; result: { skipped?: string } }>>`SELECT status, result FROM job_queue WHERE queue = ${Q}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'done', result: { skipped: expect.any(String) } });
    // The next day's slot runs normally.
    expect(await tickSchedules(sql, new Date('2026-10-25T04:00:05Z'))).toEqual([id]);
  });

  it('a slot missed AFTER the cutover is caught up, though the schedule has no job row yet (daily + monthly)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const daily = `${Q}-later-daily`;
    const monthly = `${Q}-later-monthly`;
    const register = async () => {
      const q = makeQueue(Q);
      await q.upsertJobScheduler(daily, { pattern: '0 6 * * *', tz }, { name: 'x', data: {} });
      await q.upsertJobScheduler(monthly, { pattern: '45 7 1 * *', tz }, { name: 'x', data: {} });
    };
    await register();
    // Cutover boot at 15:28 IL: both last slots are outside their catch-up windows, nothing is due
    // and no job row is written — but the first tick is recorded.
    expect(await tickSchedules(sql, new Date('2026-10-24T12:28:16Z'))).toEqual([]);
    expect(await sql`SELECT 1 FROM job_queue WHERE queue = ${Q}`).toHaveLength(0);
    const marks = await sql<Array<{ key: string; expires_at: Date | null }>>`
      SELECT key, expires_at FROM ops_kv WHERE starts_with(key, ${firstTickKey(Q)}) ORDER BY key`;
    expect(marks).toEqual([
      { key: firstTickKey(daily), expires_at: null },
      { key: firstTickKey(monthly), expires_at: null },
    ]);
    // The worker restarts (a fresh process) and the Mac sleeps through 06:00; it wakes at 07:30 IL.
    resetSchedulesForTests();
    await register();
    expect(await tickSchedules(sql, new Date('2026-10-25T05:30:00Z'))).toEqual([daily]);
    // Pruning removes the finished job rows (7 days); the first-tick record survives it.
    await sql`DELETE FROM job_queue WHERE queue = ${Q}`;
    await runMaintenance(sql);
    // The first monthly report slot (Sun 2026-11-01 07:45 IL) is missed, and that day's 06:00 too;
    // the worker is up at 09:00 IL.
    resetSchedulesForTests();
    await register();
    expect(await tickSchedules(sql, new Date('2026-11-01T07:00:00Z'))).toEqual([daily, monthly]);
    const rows = await sql<Array<{ dedupe_key: string; status: string; result: unknown }>>`
      SELECT dedupe_key, status, result FROM job_queue WHERE queue = ${Q} ORDER BY id`;
    expect(rows).toEqual([
      { dedupe_key: `cron:${daily}:2026-11-01T06:00`, status: 'queued', result: null },
      { dedupe_key: `cron:${monthly}:2026-11-01T07:45`, status: 'queued', result: null },
    ]);
  });

  it('two workers agree on the first tick: the earliest record wins', async () => {
    const id = `${Q}-first-two`;
    await makeQueue(Q).upsertJobScheduler(id, { pattern: '0 6 * * *', tz }, { name: 'x', data: {} });
    await tickSchedules(sql, new Date('2026-10-24T12:00:00Z'));
    resetSchedulesForTests();
    await makeQueue(Q).upsertJobScheduler(id, { pattern: '0 6 * * *', tz }, { name: 'x', data: {} });
    await tickSchedules(sql, new Date('2026-10-24T13:00:00Z'));
    const [mark] = await sql<Array<{ value: { at: string } }>>`SELECT value FROM ops_kv WHERE key = ${firstTickKey(id)}`;
    expect(mark!.value.at).toBe('2026-10-24T12:00:00.000Z');
  });
});

describe('BullMQ-shaped surface (wave-1 job modules)', () => {
  it('a processor sees attemptsMade (before this run) and opts.attempts, like BullMQ', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: Array<Pick<WorkerJob<unknown>, 'attemptsMade' | 'opts'>> = [];
    const w = makeWorker(Q, async (job) => {
      seen.push({ attemptsMade: job.attemptsMade, opts: job.opts });
      throw new Error('again');
    }, { pollMs: 50, sql });
    await insertJob(sql, Q, {}, { maxAttempts: 2 });
    await until(async () => (await queueCounts(sql, Q)).delayed === 1);
    await sql`UPDATE job_queue SET run_at = now() WHERE queue = ${Q}`;
    await until(async () => (await queueCounts(sql, Q)).failed === 1);
    await w.close();
    expect(seen).toEqual([
      { attemptsMade: 0, opts: { attempts: 2 } },
      { attemptsMade: 1, opts: { attempts: 2 } }, // the last attempt: (attemptsMade + 1) >= attempts
    ]);
  });

  it('getJobs / getFailed / getJobCounts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const q = makeQueue<{ n: number }>(Q);
    await insertJob(sql, Q, { n: 1 });
    await insertJob(sql, Q, { n: 2 }, { runAt: new Date(Date.now() + 3600_000) });
    const failed = await insertJob(sql, Q, { n: 3 });
    await sql`UPDATE job_queue SET status = 'failed', last_error = 'x', finished_at = now() WHERE id = ${failed!.id}`;
    const waiting = await q.getJobs(['waiting']);
    expect(waiting.map((j) => j.data.n)).toEqual([1]);
    expect((await q.getJobs(['waiting', 'delayed'])).map((j) => j.data.n).sort()).toEqual([1, 2]);
    expect((await q.getJobs('failed'))[0]).toMatchObject({ data: { n: 3 }, failedReason: 'x' });
    expect(await q.getFailed()).toHaveLength(1);
    expect(await q.getJobCounts('waiting', 'delayed', 'failed')).toMatchObject({ waiting: 1, delayed: 1, failed: 1, completed: 0 });
  });
});

describe('maintenance', () => {
  it('requeues a job whose worker died (lock not renewed)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertJob(sql, Q, {}, { maxAttempts: 2 });
    const j = await claimJob(sql, Q, 'dead-worker');
    await sql`UPDATE job_queue SET locked_at = now() - interval '5 minutes' WHERE id = ${j!.id}`;
    await runMaintenance(sql);
    expect(await queueCounts(sql, Q)).toMatchObject({ waiting: 1, active: 0 });
  });

  it('a stall does not use up the only attempt (BullMQ maxStalledCount = 1); a second stall fails the job', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertJob(sql, Q, {}); // max_attempts 1, like ocr-invoice
    const stall = async () => {
      const j = await claimJob(sql, Q, 'dead-worker');
      await sql`UPDATE job_queue SET locked_at = now() - interval '5 minutes' WHERE id = ${j!.id}`;
      await runMaintenance(sql);
    };
    await stall();
    expect(await queueCounts(sql, Q)).toMatchObject({ waiting: 1, failed: 0 });
    const [row] = await sql<Array<{ attempts: number; stalled_count: number }>>`SELECT attempts, stalled_count FROM job_queue WHERE queue = ${Q}`;
    expect(row).toEqual({ attempts: 0, stalled_count: 1 });
    await stall();
    expect(await queueCounts(sql, Q)).toMatchObject({ waiting: 0, failed: 1 });
  });

  it("never takes back this process's own in-flight job, even if its lock looks stale (laptop sleep)", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    const w = makeWorker(Q, async () => {
      runs += 1;
      await gate;
    }, { pollMs: 50, sql });
    await insertJob(sql, Q, {});
    await until(async () => (await queueCounts(sql, Q)).active === 1);
    await sql`UPDATE job_queue SET locked_at = now() - interval '5 minutes' WHERE queue = ${Q}`;
    await runMaintenance(sql);
    expect(await queueCounts(sql, Q)).toMatchObject({ active: 1, waiting: 0 });
    const [row] = await sql<Array<{ fresh: boolean }>>`SELECT locked_at > now() - interval '10 seconds' AS fresh FROM job_queue WHERE queue = ${Q}`;
    expect(row?.fresh).toBe(true); // renewed first
    release();
    await w.close();
    expect(runs).toBe(1);
    expect((await queueCounts(sql, Q)).done).toBe(1);
  });
});
