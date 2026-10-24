import { createServer, type Server } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeQueueSql,
  enqueueOcrInvoice,
  isQueueUnavailableError,
  QUEUE_UNAVAILABLE,
  QueueUnavailableError,
  withDeadline,
  enqueue,
} from '../index';

/**
 * EN-7 / F7 on Postgres: an enqueue inside a web request must fail FAST with a
 * coded error when the queue database is unreachable — never hang the request.
 */
const PAYLOAD = { restaurantId: '00000000-0000-4000-8000-000000000001', invoiceId: 'i', supplierId: null, imageUrl: 'x' };

let silent: Server;
let silentPort = 0;
const saved = { q: process.env.QUEUE_DATABASE_URL, d: process.env.DATABASE_URL };

beforeAll(async () => {
  silent = createServer(() => {
    /* accept and never answer: a black-holed database */
  });
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
  silentPort = (silent.address() as { port: number }).port;
});
afterEach(async () => {
  await closeQueueSql();
  if (saved.q === undefined) delete process.env.QUEUE_DATABASE_URL;
  else process.env.QUEUE_DATABASE_URL = saved.q;
  if (saved.d === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.d;
});
afterAll(() => {
  silent.close();
});

describe('enqueue fails fast (EN-7)', () => {
  it('rejects with a coded QueueUnavailableError when the database never answers', async () => {
    process.env.QUEUE_DATABASE_URL = `postgres://u:p@127.0.0.1:${silentPort}/db`;
    const t0 = Date.now();
    const err = await enqueue('ocr-invoice', PAYLOAD, {}, 200).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(err).toBeInstanceOf(QueueUnavailableError);
    expect((err as QueueUnavailableError).code).toBe(QUEUE_UNAVAILABLE);
    expect(isQueueUnavailableError(err)).toBe(true);
  });

  it('wraps a refused connection into the same coded error', async () => {
    process.env.QUEUE_DATABASE_URL = 'postgres://u:p@127.0.0.1:1/db';
    await expect(enqueueOcrInvoice(PAYLOAD)).rejects.toMatchObject({ code: QUEUE_UNAVAILABLE, queue: 'ocr-invoice' });
  });

  it('returns false (no-op) when no queue database is configured', async () => {
    delete process.env.QUEUE_DATABASE_URL;
    delete process.env.DATABASE_URL;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(enqueueOcrInvoice(PAYLOAD)).resolves.toBe(false);
  });
});

describe('withDeadline', () => {
  it('rejects with the given error after the deadline and resolves otherwise', async () => {
    await expect(withDeadline(new Promise(() => {}), 20, () => new Error('late'))).rejects.toThrow('late');
    await expect(withDeadline(Promise.resolve(7), 1_000, () => new Error('late'))).resolves.toBe(7);
  });
});
