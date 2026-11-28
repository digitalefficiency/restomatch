import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Database } from '@restomatch/db';
import {
  gateClient,
  isTenantGuardVerdict,
  memoizeGuard,
  TENANT_GUARD_DEADLINE_MS,
  tenantGuard,
  tenantGuardRequired,
  TenantGuardPendingError,
  TenantGuardVerdict,
  warmUpTenantGuard,
} from '../tenantGuard';

/**
 * The tenant guard moved out of the boot hook (a rejected register() 500s every
 * request on the instance). These pin its memo — only a pass or a verdict is
 * remembered, every other failure is retried by the next caller, and no caller
 * waits past the deadline — the boot warm-up's reporting, and the gate that
 * keeps the tenant pool closed until the guard passed.
 * lib/__tests__/tenantDbGate.test.ts proves the same against a real database,
 * through lib/db and the boot hook.
 */
const withCode = (message: string, code: string, extra: object = {}) =>
  Object.assign(new Error(message), { code }, extra);
const transient = () => withCode('write CONNECT_TIMEOUT pooler:6543', 'CONNECT_TIMEOUT');
const verdict = () =>
  new TenantGuardVerdict(
    new Error('[env] tenant-boundary guard FAILED: the web DB connection runs as "postgres" which BYPASSES RLS.'),
  );

/**
 * Real connection/database failures that bootRetry's retry list does not know.
 * Before, the memo kept every one of them as a verdict: tenant access stayed
 * blocked on the instance until it was recycled.
 */
const unclassified: Array<[string, () => Error]> = [
  ['ENOTFOUND (DNS)', () => withCode('getaddrinfo ENOTFOUND aws-0-ap-northeast-1.pooler.supabase.com', 'ENOTFOUND')],
  ['EHOSTUNREACH', () => withCode('connect EHOSTUNREACH 10.0.0.1:6543', 'EHOSTUNREACH')],
  ['ENETUNREACH', () => withCode('connect ENETUNREACH 10.0.0.1:6543', 'ENETUNREACH')],
  ['57014 statement timeout', () => withCode('canceling statement due to statement timeout', '57014')],
  ['53000 insufficient resources', () => withCode('insufficient resources', '53000')],
  ['53200 out of memory', () => withCode('out of memory', '53200')],
  ['Supavisor ECHECKOUTTIMEOUT', () => withCode('(ECHECKOUTTIMEOUT) checkout timeout', 'ECHECKOUTTIMEOUT')],
  ['Supavisor XX000 checkout timeout', () => withCode('(ECHECKOUTTIMEOUT) checkout timeout', 'XX000', { severity: 'FATAL' })],
  ['28P01 password authentication failed', () => withCode('password authentication failed for user "restomatch_app"', '28P01')],
  ['42501 permission denied', () => withCode('permission denied for table pg_roles', '42501')],
  ['an error with no code', () => new Error('something nobody classified')],
  // The memo goes by the brand only; turning an env.ts message into a verdict is tenantGuard's job.
  ['an unbranded Error with a verdict message', () => new Error('[env] tenant-boundary guard FAILED: not wrapped')],
];

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

