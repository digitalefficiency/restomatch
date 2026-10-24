import { createServer, type Server } from 'node:net';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isTransientDbError, retryTransientDb } from '../bootRetry';

/**
 * A dropped DB connection at boot used to reject the instrumentation hook, and
 * Next then answered 500 on every request to that instance. Connection errors
 * are retried; guard verdicts still fail on the first attempt.
 */
const quiet = { attempts: 3, baseDelayMs: 1 };

describe('isTransientDbError', () => {
  it('matches postgres.js connection codes, socket errnos and SQLSTATE class 08', () => {
    for (const code of [
      'CONNECT_TIMEOUT',
      'CONNECTION_CLOSED',
      'ECONNRESET',
      '08006',
      '57P01',
      '53300',
    ]) {
      expect(isTransientDbError(Object.assign(new Error('x'), { code }))).toBe(true);
    }
  });

  it('follows the cause chain (drizzle wraps driver errors)', () => {
    const driver = Object.assign(new Error('write CONNECT_TIMEOUT db:6543'), {
      code: 'CONNECT_TIMEOUT',
    });
    expect(isTransientDbError(new Error('Failed query: select 1', { cause: driver }))).toBe(true);
  });

  it('does not match guard verdicts, SQL errors or non-errors', () => {
    expect(isTransientDbError(new Error('[env] tenant-boundary guard FAILED'))).toBe(false);
    expect(isTransientDbError(Object.assign(new Error('x'), { code: '42P01' }))).toBe(false);
    expect(isTransientDbError(Object.assign(new Error('x'), { code: '28P01' }))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError('CONNECT_TIMEOUT')).toBe(false);
  });

  it('terminates on a self-referencing cause', () => {
    const e = new Error('loop') as Error & { cause?: unknown };
    e.cause = e;
    expect(isTransientDbError(e)).toBe(false);
  });
});

describe('retryTransientDb', () => {
  it('retries a transient failure and returns the eventual result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('write CONNECT_TIMEOUT'), { code: 'CONNECT_TIMEOUT' }),
      )
      .mockResolvedValueOnce('ok');
    await expect(retryTransientDb('t', fn, quiet)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails a guard verdict on the first attempt (fail closed)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('[env] tenant-boundary guard FAILED: bypasses RLS');
    });
    await expect(retryTransientDb('t', fn, quiet)).rejects.toThrow('guard FAILED');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt with the original error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = Object.assign(new Error('write CONNECTION_CLOSED'), { code: 'CONNECTION_CLOSED' });
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(retryTransientDb('t', fn, quiet)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('real driver error from a server that stalls the handshake', () => {
  let srv: Server;
  let port = 0;
  beforeAll(async () => {
    srv = createServer(() => {
      /* accept and never answer: the frozen-handshake case */
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    port = (srv.address() as { port: number }).port;
  });
  afterAll(() => {
    srv.close();
  });

  it('is classified as transient', async () => {
    const sql = postgres(`postgres://u:p@127.0.0.1:${port}/db`, { max: 1, connect_timeout: 1 });
    const err = await sql`select 1`.catch((e: unknown) => e);
    await sql.end({ timeout: 0 });
    expect(isTransientDbError(err)).toBe(true);
  });
});
