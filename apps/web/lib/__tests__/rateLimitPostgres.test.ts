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
// Limits use fixed windows keyed by floor(now / windowSec). A sequence of checks
// that straddles a window boundary lands in two windows, so the later count
// restarts at 1. The slow-connect test spends ~2 s per sequence and crossed a
// minute boundary in about 3% of runs. Every sequence that asserts counts within
// one window pins the clock it buckets by.
const frozenNow = () => {
  const t = Date.now();
  return () => t;
};

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
    const opts = { ...LOGIN_EMAIL_LIMIT, prefix: `${PREFIX}:login`, now: frozenNow() };
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

  it('decr gives back one unit of a live window, never below 0, never creates a key', async () => {
    const { PostgresRateLimitStore } = await import('../rateLimit');
    const store = new PostgresRateLimitStore(createDb(URL));
    const key = `${PREFIX}:decr`;
    await store.incr(key, 60);
    await store.incr(key, 60);
    await store.decr(key);
    const count = async (k: string) =>
      (await raw<Array<{ count: number }>>`SELECT count FROM rate_limit_counters WHERE key = ${k}`)[0]?.count;
    expect(await count(key)).toBe(1);
    await store.decr(key);
    await store.decr(key); // already 0: stays 0
    expect(await count(key)).toBe(0);
    await store.decr(`${PREFIX}:never-created`);
    expect(await count(`${PREFIX}:never-created`)).toBeUndefined();
    // An expired window is left alone.
    await store.incr(`${PREFIX}:expired`, 60);
    await raw`UPDATE rate_limit_counters SET expires_at = now() - interval '1 second' WHERE key = ${`${PREFIX}:expired`}`;
    await store.decr(`${PREFIX}:expired`);
    expect(await count(`${PREFIX}:expired`)).toBe(1);
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
      const opts = { limit: 1, windowSec: 60, prefix: `${PREFIX}:cold`, now: frozenNow() };
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
    const opts = { limit: 1, windowSec: 60, prefix: `${PREFIX}:slow`, now: frozenNow() };
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
    // enforceLoginLimit buckets by Date.now(): freeze Date only (timers and I/O stay real).
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await fn(await import('../rateLimit'));
    } finally {
      vi.useRealTimers();
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

  // Owner decision 31.10: only FAILED attempts count per IP (staff share one
  // restaurant Wi-Fi). Every attempt is still counted atomically; a success gives
  // its unit back (refundLoginIp), so a parallel burst stays bounded.
  it('per IP, successes are refunded: 40 successful logins from one IP all succeed', async () => {
    await withRealDb(async (rl) => {
      const ip = `10.4.0.1-${RUN}`;
      for (let i = 0; i < 40; i++) {
        const email = `ip${i}-${RUN}@demo.test`;
        expect((await rl.enforceLoginLimit(email, ip)).allowed, `login #${i + 1}`).toBe(true);
        await rl.clearLoginFailures(email); // what authorize() does after a correct password
        await rl.refundLoginIp(ip);
      }
    });
  });

  it('per IP, failures still count: the 31st failed attempt from one IP is refused', async () => {
    await withRealDb(async (rl) => {
      const ip = `10.4.1.1-${RUN}`;
      for (let i = 0; i < rl.LOGIN_IP_LIMIT.limit; i++) {
        expect((await rl.enforceLoginLimit(`fail${i}-${RUN}@demo.test`, ip)).allowed).toBe(true); // wrong password: no refund
      }
      expect((await rl.enforceLoginLimit(`failx-${RUN}@demo.test`, ip)).allowed).toBe(false);
    });
  });

  it('per IP, a success gives back only its own unit (earlier failures stay counted)', async () => {
    await withRealDb(async (rl) => {
      const ip = `10.4.2.1-${RUN}`;
      for (let i = 0; i < rl.LOGIN_IP_LIMIT.limit - 1; i++) {
        await rl.enforceLoginLimit(`mix${i}-${RUN}@demo.test`, ip); // 29 failures
      }
      expect((await rl.enforceLoginLimit(`ok-${RUN}@demo.test`, ip)).allowed).toBe(true); // #30, correct password
      await rl.refundLoginIp(ip); // back to 29
      expect((await rl.enforceLoginLimit(`mix30-${RUN}@demo.test`, ip)).allowed).toBe(true); // #30 again (failure)
      expect((await rl.enforceLoginLimit(`mix31-${RUN}@demo.test`, ip)).allowed).toBe(false); // #31 refused
    });
  });

  it('per IP, a refund lands in the window the attempt was counted in (never the next one)', async () => {
    await withRealDb(async (rl) => {
      const ip = `10.4.4.1-${RUN}`;
      const windowMs = rl.LOGIN_IP_LIMIT.windowSec * 1000;
      const k = Math.floor(Date.now() / windowMs) * windowMs; // start of the current window
      const inK = k + windowMs - 10; // 10 ms before the boundary
      const inNext = k + windowMs + 10; // 10 ms after it
      // A successful login counted at the very end of window k ...
      expect((await rl.enforceLoginLimit(`edge-${RUN}@demo.test`, ip, inK)).allowed).toBe(true);
      // ... while 29 failures land in the next window ...
      for (let i = 0; i < rl.LOGIN_IP_LIMIT.limit - 1; i++) {
        await rl.enforceLoginLimit(`edgefail${i}-${RUN}@demo.test`, ip, inNext);
      }
      // ... and its refund runs after the boundary: it must give back window k's unit.
      await rl.refundLoginIp(ip, inK);
      expect((await rl.enforceLoginLimit(`edgefail29-${RUN}@demo.test`, ip, inNext)).allowed).toBe(true); // #30 in k+1
      expect((await rl.enforceLoginLimit(`edgefail30-${RUN}@demo.test`, ip, inNext)).allowed).toBe(false); // #31 refused
    });
  });

  it('per IP, a parallel burst stays bounded even with refunds pending', async () => {
    await withRealDb(async (rl) => {
      const ip = `10.4.3.1-${RUN}`;
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) => rl.enforceLoginLimit(`burst${i}-${RUN}@demo.test`, ip)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(rl.LOGIN_IP_LIMIT.limit);
    });
  });
});