describe('memoizeGuard — remembers a pass and a verdict, nothing else', () => {
  it('caches a pass: the check runs once', async () => {
    const check = vi.fn(async () => {});
    const ensure = memoizeGuard(check);
    await ensure();
    await ensure();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('caches a verdict: every later caller gets it and the check never runs again', async () => {
    const err = verdict();
    const check = vi.fn<() => Promise<void>>().mockRejectedValueOnce(err).mockResolvedValue(undefined);
    const ensure = memoizeGuard(check);
    for (let i = 0; i < 3; i++) await expect(ensure()).rejects.toBe(err);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => unknown]>([
    ['CONNECT_TIMEOUT (on the retry list)', transient],
    ...unclassified,
    ['a thrown non-Error', () => 'not an error'],
  ])('does not cache %s: the next caller runs the check again', async (_label, make) => {
    const err = make();
    const check = vi.fn<() => Promise<void>>().mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);
    const ensure = memoizeGuard(check);
    await expect(ensure()).rejects.toBe(err);
    await expect(ensure()).resolves.toBeUndefined();
    await ensure();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not cache a synchronous throw either', async () => {
    const check = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error('sync');
      })
      .mockResolvedValueOnce(undefined);
    const ensure = memoizeGuard(check);
    await expect(ensure()).rejects.toThrow('sync');
    await expect(ensure()).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
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

describe('memoizeGuard — no caller waits past the deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a caller after deadlineMs; the refusal is not cached and the attempt keeps running', async () => {
    const gate = deferred();
    const check = vi.fn(() => gate.promise);
    const ensure = memoizeGuard(check, { deadlineMs: 30 });
    const started = Date.now();
    const err = await ensure().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantGuardPendingError);
    expect(err).toMatchObject({ code: 'TENANT_GUARD_PENDING', waitedMs: 30 });
    expect(isTenantGuardVerdict(err)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
    // A later caller joins the same attempt (no second check) and gets its pass.
    const later = ensure();
    gate.resolve();
    await expect(later).resolves.toBeUndefined();
    await ensure();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('a failure that lands after the deadline is not cached: the next caller runs the check again', async () => {
    const gate = deferred();
    const check = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce(undefined);
    const ensure = memoizeGuard(check, { deadlineMs: 20 });
    await expect(ensure()).rejects.toBeInstanceOf(TenantGuardPendingError);
    gate.reject(withCode('getaddrinfo ENOTFOUND pooler', 'ENOTFOUND'));
    await tick();
    await expect(ensure()).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('a verdict that lands after the deadline is cached', async () => {
    const gate = deferred();
    const check = vi.fn(() => gate.promise);
    const ensure = memoizeGuard(check, { deadlineMs: 20 });
    await expect(ensure()).rejects.toBeInstanceOf(TenantGuardPendingError);
    const err = verdict();
    gate.reject(err);
    await tick();
    await expect(ensure()).rejects.toBe(err);
    await expect(ensure()).rejects.toBe(err);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it(`defaults to TENANT_GUARD_DEADLINE_MS (${TENANT_GUARD_DEADLINE_MS} ms)`, async () => {
    vi.useFakeTimers();
    const ensure = memoizeGuard(() => new Promise<void>(() => {}));
    let outcome: unknown = 'pending';
    void ensure().catch((e: unknown) => (outcome = e));
    await vi.advanceTimersByTimeAsync(TENANT_GUARD_DEADLINE_MS - 1);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBeInstanceOf(TenantGuardPendingError);
    expect(TENANT_GUARD_DEADLINE_MS).toBe(10_000);
  });

  it('deadlineMs: null waits for the attempt itself (the boot warm-up)', async () => {
    const gate = deferred();
    const ensure = memoizeGuard(() => gate.promise, { deadlineMs: 10 });
    const warmUp = ensure({ deadlineMs: null });
    await expect(ensure()).rejects.toBeInstanceOf(TenantGuardPendingError);
    gate.resolve();
    await expect(warmUp).resolves.toBeUndefined();
  });

  it('a settled guard answers without arming a timer', async () => {
    vi.useFakeTimers();
    const passed = memoizeGuard(async () => {});
    await passed();
    const err = verdict();
    const failed = memoizeGuard(() => Promise.reject(err));
    await expect(failed()).rejects.toBe(err);
    const before = vi.getTimerCount();
    await passed();
    await expect(failed()).rejects.toBe(err);
    expect(vi.getTimerCount()).toBe(before);
  });

  it('abandons an attempt still running after attemptTtlMs; its late outcome is ignored; a pass never expires', async () => {
    let t = 0;
    const hung = deferred();
    const check = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => hung.promise)
      .mockResolvedValueOnce(undefined);
    const ensure = memoizeGuard(check, { deadlineMs: 10, attemptTtlMs: 1_000, now: () => t });
    await expect(ensure()).rejects.toBeInstanceOf(TenantGuardPendingError);
    t = 999;
    await expect(ensure()).rejects.toBeInstanceOf(TenantGuardPendingError);
    expect(check).toHaveBeenCalledTimes(1);
    t = 1_000;
    await expect(ensure()).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
    hung.reject(verdict());
    await tick();
    t = 1e9;
    await expect(ensure()).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe('tenantGuard — the lib/env.ts checks on the raw pool', () => {
  /** A raw Database whose execute() answers the guard queries in order. */
  function rawDb(...answers: Array<unknown[] | Error>) {
    const execute = vi.fn(async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? [];
    });
    return { db: { execute } as unknown as Database, execute };
  }
  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  const appRole = [{ current_user: 'restomatch_app', rolbypassrls: false }];

  it('runs the role check, then the RLS check, once', async () => {
    const { db, execute } = rawDb(appRole, []);
    const ensure = tenantGuard(db, prod);
    await ensure();
    await ensure();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('a role that bypasses RLS is a verdict: cached; the RLS check never runs', async () => {
    const { db, execute } = rawDb([{ current_user: 'postgres', rolbypassrls: true }]);
    const ensure = tenantGuard(db, prod);
    const err = await ensure().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantGuardVerdict);
    expect(isTenantGuardVerdict(err)).toBe(true);
    // The real env.ts message, unchanged, with the env.ts error as its cause.
    expect((err as Error).message).toMatch(/^\[env\] tenant-boundary guard FAILED: .*"postgres" which BYPASSES RLS/);
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect((err as Error).cause).not.toBeInstanceOf(TenantGuardVerdict);
    await expect(ensure()).rejects.toBe(err);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('a tenant table without RLS is a verdict: cached', async () => {
    const { db, execute } = rawDb(appRole, [{ table_name: 'invoices' }]);
    const ensure = tenantGuard(db, prod);
    const err = await ensure().catch((e: unknown) => e);
    expect(isTenantGuardVerdict(err)).toBe(true);
    expect((err as Error).message).toMatch(/^\[env\] RLS provisioning INCOMPLETE: .*invoices/);
    await expect(ensure()).rejects.toBe(err);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each(unclassified.filter(([label]) => !label.startsWith('an unbranded')))(
    '%s from the role check is not a verdict: not cached, the next caller runs both checks again',
    async (_label, make) => {
      const err = make();
      const { db, execute } = rawDb(err, appRole, []);
      const ensure = tenantGuard(db, prod);
      const first = await ensure().catch((e: unknown) => e);
      expect(first).toBe(err);
      expect(isTenantGuardVerdict(first)).toBe(false);
      await expect(ensure()).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledTimes(3);
    },
  );

  it('the same for a failure of the RLS check (a Supavisor XX000 checkout timeout)', async () => {
    const err = withCode('(ECHECKOUTTIMEOUT) checkout timeout', 'XX000');
    const { db, execute } = rawDb(appRole, err, appRole, []);
    const ensure = tenantGuard(db, prod);
    await expect(ensure()).rejects.toBe(err);
    await expect(ensure()).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(4);
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

describe('warmUpTenantGuard — the boot hook reports, and never rejects', () => {
  let warn: MockInstance<typeof console.warn>;
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for the attempt itself (no tenant-query deadline); a pass reports nothing', async () => {
    const ensure = vi.fn(async () => {});
    const capture = vi.fn();
    await expect(warmUpTenantGuard(ensure, capture)).resolves.toBeUndefined();
    expect(ensure).toHaveBeenCalledWith({ deadlineMs: null });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('a verdict: console.error and captureException(verdict: true), no warning', async () => {
    const err = verdict();
    const capture = vi.fn();
    await expect(warmUpTenantGuard(() => Promise.reject(err), capture)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toMatch(
      /^\[boot\] tenant guard FAILED — tenant DB access is blocked on this instance: .*BYPASSES RLS/,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(err, { stage: 'tenant-guard-warmup', verdict: true });
  });

  it.each<[string, () => unknown]>([
    ['CONNECT_TIMEOUT', transient],
    ['ENOTFOUND', () => withCode('getaddrinfo ENOTFOUND pooler', 'ENOTFOUND')],
    ['a guard still pending', () => new TenantGuardPendingError(10)],
  ])('%s (not checked yet): console.warn and captureException(verdict: false), no console.error', async (_l, make) => {
    const err = make();
    const capture = vi.fn();
    await expect(warmUpTenantGuard(() => Promise.reject(err), capture)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[boot\] tenant guard not checked yet \(.+\); .*runs it again$/);
    expect(error).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(err, { stage: 'tenant-guard-warmup', verdict: false });
  });

  it('never rejects and leaves no unhandled rejection, even when logging and captureException throw', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const broken = () => {
        throw new Error('console is broken');
      };
      error.mockImplementation(broken);
      warn.mockImplementation(broken);
      const capture = vi.fn(() => {
        throw new Error('sentry is broken');
      });
      // An Error whose message getter throws, too.
      const hostile = Object.create(Error.prototype, {
        message: {
          get() {
            throw new Error('hostile message');
          },
        },
      }) as Error;
      const outcomes = await Promise.allSettled([
        warmUpTenantGuard(() => Promise.reject(verdict()), capture),
        warmUpTenantGuard(() => Promise.reject(transient()), capture),
        warmUpTenantGuard(() => Promise.reject(hostile), capture),
        warmUpTenantGuard(() => {
          throw transient(); // a synchronous throw from ensure()
        }, capture),
      ]);
      expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
      // captureException still ran when the console threw.
      expect(capture).toHaveBeenCalledTimes(4);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
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
