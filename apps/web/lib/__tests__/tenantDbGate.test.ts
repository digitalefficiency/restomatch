import { connect, createServer, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { restaurants, sql } from '@restomatch/db';
import { isTransientDbError } from '../bootRetry';
import { isTenantGuardVerdict } from '../tenantGuard';

/**
 * Production outage (CONNECT_TIMEOUT burst at boot): the boot hook awaited the
 * tenant guard's DB queries, Next cached the rejected register(), and every
 * request on the instance — /, /pricing, /showcase/* — answered 500 until it
 * was recycled. Now the boot hook does no awaited DB I/O and lib/db holds each
 * tenant query until the guard passed.
 *
 * Everything here goes through the real modules (instrumentation.ts →
 * instrumentation.node.ts → lib/db → postgres.js) and a TCP proxy in front of
 * the test database that records the SQL text of every statement the pool
 * sends, so "never reaches the database" is checked on the wire.
 */

// Lets a test hold the guard open and then pass it (the test DB's superuser
// would fail the real check), make the role check fail with a given error
// instead of running, or shorten the tenant-query deadline. Untouched, the real
// lib/env.ts checks and lib/tenantGuard.ts timing run. `capture` stands in for
// @restomatch/observability's captureException (the boot warm-up reports to it).
const control = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  fail: null as Error | null,
  deadlineMs: undefined as number | undefined,
  capture: vi.fn(),
}));
vi.mock('../env', async (importOriginal) => {
  const real = await importOriginal<typeof import('../env')>();
  return {
    ...real,
    assertAppRoleNoBypass: async (db: Parameters<typeof real.assertAppRoleNoBypass>[0]) => {
      if (control.fail) throw control.fail;
      return control.hold ? control.hold : real.assertAppRoleNoBypass(db);
    },
    assertRlsEnabled: async (db: Parameters<typeof real.assertRlsEnabled>[0]) =>
      control.hold ? undefined : real.assertRlsEnabled(db),
  };
});
vi.mock('../tenantGuard', async (importOriginal) => {
  const real = await importOriginal<typeof import('../tenantGuard')>();
  return {
    ...real,
    tenantGuard: (...[raw, env, timing]: Parameters<typeof real.tenantGuard>) =>
      real.tenantGuard(raw, env, control.deadlineMs === undefined ? timing : { ...timing, deadlineMs: control.deadlineMs }),
  };
});
vi.mock('@restomatch/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@restomatch/observability')>()),
  captureException: control.capture,
}));

