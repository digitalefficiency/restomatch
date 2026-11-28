import { connect, createServer, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { restaurants, sql } from '@restomatch/db';
import { isTransientDbError } from '../bootRetry';

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
// would fail the real check). Unheld, the real lib/env.ts checks run.
const control = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../env', async (importOriginal) => {
  const real = await importOriginal<typeof import('../env')>();
  return {
    ...real,
    assertAppRoleNoBypass: async (db: Parameters<typeof real.assertAppRoleNoBypass>[0]) =>
      control.hold ? control.hold : real.assertAppRoleNoBypass(db),
    assertRlsEnabled: async (db: Parameters<typeof real.assertRlsEnabled>[0]) =>
      control.hold ? undefined : real.assertRlsEnabled(db),
  };
});

const TEST_DB = new URL(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Text of a NUL-terminated string at `at`. */
const cstr = (buf: Buffer, at: number) => buf.toString('utf8', at, buf.indexOf(0, at));

/**
 * TCP proxy to the test database. Records the SQL of every Query ('Q') and Parse
 * ('P') message a client sends. mode 'drop' resets new connections at once (a
 * pooler that is unreachable: ECONNRESET).
 */
async function startRecorder() {
  const queries: string[] = [];
  const sockets = new Set<Socket>();
  const state = { mode: 'forward' as 'forward' | 'drop' };
  const server = createServer((client) => {
    sockets.add(client);
    client.on('error', () => {});
    if (state.mode === 'drop') {
      client.resetAndDestroy();
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
  control.hold = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The tenant pool connects as the test DB's superuser through the recorder.
  vi.stubEnv('DATABASE_URL_APP', rec.url);
});
afterEach(async () => {
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
    }
    // ...and after it.
    await expect(db.execute(sql`select 'tenant-probe-later' as probe`)).rejects.toThrow(/BYPASSES RLS/);

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
    const warmUp = (await import('../db')).ensureTenantGuard?.();
    await new Promise((r) => stall.close(r));
    for (const s of stalled) s.destroy();
    await Promise.all([booting, warmUp?.catch(() => {})]);
  }, 20_000);

  it('still fails the boot on a bad production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');
    await expect(register()).rejects.toThrow(/\[env\]/);
  });
});
