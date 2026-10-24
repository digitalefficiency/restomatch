import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { claimJob, insertJob, queueCounts, queueSql } from '@restomatch/queue';
import {
  dueSlot,
  makeQueue,
  makeWorker,
  parseDailyPattern,
  resetSchedulesForTests,
  runMaintenance,
  tickSchedules,
} from '../queue';

/** The Postgres job runtime that replaced BullMQ (real database). */
const sql = queueSql(testDbUrl());
const Q = `rt-${process.pid}`;

beforeEach(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
  resetSchedulesForTests();
});
afterAll(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
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
  it('every-N slots are floor(now / N)', () => {
    expect(dueSlot({ every: 60_000 }, new Date('2026-10-24T06:00:42Z'))).toBe(Date.parse('2026-10-24T06:00:00Z'));
  });

  it('daily slots are local time in the zone, due for 2 h after the slot', () => {
    const tz = 'Asia/Jerusalem'; // UTC+3 in October (IDT)
    const slot = Date.parse('2026-10-24T03:45:00Z'); // 06:45 local
    expect(dueSlot({ pattern: '45 6 * * *', tz }, new Date('2026-10-24T03:44:59Z'))).toBeNull();
    expect(dueSlot({ pattern: '45 6 * * *', tz }, new Date('2026-10-24T03:45:00Z'))).toBe(slot);
    expect(dueSlot({ pattern: '45 6 * * *', tz }, new Date('2026-10-24T05:44:00Z'))).toBe(slot);
    expect(dueSlot({ pattern: '45 6 * * *', tz }, new Date('2026-10-24T05:46:00Z'))).toBeNull();
    // Winter (IST, UTC+2): the same wall clock is an hour later in UTC.
    expect(dueSlot({ pattern: '0 6 * * *', tz }, new Date('2026-12-01T04:30:00Z'))).toBe(Date.parse('2026-12-01T04:00:00Z'));
  });

  it('rejects patterns it cannot run (at registration, not at 06:00)', async () => {
    expect(() => parseDailyPattern('*/5 * * * *')).toThrow(/unsupported pattern/);
    await expect(makeQueue(Q).upsertJobScheduler('bad', { pattern: '0 6 * * 1' }, { name: 'x', data: {} })).rejects.toThrow();
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
});