const TEST_DB = new URL(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Text of a NUL-terminated string at `at`. */
const cstr = (buf: Buffer, at: number) => buf.toString('utf8', at, buf.indexOf(0, at));

/** A backend ErrorResponse ('E') message. */
function errorResponse(fields: Record<string, string>): Buffer {
  const body = Buffer.concat([
    ...Object.entries(fields).map(([type, value]) => Buffer.from(`${type}${value}\0`, 'utf8')),
    Buffer.from([0]),
  ]);
  const head = Buffer.alloc(5);
  head.write('E', 0, 'latin1');
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

/**
 * TCP proxy to the test database. Records the SQL of every Query ('Q') and Parse
 * ('P') message a client sends, and counts connections. Modes for new
 * connections:
 *  - 'drop': reset at once (a pooler that is unreachable: ECONNRESET);
 *  - 'stall': accept and never answer (the frozen-handshake case; postgres.js
 *    gives up only after its 30 s connect_timeout);
 *  - 'pooler-error': answer the startup message the way Supavisor does when it
 *    has no server connection to hand out — FATAL XX000 "(ECHECKOUTTIMEOUT)
 *    checkout timeout" — and close. XX000 is not on bootRetry's retry list.
 */
async function startRecorder() {
  const queries: string[] = [];
  const sockets = new Set<Socket>();
  const stalled = new Set<Socket>();
  const state = { mode: 'forward' as 'forward' | 'drop' | 'stall' | 'pooler-error', connections: 0 };
  const server = createServer((client) => {
    sockets.add(client);
    state.connections++;
    client.on('error', () => {});
    if (state.mode === 'drop') {
      client.resetAndDestroy();
      return;
    }
    if (state.mode === 'stall') {
      stalled.add(client);
      return;
    }
    if (state.mode === 'pooler-error') {
      client.once('data', () =>
        client.end(errorResponse({ S: 'FATAL', V: 'FATAL', C: 'XX000', M: '(ECHECKOUTTIMEOUT) checkout timeout' })),
      );
      return;
    }
    const db = connect(Number(TEST_DB.port || 5432), TEST_DB.hostname);
    sockets.add(db);
    db.on('error', () => {});
    let buf = Buffer.alloc(0);
    let started = false;
    client.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!started) {
          // Startup / SSLRequest: Int32 length (incl. itself) + Int32 code, no type byte.
          if (buf.length < 8 || buf.length < buf.readInt32BE(0)) break;
          const code = buf.readInt32BE(4);
          buf = buf.subarray(buf.readInt32BE(0));
          if (code !== 80877103 && code !== 80877104) started = true;
          continue;
        }
        if (buf.length < 5 || buf.length < 1 + buf.readInt32BE(1)) break;
        const type = String.fromCharCode(buf[0]!);
        const body = buf.subarray(5, 1 + buf.readInt32BE(1));
        if (type === 'Q') queries.push(cstr(body, 0));
        if (type === 'P') queries.push(cstr(body, body.indexOf(0) + 1));
        buf = buf.subarray(1 + buf.readInt32BE(1));
      }
      db.write(chunk);
    });
    db.on('data', (chunk: Buffer) => client.write(chunk));
    client.on('close', () => db.destroy());
    db.on('close', () => client.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = new URL(TEST_DB);
  url.hostname = '127.0.0.1';
  url.port = String((server.address() as { port: number }).port);
  return {
    url: url.toString(),
    queries,
    state,
    sent: (needle: string) => queries.filter((q) => q.toLowerCase().includes(needle.toLowerCase())),
    /** Close the connections held in 'stall' mode. */
    releaseStalled: () => {
      for (const s of stalled) s.destroy();
      stalled.clear();
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

type Pools = Record<string, unknown>;
const memo = globalThis as unknown as Pools;
/** Close and forget the tenant pool lib/db memoized (either module shape). */
async function endTenantPool() {
  for (const key of ['__restomatchTenantDb', '__restomatchWebDb']) {
    const entry = memo[key] as { db?: unknown; $client?: unknown } | undefined;
    const db = (entry && 'db' in entry ? entry.db : entry) as { $client?: { end?: (o: object) => Promise<void> } } | undefined;
    await db?.$client?.end?.({ timeout: 0 }).catch(() => {});
    delete memo[key];
  }
}

async function loadDb() {
  vi.resetModules();
  const mod = await import('../db');
  return mod.db;
}

let rec: Awaited<ReturnType<typeof startRecorder>>;
beforeAll(async () => {
  rec = await startRecorder();
});
afterAll(async () => {
  await rec.close();
});
beforeEach(async () => {
  await endTenantPool();
  rec.queries.length = 0;
  rec.state.mode = 'forward';
  rec.state.connections = 0;
  control.hold = null;
  control.fail = null;
  control.deadlineMs = undefined;
  control.capture.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The tenant pool connects as the test DB's superuser through the recorder.
  vi.stubEnv('DATABASE_URL_APP', rec.url);
});
afterEach(async () => {
  rec.releaseStalled();
  await endTenantPool();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('lib/db — the first tenant query waits for the tenant guard', () => {
  it('a query and a transaction issued before the guard resolves do not reach the DB until it passes', async () => {
    let pass!: () => void;
    control.hold = new Promise<void>((r) => (pass = r));
    const db = await loadDb();

    // One native promise: awaiting a Drizzle query twice would run it twice.
    const results = Promise.all([
      db.execute(sql`select 'tenant-probe' as probe`),
      db.transaction(async (t) => t.execute(sql`select 'tenant-probe-tx' as probe`)),
    ]);
    const early = await Promise.race([results.then(() => 'ran'), sleep(300).then(() => 'waiting')]);
    expect(early).toBe('waiting');
    expect(rec.queries).toEqual([]);

    pass();
    const [rows, txRows] = await results;
    expect([...rows]).toEqual([{ probe: 'tenant-probe' }]);
    expect([...txRows]).toEqual([{ probe: 'tenant-probe-tx' }]);
    expect(rec.sent('tenant-probe')).toHaveLength(2);
    expect(rec.sent('begin')).toHaveLength(1);
  });

  it('after a verdict failure no tenant query ever runs, and the verdict is not re-checked', async () => {
    // Real lib/env.ts checks: the superuser BYPASSES RLS.
    const db = await loadDb();
    // Issued together, before the verdict is known...
    const settled = await Promise.allSettled([
      db.execute(sql`select 'tenant-probe' as probe`),
      db.select({ id: restaurants.id }).from(restaurants).limit(1),
      db.transaction(async (t) => t.execute(sql`select 'tenant-probe-tx' as probe`)),
    ]);
    for (const outcome of settled) {
      expect(outcome.status).toBe('rejected');
      expect(String((outcome as PromiseRejectedResult).reason)).toMatch(/BYPASSES RLS/);
      expect(isTenantGuardVerdict((outcome as PromiseRejectedResult).reason)).toBe(true);
    }
    // ...and after it.
    const later = await db.execute(sql`select 'tenant-probe-later' as probe`).catch((e: unknown) => e);
    expect(isTenantGuardVerdict(later)).toBe(true);
    expect(String(later)).toMatch(/BYPASSES RLS/);

    expect(rec.sent('tenant-probe')).toEqual([]);
    expect(rec.sent('from "restaurants"')).toEqual([]);
    expect(rec.sent('begin')).toEqual([]);
    // The role check ran once; its verdict is cached, not re-checked per query.
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
  });

  it('an unreachable DB is not cached: the next tenant query runs the guard again', async () => {
    rec.state.mode = 'drop';
    const db = await loadDb();
    const first = await db.execute(sql`select 'tenant-probe' as probe`).catch((e: unknown) => e);
    expect(isTransientDbError(first)).toBe(true);
    expect(rec.queries).toEqual([]);

    rec.state.mode = 'forward';
    // The guard runs again — and now reaches the DB, whose (real) verdict blocks the query.
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toThrow(/BYPASSES RLS/);
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
    expect(rec.sent('tenant-probe')).toEqual([]);
  }, 20_000);

  it('a pooler error the retry list does not know (Supavisor XX000 checkout timeout) is not cached: the next tenant query runs the guard again', async () => {
    rec.state.mode = 'pooler-error';
    const db = await loadDb();
    const first = await db.execute(sql`select 'tenant-probe' as probe`).catch((e: unknown) => e);
    expect(first).toMatchObject({ code: 'XX000', message: expect.stringContaining('checkout timeout') });
    // Before: not transient, so it was kept as the verdict and blocked tenant access until a recycle.
    expect(isTransientDbError(first)).toBe(false);
    expect(isTenantGuardVerdict(first)).toBe(false);
    const connectionsAfterFirst = rec.state.connections;
    expect(connectionsAfterFirst).toBeGreaterThan(0);

    // Still failing: the guard runs again (a new connection), it is not answered from a memo.
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toMatchObject({ code: 'XX000' });
    expect(rec.state.connections).toBeGreaterThan(connectionsAfterFirst);
    expect(rec.queries).toEqual([]);

    // The pooler recovers: the guard runs on the wire, and its (real) verdict is what is kept.
    rec.state.mode = 'forward';
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toThrow(/BYPASSES RLS/);
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toThrow(/BYPASSES RLS/);
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
    expect(rec.sent('tenant-probe')).toEqual([]);
  }, 20_000);

  it('an unclassified failure inside the guard (a fake ENOTFOUND) is not cached either', async () => {
    control.fail = Object.assign(new Error('getaddrinfo ENOTFOUND aws-0-ap-northeast-1.pooler.supabase.com'), {
      code: 'ENOTFOUND',
    });
    const db = await loadDb();
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toMatchObject({ code: 'ENOTFOUND' });
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toMatchObject({ code: 'ENOTFOUND' });
    expect(rec.queries).toEqual([]);

    control.fail = null;
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toThrow(/BYPASSES RLS/);
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
    expect(rec.sent('tenant-probe')).toEqual([]);
  });

  it('the deadline: a tenant query waits at most deadlineMs for a guard still running; the refusal is not cached and nothing was sent', async () => {
    let pass!: () => void;
    control.hold = new Promise<void>((r) => (pass = r));
    control.deadlineMs = 300;
    const db = await loadDb();

    const started = Date.now();
    const refused = await Promise.allSettled([
      db.execute(sql`select 'tenant-probe-refused' as probe`),
      db.transaction(async (t) => t.execute(sql`select 'tenant-probe-refused-tx' as probe`)),
    ]);
    expect(Date.now() - started).toBeLessThan(2_000);
    for (const outcome of refused) {
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({
        name: 'TenantGuardPendingError',
        code: 'TENANT_GUARD_PENDING',
      });
    }
    expect(rec.queries).toEqual([]);

    // The guard then passes: the refusal was not kept, and the refused queries were never sent later.
    pass();
    expect([...(await db.execute(sql`select 'tenant-probe-later' as probe`))]).toEqual([{ probe: 'tenant-probe-later' }]);
    await sleep(100);
    expect(rec.sent('tenant-probe')).toEqual(["select 'tenant-probe-later' as probe"]);
    expect(rec.sent('begin')).toEqual([]);
  });

  it('the deadline against a pooler that accepts and never answers: refused in ~deadlineMs, not after the 30 s connect_timeout', async () => {
    rec.state.mode = 'stall';
    control.deadlineMs = 300;
    const db = await loadDb();
    const started = Date.now();
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toMatchObject({
      name: 'TenantGuardPendingError',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(rec.state.connections).toBeGreaterThan(0);

    // The pooler comes back: the attempt's stalled connection closes, the guard
    // retries on its own, and a later tenant query gets the real outcome.
    rec.state.mode = 'forward';
    rec.releaseStalled();
    await vi.waitFor(
      async () => {
        await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toThrow(/BYPASSES RLS/);
      },
      { timeout: 15_000, interval: 50 },
    );
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
    expect(rec.sent('tenant-probe')).toEqual([]);
  }, 30_000);
});

describe('register() — the boot hook does no awaited DB I/O', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('JOB_KICK', 'off'); // no process-global enqueue listener left behind
  });
  afterEach(() => {
    delete memo.__restomatchEnqueueListener;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('restomatch.askBurstLimiter')];
  });

  beforeAll(async () => {
    // Compile what the boot hook imports once, so the timing below measures the
    // hook, not vitest transforming @restomatch/api (~4 s) on first import.
    await import('../askRateLimit');
    await import('../jobKick');
    await import('../db');
  }, 60_000);

  async function register() {
    vi.resetModules();
    return (await import('../../instrumentation')).register();
  }

  it('resolves while the tenant database does not answer', async () => {
    // Accepts and never answers: the frozen-handshake case (CONNECT_TIMEOUT after 30 s).
    const stalled: Socket[] = [];
    const stall = createServer((s) => {
      stalled.push(s);
      s.on('error', () => {});
    });
    await new Promise<void>((r) => stall.listen(0, '127.0.0.1', () => r()));
    const url = new URL(rec.url);
    url.port = String((stall.address() as { port: number }).port);
    vi.stubEnv('DATABASE_URL_APP', url.toString());

    const booting = register().then(
      () => 'resolved',
      (e: unknown) => `rejected: ${(e as Error).message}`,
    );
    const outcome = await Promise.race([booting, sleep(2_000).then(() => 'still pending')]);
    expect(outcome).toBe('resolved');

    // Let the background warm-up (or, before the fix, the boot hook) give up
    // before the next test: the database now refuses connections outright.
    const warmUp = (await import('../db')).ensureTenantGuard({ deadlineMs: null });
    await new Promise((r) => stall.close(r));
    for (const s of stalled) s.destroy();
    await Promise.all([booting, warmUp.catch(() => {})]);
  }, 20_000);

  /** The boot hook's log lines about the tenant guard. */
  const guardLines = (spy: unknown) =>
    (spy as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('tenant guard'));

  it('the warm-up reports a verdict: console.error and captureException(verdict: true)', async () => {
    // Real lib/env.ts checks: the superuser BYPASSES RLS.
    await expect(register()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(control.capture).toHaveBeenCalled(), { timeout: 10_000 });

    expect(guardLines(console.error)).toEqual([
      expect.stringMatching(/^\[boot\] tenant guard FAILED — tenant DB access is blocked on this instance: .*BYPASSES RLS/),
    ]);
    expect(guardLines(console.warn)).toEqual([]);
    expect(control.capture).toHaveBeenCalledTimes(1);
    const [reported, context] = control.capture.mock.calls[0]!;
    expect(isTenantGuardVerdict(reported)).toBe(true);
    expect(context).toEqual({ stage: 'tenant-guard-warmup', verdict: true });
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
  });

  it('the warm-up reports an unreachable database as a warning (verdict: false); the next tenant query runs the guard again', async () => {
    rec.state.mode = 'drop';
    await expect(register()).resolves.toBeUndefined();
    // retryTransientDb's own 4 tries (~3.5 s of backoff) come first.
    await vi.waitFor(() => expect(control.capture).toHaveBeenCalled(), { timeout: 15_000 });

    expect(guardLines(console.warn)).toEqual([
      expect.stringMatching(/^\[boot\] tenant guard not checked yet \(.*ECONNRESET.*\); .*runs it again$/),
    ]);
    expect(guardLines(console.error)).toEqual([]);
    expect(control.capture).toHaveBeenCalledTimes(1);
    const [reported, context] = control.capture.mock.calls[0]!;
    expect(isTransientDbError(reported)).toBe(true);
    expect(context).toEqual({ stage: 'tenant-guard-warmup', verdict: false });

    rec.state.mode = 'forward';
    const { db } = await import('../db');
    await expect(db.execute(sql`select 'tenant-probe' as probe`)).rejects.toThrow(/BYPASSES RLS/);
    expect(rec.sent('rolbypassrls')).toHaveLength(1);
  }, 30_000);

  it('no rejection escapes register(), even when the warm-up’s reporting throws', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const broken = () => {
        throw new Error('reporting is broken');
      };
      vi.mocked(console.error).mockImplementation(broken);
      control.capture.mockImplementation(broken);
      await expect(register()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(control.capture).toHaveBeenCalled(), { timeout: 10_000 });
      await sleep(50);
      expect(unhandled).not.toHaveBeenCalled();
      expect(vi.mocked(console.error)).toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('still fails the boot on a bad production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');
    await expect(register()).rejects.toThrow(/\[env\]/);
  });
});
