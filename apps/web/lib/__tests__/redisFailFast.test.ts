import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * QA D1: with a Redis that accepts TCP but never answers (or is black-holed),
 * login (rate limiter) and every dashboard render (worker banner) used to wait
 * 30-60 s or forever. Both must now give up within their deadline.
 */
let silent: Server;
let port = 0;

beforeAll(async () => {
  silent = createServer(() => {
    /* accept and never reply */
  });
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
  port = (silent.address() as { port: number }).port;
});
afterAll(() => {
  silent.close();
});

async function freshModules(url: string) {
  vi.resetModules();
  process.env.REDIS_URL = url;
  const rl = await import('../rateLimit');
  const rd = await import('../redis');
  return { rl, rd };
}

describe('request-path Redis fails fast', () => {
  const saved = process.env.REDIS_URL;
  afterAll(() => {
    if (saved === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved;
  });

  it('rate limiter fails OPEN within its deadline on a silent Redis', async () => {
    const { rl } = await freshModules(`redis://127.0.0.1:${port}`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t0 = Date.now();
    const res = await rl.enforceRateLimit('qa@example.test', rl.MAGIC_LINK_LIMIT);
    expect(res.allowed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(rl.RATE_LIMIT_REDIS_DEADLINE_MS + 1_500);
  }, 15_000);

  it('heartbeat read rejects within its deadline on a silent Redis', async () => {
    const { rd } = await freshModules(`redis://127.0.0.1:${port}`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const redis = rd.getRedis()!;
    const t0 = Date.now();
    await expect(rd.redisGetWithDeadline(redis, "k")).rejects.toThrow(/timed out|Stream|writeable|offline/i);
    expect(Date.now() - t0).toBeLessThan(rd.REDIS_READ_DEADLINE_MS + 1_500);
    redis.disconnect();
  }, 15_000);

  it('a wrong-scheme REDIS_URL disables the web client instead of hanging', async () => {
    const { rd } = await freshModules('https://eu1-example.upstash.io');
    expect(rd.getRedis()).toBeNull();
  });
});
