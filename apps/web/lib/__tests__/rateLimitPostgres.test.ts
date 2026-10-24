import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createDb } from '@restomatch/db';
import { checkRateLimit } from '@restomatch/api';

/**
 * Rate limiting on Postgres (0061 rate_limit_counters; Redis is gone). Same
 * contract as before: global fixed-window counts, the same limits, and FAIL OPEN
 * within RATE_LIMIT_DEADLINE_MS when the store does not answer.
 */
const URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
const raw = postgres(URL, { max: 1, prepare: false, onnotice: () => {} });
const PREFIX = `rl-test-${process.pid}`;

let silent: Server;
let silentPort = 0;
beforeAll(async () => {
  silent = createServer(() => {});
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
  silentPort = (silent.address() as { port: number }).port;
});
afterAll(async () => {
  silent.close();
  await raw`DELETE FROM rate_limit_counters WHERE key LIKE ${`${PREFIX}%`}`;
  await raw.end();
});

describe('PostgresRateLimitStore', () => {
  it('counts per key and window, and sets an expiry for pruning', async () => {
    const { PostgresRateLimitStore } = await import('../rateLimit');
    const store = new PostgresRateLimitStore(createDb(URL));
    expect(await store.incr(`${PREFIX}:a`, 60)).toBe(1);
    expect(await store.incr(`${PREFIX}:a`, 60)).toBe(2);
    expect(await store.incr(`${PREFIX}:b`, 60)).toBe(1);
    const [row] = await raw<Array<{ count: number; ttl: number }>>`
      SELECT count, extract(epoch FROM expires_at - now())::int AS ttl FROM rate_limit_counters WHERE key = ${`${PREFIX}:a`}`;
    expect(row!.count).toBe(2);
    expect(row!.ttl).toBeGreaterThan(50);
    expect(row!.ttl).toBeLessThanOrEqual(60);
  });

  it('login lockout stays as strict: the limit+1-th attempt in a window is blocked', async () => {
    const { PostgresRateLimitStore, LOGIN_EMAIL_LIMIT } = await import('../rateLimit');
    const store = new PostgresRateLimitStore(createDb(URL));
    const opts = { ...LOGIN_EMAIL_LIMIT, prefix: `${PREFIX}:login` };
    let last = await checkRateLimit(store, 'owner@x.test', opts);
    for (let i = 1; i < LOGIN_EMAIL_LIMIT.limit; i++) last = await checkRateLimit(store, 'owner@x.test', opts);
    expect(last).toMatchObject({ allowed: true, count: LOGIN_EMAIL_LIMIT.limit, remaining: 0 });
    expect(await checkRateLimit(store, 'owner@x.test', opts)).toMatchObject({ allowed: false });
    // A different account is unaffected.
    expect(await checkRateLimit(store, 'other@x.test', opts)).toMatchObject({ allowed: true, count: 1 });
  });

  it('two instances (two pools) share one global counter', async () => {
    const { PostgresRateLimitStore } = await import('../rateLimit');
    const a = new PostgresRateLimitStore(createDb(URL));
    const b = new PostgresRateLimitStore(createDb(URL));
    const counts = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).incr(`${PREFIX}:shared`, 60)));
    expect([...counts].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe('enforceRateLimit on Postgres', () => {
  it('fails OPEN within the deadline when the database never answers', async () => {
    vi.resetModules();
    // lib/authDb memoizes its pool on globalThis (survives resetModules): drop
    // any pool an earlier test created so this one dials the black hole.
    const memo = globalThis as unknown as { __restomatchAuthDb?: unknown };
    const prevPool = memo.__restomatchAuthDb;
    delete memo.__restomatchAuthDb;
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgres://u:p@127.0.0.1:${silentPort}/db`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rl = await import('../rateLimit');
      // The first check of the process also waits for the connection (once).
      let t0 = Date.now();
      let res = await rl.enforceRateLimit('qa@example.test', rl.MAGIC_LINK_LIMIT);
      expect(res.allowed).toBe(true);
      expect(Date.now() - t0).toBeLessThan(rl.RATE_LIMIT_CONNECT_DEADLINE_MS + rl.RATE_LIMIT_DEADLINE_MS + 1_500);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/failing open/), expect.anything());
      // Every later check fails open within the normal deadline.
      t0 = Date.now();
      res = await rl.enforceRateLimit('qa@example.test', rl.MAGIC_LINK_LIMIT);
      expect(res.allowed).toBe(true);
      expect(Date.now() - t0).toBeLessThan(rl.RATE_LIMIT_DEADLINE_MS + 1_500);
    } finally {
      process.env.DATABASE_URL = prev;
      memo.__restomatchAuthDb = prevPool;
      warn.mockRestore();
      vi.resetModules();
    }
  }, 20_000);

  it('cold start: the FIRST check of a fresh process is enforced, not failed open (S15)', async () => {
    vi.resetModules();
    const memo = globalThis as unknown as { __restomatchAuthDb?: unknown };
    const prevPool = memo.__restomatchAuthDb;
    delete memo.__restomatchAuthDb; // a brand-new pool: the first query also connects
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = URL;
    const warn = vi.spyOn(console, 'warn');
    try {
      const rl = await import('../rateLimit');
      const opts = { limit: 1, windowSec: 60, prefix: `${PREFIX}:cold` };
      expect(await rl.enforceRateLimit('first@x.test', opts)).toMatchObject({ allowed: true, count: 1 });
      expect(await rl.enforceRateLimit('first@x.test', opts)).toMatchObject({ allowed: false, count: 2 });
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/failing open/), expect.anything());
    } finally {
      process.env.DATABASE_URL = prev;
      memo.__restomatchAuthDb = prevPool;
      warn.mockRestore();
      vi.resetModules();
    }
  });

  it('connection setup slower than the 1.5 s check deadline does not make the first check fail open', async () => {
    const { PostgresRateLimitStore, RATE_LIMIT_DEADLINE_MS } = await import('../rateLimit');
    const real = createDb(URL);
    let first = true;
    const slowToConnect = {
      execute: async (q: Parameters<typeof real.execute>[0]) => {
        if (first) {
          first = false;
          await new Promise((r) => setTimeout(r, RATE_LIMIT_DEADLINE_MS + 500)); // e.g. TLS to a far pooler
        }
        return real.execute(q);
      },
    };
    const store = new PostgresRateLimitStore(slowToConnect as never);
    const opts = { limit: 1, windowSec: 60, prefix: `${PREFIX}:slow` };
    expect(await checkRateLimit(store, 'slow@x.test', opts)).toMatchObject({ allowed: true, count: 1 });
    expect(await checkRateLimit(store, 'slow@x.test', opts)).toMatchObject({ allowed: false });
  }, 10_000);
});

