import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimAnySerial,
  closeQueueSql,
  completeJob,
  currentRunScope,
  enqueue,
  insertJob,
  notifyEnqueued,
  setEnqueueListener,
  withRunScope,
} from '../index';

/**
 * Serverless jobs, the queue side:
 *  - the enqueue hook (kick.ts): a producer inside a runner adds its queue to that
 *    run; otherwise the registered listener is told; nothing registered → no-op;
 *    a throwing listener never fails the producer;
 *  - claimAnySerial: never two jobs of the same queue + tenant at once, across
 *    claimers, and still exactly-once under parallel claims.
 */
const URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
const sql = postgres(URL, { max: 8, prepare: false, onnotice: () => {} });
const Q = `kick-${process.pid}`;
const STALL = 2 * 60_000;
const saved = process.env.QUEUE_DATABASE_URL;

beforeEach(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
});
afterEach(async () => {
  setEnqueueListener(null);
  if (saved === undefined) delete process.env.QUEUE_DATABASE_URL;
  else process.env.QUEUE_DATABASE_URL = saved;
});
afterAll(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
  await sql`DELETE FROM restaurants WHERE name = 'kick test'`;
  await closeQueueSql();
  await sql.end();
});

describe('enqueue hook', () => {
  it('no listener and no runner: a no-op', () => {
    expect(notifyEnqueued('ocr-invoice')).toBe('none');
  });

  it('enqueue() tells the listener the queue, after the row is in', async () => {
    process.env.QUEUE_DATABASE_URL = URL;
    const seen: Array<{ queue: string; rows: number }> = [];
    const pending: Promise<void>[] = [];
    setEnqueueListener((queue) => {
      pending.push(
        sql`SELECT count(*)::int AS n FROM job_queue WHERE queue = ${queue}`.then(([r]) => {
          seen.push({ queue, rows: (r as { n: number }).n });
        }),
      );
    });
    expect(await enqueue(`${Q}-a`, { n: 1 })).toBe(true);
    await Promise.all(pending);
    expect(seen).toEqual([{ queue: `${Q}-a`, rows: 1 }]);
  });

  it('inside a runner the queue joins the run, and the listener is NOT told', async () => {
    process.env.QUEUE_DATABASE_URL = URL;
    const listener = vi.fn();
    setEnqueueListener(listener);
    const scope = { queues: new Set([`${Q}-ocr`]) };
    await withRunScope(scope, async () => {
      expect(currentRunScope()).toBe(scope);
      await enqueue(`${Q}-match`, { n: 2 }); // e.g. the OCR job enqueueing its match job
    });
    expect([...scope.queues].sort()).toEqual([`${Q}-match`, `${Q}-ocr`]);
    expect(listener).not.toHaveBeenCalled();
    expect(currentRunScope()).toBeUndefined();
  });

  it('a throwing listener never fails the producer', async () => {
    process.env.QUEUE_DATABASE_URL = URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setEnqueueListener(() => {
      throw new Error('after() outside a request scope');
    });
    await expect(enqueue(`${Q}-b`, {})).resolves.toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('enqueue listener failed'));
    warn.mockRestore();
  });
});

describe('claimAnySerial', () => {
  // Claims go oldest run_at first, then by (random uuid) id. insertJob's default run_at is new Date(),
  // so two inserts in the same millisecond tie and their order is a coin flip: give the jobs whose
  // order the test asserts distinct, increasing run_at values.
  const at = (n: number) => ({ runAt: new Date(Date.now() - 60_000 + n * 1000) });
  it('one job per queue + tenant at a time; other tenants and queues still run', async () => {
    const [a] = await sql<Array<{ id: string }>>`INSERT INTO restaurants (name) VALUES ('kick test') RETURNING id`;
    const [b] = await sql<Array<{ id: string }>>`INSERT INTO restaurants (name) VALUES ('kick test') RETURNING id`;
    await insertJob(sql, `${Q}-m`, { n: 1 }, { restaurantId: a!.id, ...at(1) });
    await insertJob(sql, `${Q}-m`, { n: 2 }, { restaurantId: a!.id, ...at(2) });
    await insertJob(sql, `${Q}-m`, { n: 3 }, { restaurantId: b!.id, ...at(3) });
    await insertJob(sql, `${Q}-o`, { n: 4 }, { restaurantId: a!.id });

    const first = await claimAnySerial<{ n: number }>(sql, [`${Q}-m`], 'r1', STALL);
    expect(first?.payload.n).toBe(1);
    // Tenant a's second match job waits; tenant b's runs.
    const second = await claimAnySerial<{ n: number }>(sql, [`${Q}-m`], 'r2', STALL);
    expect(second?.payload.n).toBe(3);
    expect(await claimAnySerial(sql, [`${Q}-m`], 'r3', STALL)).toBeNull();
    // Another queue of tenant a is not blocked.
    expect((await claimAnySerial<{ n: number }>(sql, [`${Q}-o`], 'r3', STALL))?.payload.n).toBe(4);
    // Done → the next one of tenant a is claimable.
    await completeJob(sql, first!.id, 'r1');
    expect((await claimAnySerial<{ n: number }>(sql, [`${Q}-m`], 'r4', STALL))?.payload.n).toBe(2);
  });

  it('an active job with a stale lock (dead runner) does not block its group', async () => {
    await insertJob(sql, `${Q}-s`, { n: 1 }, at(1));
    await insertJob(sql, `${Q}-s`, { n: 2 }, at(2));
    const dead = await claimAnySerial(sql, [`${Q}-s`], 'dead', STALL);
    expect(await claimAnySerial(sql, [`${Q}-s`], 'live', STALL)).toBeNull();
    await sql`UPDATE job_queue SET locked_at = now() - interval '10 minutes' WHERE id = ${dead!.id}`;
    expect((await claimAnySerial<{ n: number }>(sql, [`${Q}-s`], 'live', STALL))?.payload.n).toBe(2);
  });

  it('parallel claimers: every job exactly once, never two of one group at a time', async () => {
    const [a] = await sql<Array<{ id: string }>>`INSERT INTO restaurants (name) VALUES ('kick test') RETURNING id`;
    const [b] = await sql<Array<{ id: string }>>`INSERT INTO restaurants (name) VALUES ('kick test') RETURNING id`;
    for (let i = 0; i < 20; i++) await insertJob(sql, `${Q}-p`, { n: i }, { restaurantId: i % 2 ? a!.id : b!.id });
    const ran: number[] = [];
    const running = new Map<string, number>();
    let overlap = 0;
    const runner = async (id: string) => {
      for (;;) {
        const job = await claimAnySerial<{ n: number }>(sql, [`${Q}-p`], id, STALL);
        if (!job) {
          // Empty for us — maybe only because the other group is busy: done when nothing is queued.
          const [left] = await sql<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM job_queue WHERE queue = ${`${Q}-p`} AND status IN ('queued', 'active')`;
          if (left!.n === 0) return;
          await new Promise((r) => setTimeout(r, 5));
          continue;
        }
        const g = job.restaurantId!;
        running.set(g, (running.get(g) ?? 0) + 1);
        if (running.get(g)! > 1) overlap += 1;
        await new Promise((r) => setTimeout(r, 3));
        running.set(g, running.get(g)! - 1);
        ran.push(job.payload.n);
        await completeJob(sql, job.id, id);
      }
    };
    await Promise.all(['r1', 'r2', 'r3', 'r4'].map(runner));
    expect(ran.sort((x, y) => x - y)).toEqual([...Array(20).keys()]);
    expect(overlap).toBe(0);
  });
});
