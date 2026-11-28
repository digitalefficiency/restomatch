import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@restomatch/db';
import { gateClient, memoizeGuard, tenantGuard, tenantGuardRequired } from '../tenantGuard';

/**
 * The tenant guard moved out of the boot hook (a rejected register() 500s every
 * request on the instance). These pin its memo — a dropped connection is
 * retried by the next caller, a verdict is final — and the gate that keeps the
 * tenant pool closed until the guard passed. lib/__tests__/tenantDbGate.test.ts
 * proves the same against a real database, through lib/db and the boot hook.
 */
const transient = () => Object.assign(new Error('write CONNECT_TIMEOUT pooler:6543'), { code: 'CONNECT_TIMEOUT' });
const verdict = () => new Error('[env] tenant-boundary guard FAILED: the web DB connection runs as "postgres" which BYPASSES RLS.');

/** A promise the test resolves or rejects by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('memoizeGuard', () => {
  it('caches a pass: the check runs once', async () => {
    const check = vi.fn(async () => {});
    const ensure = memoizeGuard(check);
    await ensure();
    await ensure();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not cache a transient failure: the next caller runs the check again', async () => {
    const check = vi.fn<() => Promise<void>>().mockRejectedValueOnce(transient()).mockResolvedValueOnce(undefined);
    const ensure = memoizeGuard(check);
    await expect(ensure()).rejects.toMatchObject({ code: 'CONNECT_TIMEOUT' });
    await expect(ensure()).resolves.toBeUndefined();
    await ensure();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('caches a verdict: every later caller gets it and the check never runs again', async () => {
    const err = verdict();
    const check = vi.fn<() => Promise<void>>().mockRejectedValueOnce(err).mockResolvedValue(undefined);
    const ensure = memoizeGuard(check);
    for (let i = 0; i < 3; i++) await expect(ensure()).rejects.toBe(err);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('treats an unclassified error (and a synchronous throw) as a verdict — fail closed', async () => {
    const auth = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const ensureAuth = memoizeGuard(vi.fn(async () => Promise.reject(auth)));
    await expect(ensureAuth()).rejects.toBe(auth);
    await expect(ensureAuth()).rejects.toBe(auth);

    const sync = vi.fn((): Promise<void> => {
      throw verdict();
    });
    const ensureSync = memoizeGuard(sync);
    await expect(ensureSync()).rejects.toThrow('guard FAILED');
    await expect(ensureSync()).rejects.toThrow('guard FAILED');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight check between concurrent callers', async () => {
    const gate = deferred();
    const check = vi.fn(() => gate.promise);
    const ensure = memoizeGuard(check);
    const waiting = [ensure(), ensure(), ensure()];
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all(waiting);
  });
});

describe('tenantGuard — the lib/env.ts checks on the raw pool', () => {
  /** A raw Database whose execute() answers the two guard queries in order. */
  function rawDb(...answers: Array<unknown[] | Error>) {
    const execute = vi.fn(async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? [];
    });
    return { db: { execute } as unknown as Database, execute };
  }
  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

  it('runs the role check, then the RLS check, once', async () => {
    const { db, execute } = rawDb([{ current_user: 'restomatch_app', rolbypassrls: false }], []);
    const ensure = tenantGuard(db, prod);
    await ensure();
    await ensure();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('caches a role that bypasses RLS; the RLS check never runs', async () => {
    const { db, execute } = rawDb([{ current_user: 'postgres', rolbypassrls: true }]);
    const ensure = tenantGuard(db, prod);
    await expect(ensure()).rejects.toThrow(/BYPASSES RLS/);
    await expect(ensure()).rejects.toThrow(/BYPASSES RLS/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('caches a tenant table without RLS', async () => {
    const { db, execute } = rawDb([{ current_user: 'restomatch_app', rolbypassrls: false }], [{ table_name: 'invoices' }]);
    const ensure = tenantGuard(db, prod);
    await expect(ensure()).rejects.toThrow(/RLS provisioning INCOMPLETE: .*invoices/);
    await expect(ensure()).rejects.toThrow(/RLS provisioning INCOMPLETE/);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not run for the explicit owner fallback (dev/test without DATABASE_URL_APP)', async () => {
    const { db, execute } = rawDb();
    await tenantGuard(db, { NODE_ENV: 'test' } as NodeJS.ProcessEnv)();
    expect(execute).not.toHaveBeenCalled();
  });

  it('applies exactly where the boot hook ran it: production, or DATABASE_URL_APP set', () => {
    expect(tenantGuardRequired({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(tenantGuardRequired({ NODE_ENV: 'development', DATABASE_URL_APP: 'postgres://a@h/d' } as NodeJS.ProcessEnv)).toBe(true);
    expect(tenantGuardRequired({ NODE_ENV: 'development', ALLOW_OWNER_DB: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(tenantGuardRequired({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('gateClient — the tenant pool stays closed until the guard passed', () => {
  /** A stand-in postgres.js client that records what reaches "the database". */
  function fakeClient() {
    const sent: string[] = [];
    const query = (text: string) => {
      let arrays = false;
      const pending = {
        values() {
          arrays = true;
          return pending;
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
          sent.push(arrays ? `${text} [values]` : text);
          return Promise.resolve(arrays ? [['row']] : [{ v: 'row' }]).then(onFulfilled, onRejected);
        },
      };
      return pending;
    };
    const client = Object.assign(
      () => {
        sent.push('tagged template');
      },
      {
        unsafe: vi.fn((text: string) => query(text)),
        begin: vi.fn(async (fn: (tx: string) => unknown) => {
          sent.push('begin');
          return fn('tx');
        }),
        end: vi.fn(async () => {}),
        options: { max: 10 },
        reserve: vi.fn(),
        file: vi.fn(),
        listen: vi.fn(),
        notify: vi.fn(),
        subscribe: vi.fn(),
        largeObject: vi.fn(),
      },
    );
    return { client: client as unknown as Sql, raw: client, sent };
  }

  it('holds a query (and .values()) until ready() resolves, then sends it once', async () => {
    const { client, raw, sent } = fakeClient();
    const gate = deferred();
    const gated = gateClient(client, () => gate.promise);
    const rows = gated.unsafe('select 1', []);
    const arrays = gated.unsafe('select 2', []).values();
    const results = Promise.all([rows, arrays]);
    await tick();
    expect(raw.unsafe).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    gate.resolve();
    expect(await results).toEqual([[{ v: 'row' }], [['row']]]);
    expect(sent).toEqual(['select 1', 'select 2 [values]']);
  });

  it('holds a transaction until ready() resolves', async () => {
    const { client, sent } = fakeClient();
    const gate = deferred();
    const gated = gateClient(client, () => gate.promise);
    const tx = gated.begin(async (t) => `ran in ${String(t)}`);
    await tick();
    expect(sent).toEqual([]);
    gate.resolve();
    await expect(tx).resolves.toBe('ran in tx');
    expect(sent).toEqual(['begin']);
  });

  it('never sends a query or opens a transaction after a verdict', async () => {
    const { client, raw, sent } = fakeClient();
    const err = verdict();
    const gated = gateClient(client, () => Promise.reject(err));
    await expect(gated.unsafe('select 1', [])).rejects.toBe(err);
    await expect(gated.unsafe('select 1', []).values()).rejects.toBe(err);
    await expect(gated.begin(async () => 'x')).rejects.toBe(err);
    expect(raw.unsafe).not.toHaveBeenCalled();
    expect(raw.begin).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('refuses every other way to send SQL on the root client', () => {
    const { client, raw, sent } = fakeClient();
    const gated = gateClient(client, async () => {}) as unknown as Record<string, () => unknown> & (() => unknown);
    expect(() => gated()).toThrow(/bypass the tenant guard/);
    for (const name of ['reserve', 'file', 'listen', 'notify', 'subscribe', 'largeObject']) {
      expect(() => gated[name]!(), name).toThrow(/bypass the tenant guard/);
      expect(raw[name as 'reserve']).not.toHaveBeenCalled();
    }
    expect(sent).toEqual([]);
  });

  it('passes pool state and shutdown through', async () => {
    const { client, raw } = fakeClient();
    const gated = gateClient(client, () => new Promise(() => {}));
    expect(gated.options).toBe(raw.options);
    await gated.end({ timeout: 0 });
    expect(raw.end).toHaveBeenCalledTimes(1);
  });
});
