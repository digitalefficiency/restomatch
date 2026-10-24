import { afterAll, describe, expect, it, vi } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql, type Sql } from '@restomatch/queue';
import { buildHeartbeat, startHeartbeat, writeHeartbeat } from '../heartbeat';

describe('worker heartbeat (timers)', () => {
  it('beats immediately, then on the interval, and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      const sql = vi.fn().mockResolvedValue([]) as unknown as Sql;
      const stop = startHeartbeat(sql, 'w', 3, 1_000);
      expect(sql).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_500);
      expect(sql).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sql).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a failing write (logs, does not throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sql = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as Sql;
      const stop = startHeartbeat(sql, 'w', 1, 60_000);
      await Promise.resolve();
      await Promise.resolve();
      stop();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('worker heartbeat (Postgres round trip)', () => {
  const sql = queueSql(testDbUrl());
  afterAll(async () => {
    await sql`DELETE FROM worker_heartbeats WHERE worker_id LIKE 'test-hb-%'`;
  });

  it('upserts one row per worker id and keeps the latest beat', async () => {
    const id = `test-hb-${process.pid}`;
    const started = new Date('2026-10-24T06:00:00Z');
    await writeHeartbeat(sql, id, buildHeartbeat(13, started, new Date('2026-10-24T06:01:00Z')));
    await writeHeartbeat(sql, id, buildHeartbeat(13, started, new Date('2026-10-24T06:02:00Z')));
    const rows = await sql<Array<{ workers: number; beat_at: Date; started_at: Date }>>`
      SELECT workers, beat_at, started_at FROM worker_heartbeats WHERE worker_id = ${id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workers).toBe(13);
    expect(rows[0]!.beat_at.toISOString()).toBe('2026-10-24T06:02:00.000Z');
    expect(rows[0]!.started_at.toISOString()).toBe('2026-10-24T06:00:00.000Z');
  });
});
