import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  backoffMs,
  claimJob,
  completeJob,
  enqueue,
  failJob,
  failedJobs,
  insertJob,
  pruneJobs,
  queueCounts,
  recoverStalled,
  renewLocks,
} from '../index';

/** The Postgres queue against a real database (0061 job_queue must be migrated). */
const URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
const sql = postgres(URL, { max: 8, prepare: false, onnotice: () => {} });
const Q = `test-${process.pid}`;

beforeEach(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
});
afterAll(async () => {
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${Q}%`}`;
  await sql.end();
});

describe('job_queue lifecycle', () => {
  it('claims FIFO, one job per claim, then completes', async () => {
    await insertJob(sql, Q, { n: 1 });
    await insertJob(sql, Q, { n: 2 });
    const a = await claimJob<{ n: number }>(sql, Q, 'w1');
    const b = await claimJob<{ n: number }>(sql, Q, 'w2');
    expect(a?.payload.n).toBe(1);
    expect(b?.payload.n).toBe(2);
    expect(a?.attempts).toBe(1);
    expect(await claimJob(sql, Q, 'w3')).toBeNull();
    await completeJob(sql, a!.id, 'w1');
    expect(await queueCounts(sql, Q)).toMatchObject({ active: 1, done: 1, waiting: 0 });
  });

  it('a worker cannot complete a job it does not hold', async () => {
    await insertJob(sql, Q, {});
    const j = await claimJob(sql, Q, 'w1');
    await completeJob(sql, j!.id, 'intruder');
    expect(await queueCounts(sql, Q)).toMatchObject({ active: 1, done: 0 });
  });

  it('dedupe_key admits one job per key (the cron-slot guarantee)', async () => {
    expect(await insertJob(sql, Q, {}, { dedupeKey: 'cron:x:2026-10-24T06:00Z' })).not.toBeNull();
    expect(await insertJob(sql, Q, {}, { dedupeKey: 'cron:x:2026-10-24T06:00Z' })).toBeNull();
    expect(await insertJob(sql, Q, {}, { dedupeKey: 'cron:x:2026-10-24T06:01Z' })).not.toBeNull();
    expect((await queueCounts(sql, Q)).waiting).toBe(2);
  });

  it('retries with backoff while attempts remain, then fails', async () => {
    await insertJob(sql, Q, {}, { maxAttempts: 2 });
    const first = await claimJob(sql, Q, 'w1');
    expect(await failJob(sql, first!, 'boom 1', 'w1')).toBe('retry');
    // Backed off: not claimable yet.
    expect(await claimJob(sql, Q, 'w1')).toBeNull();
    expect((await queueCounts(sql, Q)).delayed).toBe(1);
    await sql`UPDATE job_queue SET run_at = now() WHERE queue = ${Q}`;
    const second = await claimJob(sql, Q, 'w1');
    expect(second?.attempts).toBe(2);
    expect(await failJob(sql, second!, 'boom 2', 'w1')).toBe('failed');
    const failed = await failedJobs(sql, Q);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: Q, failedReason: 'boom 2' });
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(20)).toBe(600_000);
  });

  it('recovers stalled jobs (lost lock) and leaves fresh locks alone', async () => {
    await insertJob(sql, Q, { stale: true }, { maxAttempts: 2 });
    await insertJob(sql, Q, { stale: false });
    const stale = await claimJob(sql, Q, 'dead-worker');
    const fresh = await claimJob(sql, Q, 'live-worker');
    await sql`UPDATE job_queue SET locked_at = now() - interval '10 minutes' WHERE id = ${stale!.id}`;
    await renewLocks(sql, [fresh!.id], 'live-worker');
    expect(await recoverStalled(sql, 2 * 60_000)).toEqual({ requeued: 1, failed: 0 });
    const again = await claimJob<{ stale: boolean }>(sql, Q, 'w2');
    expect(again?.payload.stale).toBe(true);
    // A stall gives the claim's attempt back (BullMQ: stalled ≠ failed attempt).
    expect(again?.attempts).toBe(1);
  });

  it('never recovers the ids a live worker says are its own in-flight jobs', async () => {
    await insertJob(sql, Q, {});
    const mine = await claimJob(sql, Q, 'me');
    await sql`UPDATE job_queue SET locked_at = now() - interval '10 minutes' WHERE id = ${mine!.id}`;
    expect(await recoverStalled(sql, 2 * 60_000, [mine!.id])).toEqual({ requeued: 0, failed: 0 });
    expect(await recoverStalled(sql, 2 * 60_000)).toEqual({ requeued: 1, failed: 0 });
  });

  it('keeps finished cron-slot rows (catch-up history) for 40 days', async () => {
    await insertJob(sql, Q, {}, { dedupeKey: 'cron:x:2026-09-01T07:45' });
    await insertJob(sql, Q, {}, { dedupeKey: 'plain' });
    await sql`UPDATE job_queue SET status = 'done', finished_at = now() - interval '10 days' WHERE queue = ${Q}`;
    expect(await pruneJobs(sql, 7 * 24 * 3600_000)).toBe(1);
    expect((await sql`SELECT dedupe_key FROM job_queue WHERE queue = ${Q}`).map((r) => r.dedupe_key)).toEqual(['cron:x:2026-09-01T07:45']);
    await sql`UPDATE job_queue SET finished_at = now() - interval '41 days' WHERE queue = ${Q}`;
    expect(await pruneJobs(sql, 7 * 24 * 3600_000)).toBe(1);
  });

  it('prunes finished jobs older than the cutoff only', async () => {
    await insertJob(sql, Q, {});
    const j = await claimJob(sql, Q, 'w');
    await completeJob(sql, j!.id, 'w');
    expect(await pruneJobs(sql, 60_000)).toBe(0);
    await sql`UPDATE job_queue SET finished_at = now() - interval '8 days' WHERE id = ${j!.id}`;
    expect(await pruneJobs(sql, 7 * 24 * 3600_000)).toBeGreaterThanOrEqual(1);
  });

  it('enqueue() writes payload + restaurant_id from the payload', async () => {
    const prev = process.env.QUEUE_DATABASE_URL;
    process.env.QUEUE_DATABASE_URL = URL;
    try {
      const [r] = await sql<Array<{ id: string }>>`INSERT INTO restaurants (name) VALUES ('queue test') RETURNING id`;
      expect(await enqueue(`${Q}-e`, { restaurantId: r!.id, invoiceId: 'x' })).toBe(true);
      const [row] = await sql<Array<{ restaurant_id: string; payload: { invoiceId: string } }>>`
        SELECT restaurant_id, payload FROM job_queue WHERE queue = ${`${Q}-e`}`;
      expect(row).toMatchObject({ restaurant_id: r!.id, payload: { invoiceId: 'x' } });
      await sql`DELETE FROM restaurants WHERE id = ${r!.id}`;
    } finally {
      if (prev === undefined) delete process.env.QUEUE_DATABASE_URL;
      else process.env.QUEUE_DATABASE_URL = prev;
    }
  });
});

describe('concurrency: 50 jobs, 2 workers', () => {
  it('every job is processed exactly once', async () => {
    for (let i = 0; i < 50; i++) await insertJob(sql, Q, { n: i });
    const seen: number[] = [];
    // Each "worker" runs 4 concurrent claim loops on its own connections.
    const worker = async (id: string) => {
      const pool = postgres(URL, { max: 4, prepare: false, onnotice: () => {} });
      const loop = async () => {
        for (;;) {
          const j = await claimJob<{ n: number }>(pool, Q, id);
          if (!j) return;
          seen.push(j.payload.n);
          await completeJob(pool, j.id, id);
        }
      };
      await Promise.all([loop(), loop(), loop(), loop()]);
      await pool.end();
    };
    await Promise.all([worker('w-a'), worker('w-b')]);
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
    expect(await queueCounts(sql, Q)).toMatchObject({ done: 50, active: 0, waiting: 0 });
  });
});