describe('password-login limit counts only FAILED attempts (demo: many logins into one owner account)', () => {
  const RUN = `${process.pid}-${Date.now()}`;
  const withRealDb = async (fn: (rl: typeof import('../rateLimit')) => Promise<void>) => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = URL;
    vi.resetModules();
    try {
      await fn(await import('../rateLimit'));
    } finally {
      process.env.DATABASE_URL = prev;
      vi.resetModules();
    }
  };
  afterAll(async () => {
    await raw`DELETE FROM rate_limit_counters WHERE key LIKE ${`login:%${RUN}%`}`;
  });

  it('20 successful logins in one window all succeed', async () => {
    await withRealDb(async (rl) => {
      const email = `owner-${RUN}@demo.test`;
      for (let i = 0; i < 20; i++) {
        expect((await rl.enforceLoginLimit(email, `10.1.${i}.1-${RUN}`)).allowed, `login #${i + 1}`).toBe(true);
        await rl.clearLoginFailures(email); // what authorize() does after a correct password
      }
    });
  });

  it('10 failures lock the account (the 11th attempt is refused, even with the right password)', async () => {
    await withRealDb(async (rl) => {
      const email = `victim-${RUN}@demo.test`;
      for (let i = 0; i < rl.LOGIN_EMAIL_LIMIT.limit; i++) {
        expect((await rl.enforceLoginLimit(email, `10.2.${i}.1-${RUN}`)).allowed).toBe(true); // wrong password: no clear
      }
      expect((await rl.enforceLoginLimit(email, `10.2.99.1-${RUN}`)).allowed).toBe(false);
    });
  });

  it('a success after a few failures resets the count', async () => {
    await withRealDb(async (rl) => {
      const email = `typo-${RUN}@demo.test`;
      for (let i = 0; i < 4; i++) await rl.enforceLoginLimit(email, `10.3.${i}.1-${RUN}`); // 4 typos
      expect((await rl.enforceLoginLimit(email, `10.3.50.1-${RUN}`)).allowed).toBe(true); // then the right password
      await rl.clearLoginFailures(email);
      // A full 10 failures are needed again before the lock.
      for (let i = 0; i < rl.LOGIN_EMAIL_LIMIT.limit; i++) {
        expect((await rl.enforceLoginLimit(email, `10.3.${60 + i}.1-${RUN}`)).allowed).toBe(true);
      }
      expect((await rl.enforceLoginLimit(email, `10.3.99.1-${RUN}`)).allowed).toBe(false);
    });
  });

  it('the per-IP limit is unchanged: successes from one IP still count toward it', async () => {
    await withRealDb(async (rl) => {
      const ip = `10.4.0.1-${RUN}`;
      for (let i = 0; i < rl.LOGIN_IP_LIMIT.limit; i++) {
        const email = `ip${i}-${RUN}@demo.test`;
        expect((await rl.enforceLoginLimit(email, ip)).allowed).toBe(true);
        await rl.clearLoginFailures(email);
      }
      expect((await rl.enforceLoginLimit(`ipx-${RUN}@demo.test`, ip)).allowed).toBe(false);
    });
  });
});
