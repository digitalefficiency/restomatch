import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addWithDeadline,
  isQueueUnavailableError,
  QUEUE_UNAVAILABLE,
  QueueUnavailableError,
  redisUrlProblem,
} from '../index';

const PAYLOAD = { restaurantId: 'r', invoiceId: 'i', supplierId: null, imageUrl: 'x' };

describe('redisUrlProblem', () => {
  it('accepts redis:// and rediss:// and unset', () => {
    expect(redisUrlProblem(undefined)).toBeNull();
    expect(redisUrlProblem('redis://localhost:6379')).toBeNull();
    expect(redisUrlProblem('rediss://default:pw@eu1-x.upstash.io:6379')).toBeNull();
  });

  it('flags the Upstash REST URL and other schemes', () => {
    expect(redisUrlProblem('https://eu1-x.upstash.io')).toMatch(/Upstash REST URL/);
    expect(redisUrlProblem('postgres://localhost:5432/db')).toMatch(/redis:\/\/ or rediss:\/\//);
    expect(redisUrlProblem('not a url')).toMatch(/not a valid URL/);
  });
});

describe('addWithDeadline', () => {
  it('rejects with a coded QueueUnavailableError when Redis never answers', async () => {
    const hang = { name: 'ocr-invoice', add: () => new Promise<never>(() => {}) };
    const t0 = Date.now();
    const err = await addWithDeadline(hang, 'ocr-invoice', PAYLOAD, 50).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(err).toBeInstanceOf(QueueUnavailableError);
    expect((err as QueueUnavailableError).code).toBe(QUEUE_UNAVAILABLE);
    expect(isQueueUnavailableError(err)).toBe(true);
  });

  it('wraps a rejected add() into the same coded error', async () => {
    const broken = { name: 'match-invoice', add: () => Promise.reject(new Error('Stream isn\'t writeable')) };
    await expect(addWithDeadline(broken, 'match-invoice', PAYLOAD, 1_000)).rejects.toMatchObject({
      code: QUEUE_UNAVAILABLE,
      queue: 'match-invoice',
    });
  });

  it('resolves when add() succeeds', async () => {
    const ok = { name: 'q', add: vi.fn().mockResolvedValue({ id: '1' }) };
    await expect(addWithDeadline(ok, 'q', PAYLOAD)).resolves.toBeUndefined();
    expect(ok.add).toHaveBeenCalledWith('q', PAYLOAD);
  });
});

describe('enqueue* with a bad REDIS_URL (real ioredis, no Redis needed)', () => {
  const original = process.env.REDIS_URL;
  afterEach(() => {
    process.env.REDIS_URL = original;
    vi.resetModules();
  });

  async function freshQueueModule(url: string) {
    process.env.REDIS_URL = url;
    vi.resetModules();
    return import('../index');
  }

  it('fails immediately on an Upstash REST URL instead of hanging', async () => {
    const q = await freshQueueModule('https://eu1-example.upstash.io');
    const t0 = Date.now();
    await expect(q.enqueueOcrInvoice(PAYLOAD)).rejects.toMatchObject({ code: QUEUE_UNAVAILABLE });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('fails within the deadline when Redis refuses connections', async () => {
    const q = await freshQueueModule('redis://127.0.0.1:1');
    const t0 = Date.now();
    await expect(q.enqueueMatchInvoice({ restaurantId: 'r', invoiceId: 'i' })).rejects.toMatchObject({
      code: QUEUE_UNAVAILABLE,
    });
    expect(Date.now() - t0).toBeLessThan(q.ENQUEUE_TIMEOUT_MS + 1_000);
  });

  it('fails within the deadline when the host black-holes packets', async () => {
    // TEST-NET-1 (RFC 5737): never routed, so TCP connect just hangs.
    const q = await freshQueueModule('redis://192.0.2.1:6379');
    const t0 = Date.now();
    await expect(
      q.enqueueCatalogImport({
        restaurantId: 'r',
        supplierId: 's',
        importId: 'imp',
        file: { filename: 'a.csv', text: 'a' },
        mapping: {},
      }),
    ).rejects.toMatchObject({ code: QUEUE_UNAVAILABLE });
    expect(Date.now() - t0).toBeLessThan(q.ENQUEUE_TIMEOUT_MS + 1_000);
  }, 10_000);
});
