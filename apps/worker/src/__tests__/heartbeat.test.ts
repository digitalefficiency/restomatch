import IORedis from 'ioredis';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  buildHeartbeat,
  HEARTBEAT_KEY,
  HEARTBEAT_TTL_SEC,
  startHeartbeat,
  writeHeartbeat,
} from '../heartbeat';

describe('worker heartbeat (pure)', () => {
  it('writes a JSON document with an EX ttl under the well-known key', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const doc = buildHeartbeat(11, new Date('2026-09-08T08:00:00Z'), new Date('2026-09-08T08:01:00Z'));
    await writeHeartbeat({ set } as unknown as IORedis, doc);
    expect(set).toHaveBeenCalledTimes(1);
    const [key, payload, mode, ttl] = set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(HEARTBEAT_KEY);
    expect(mode).toBe('EX');
    expect(ttl).toBe(HEARTBEAT_TTL_SEC);
    const parsed = JSON.parse(payload) as { at: string; workers: number; startedAt: string };
    expect(parsed.at).toBe('2026-09-08T08:01:00.000Z');
    expect(parsed.workers).toBe(11);
    expect(parsed.startedAt).toBe('2026-09-08T08:00:00.000Z');
  });

  it('beats immediately, then on the interval, and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      const set = vi.fn().mockResolvedValue('OK');
      const stop = startHeartbeat({ set } as unknown as IORedis, 3, 1_000);
      expect(set).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_500);
      expect(set).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(set).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a failing Redis write (logs, does not throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const set = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
      const stop = startHeartbeat({ set } as unknown as IORedis, 1, 60_000);
      await Promise.resolve();
      await Promise.resolve();
      stop();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// Real round trip — only where a Redis service exists (CI worker-tests job).
const REDIS_URL = process.env.REDIS_URL;
describe.skipIf(!REDIS_URL)('worker heartbeat (redis round trip)', () => {
  const redis = REDIS_URL ? new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 }) : null;
  afterAll(async () => {
    if (redis) {
      await redis.del(HEARTBEAT_KEY);
      await redis.quit();
    }
  });

  it('is readable back with a TTL', async () => {
    await writeHeartbeat(redis!, buildHeartbeat(2, new Date()));
    const raw = await redis!.get(HEARTBEAT_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).workers).toBe(2);
    const ttl = await redis!.ttl(HEARTBEAT_KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(HEARTBEAT_TTL_SEC);
  });
});
