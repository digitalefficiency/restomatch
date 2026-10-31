import { describe, expect, it } from 'vitest';
import { checkRateLimit, MemoryRateLimitStore, peekRateLimit, resetRateLimit, type RateLimitStore } from '../rateLimit';

describe('checkRateLimit (fixed window)', () => {
  it('allows up to the limit then blocks', async () => {
    let t = 1_000_000_000_000;
    const store = new MemoryRateLimitStore(() => t);
    const opts = { limit: 3, windowSec: 900, now: () => t };

    const r1 = await checkRateLimit(store, 'a@x.com', opts);
    const r2 = await checkRateLimit(store, 'a@x.com', opts);
    const r3 = await checkRateLimit(store, 'a@x.com', opts);
    const r4 = await checkRateLimit(store, 'a@x.com', opts);

    expect([r1.allowed, r2.allowed, r3.allowed, r4.allowed]).toEqual([true, true, true, false]);
    expect(r3.remaining).toBe(0);
    expect(r4.count).toBe(4);
  });

  it('isolates identifiers', async () => {
    let t = 1_000_000_000_000;
    const store = new MemoryRateLimitStore(() => t);
    const opts = { limit: 1, windowSec: 900, now: () => t };

    expect((await checkRateLimit(store, 'a@x.com', opts)).allowed).toBe(true);
    expect((await checkRateLimit(store, 'b@x.com', opts)).allowed).toBe(true);
    expect((await checkRateLimit(store, 'a@x.com', opts)).allowed).toBe(false);
  });

  it('resets when the window rolls over', async () => {
    let t = 1_000_000_000_000;
    const store = new MemoryRateLimitStore(() => t);
    const opts = { limit: 2, windowSec: 900, now: () => t };

    await checkRateLimit(store, 'a@x.com', opts);
    expect((await checkRateLimit(store, 'a@x.com', opts)).allowed).toBe(true);
    expect((await checkRateLimit(store, 'a@x.com', opts)).allowed).toBe(false);

    // advance past the window
    t += 901 * 1000;
    const after = await checkRateLimit(store, 'a@x.com', opts);
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
  });

  it('blocks the 11th call under the public OCR limit (10/hour per IP)', async () => {
    // Mirrors apps/web SHOWCASE_OCR_LIMIT (D1.5): 10 per IP per hour, keyed by IP.
    let t = 1_000_000_000_000;
    const store = new MemoryRateLimitStore(() => t);
    const opts = { limit: 10, windowSec: 60 * 60, prefix: 'showcase-ocr', now: () => t };
    const ip = '203.0.113.7';

    const results = [];
    for (let i = 0; i < 11; i += 1) {
      results.push(await checkRateLimit(store, ip, opts));
    }
    expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true);
    expect(results[10]!.allowed).toBe(false);
    expect(results[10]!.resetSec).toBeGreaterThan(0);
  });

  it('reports a sane resetSec within the window', async () => {
    const windowSec = 900;
    // pick a time near the start of a window
    const t = Math.floor(1_000_000_000_000 / 1000 / windowSec) * windowSec * 1000 + 5_000;
    const store = new MemoryRateLimitStore(() => t);
    const res = await checkRateLimit(store, 'a@x.com', { limit: 5, windowSec, now: () => t });
    expect(res.resetSec).toBeGreaterThan(0);
    expect(res.resetSec).toBeLessThanOrEqual(windowSec);
  });
});

describe('resetRateLimit', () => {
  it("clears only the identifier's current window", async () => {
    const t = 1_000_000;
    const store = new MemoryRateLimitStore(() => t);
    const opts = { limit: 2, windowSec: 60, prefix: 'login:email', now: () => t };
    await checkRateLimit(store, 'a@x', opts);
    await checkRateLimit(store, 'a@x', opts);
    await checkRateLimit(store, 'b@x', opts);
    expect((await checkRateLimit(store, 'a@x', opts)).allowed).toBe(false);
    await resetRateLimit(store, 'a@x', opts);
    expect(await checkRateLimit(store, 'a@x', opts)).toMatchObject({ allowed: true, count: 1 });
    expect((await checkRateLimit(store, 'b@x', opts)).count).toBe(2); // untouched
  });

  it('is a no-op for a store without del', async () => {
    await expect(resetRateLimit({ incr: async () => 1 }, 'a@x', { limit: 1, windowSec: 60 })).resolves.toBeUndefined();
  });
});

describe('peekRateLimit (gate every attempt, record only failures)', () => {
  const t0 = 1_000_000_000_000;
  const opts = { limit: 30, windowSec: 900, prefix: 'login:ip', now: () => t0 };

  it('reads without counting: 40 peeks (successful logins) leave the count at 0, all allowed', async () => {
    const store = new MemoryRateLimitStore(() => t0);
    for (let i = 0; i < 40; i++) expect((await peekRateLimit(store, '10.0.0.1', opts)).allowed, `peek ${i + 1}`).toBe(true);
    expect(await peekRateLimit(store, '10.0.0.1', opts)).toMatchObject({ allowed: true, count: 0, remaining: 30 });
  });

  it('30 recorded failures refuse the 31st attempt; other IPs are unaffected', async () => {
    const store = new MemoryRateLimitStore(() => t0);
    for (let i = 0; i < 29; i++) await checkRateLimit(store, '10.0.0.2', opts);
    expect(await peekRateLimit(store, '10.0.0.2', opts)).toMatchObject({ allowed: true, count: 29 });
    await checkRateLimit(store, '10.0.0.2', opts); // 30th failure
    expect(await peekRateLimit(store, '10.0.0.2', opts)).toMatchObject({ allowed: false, count: 30, remaining: 0 });
    expect((await peekRateLimit(store, '10.0.0.3', opts)).allowed).toBe(true);
  });

  it('a new window starts fresh, and resetSec counts down to it', async () => {
    let t = t0;
    const store = new MemoryRateLimitStore(() => t);
    const o = { ...opts, now: () => t };
    for (let i = 0; i < 30; i++) await checkRateLimit(store, '10.0.0.4', o);
    const blocked = await peekRateLimit(store, '10.0.0.4', o);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetSec).toBeGreaterThan(0);
    t += blocked.resetSec * 1000;
    expect(await peekRateLimit(store, '10.0.0.4', o)).toMatchObject({ allowed: true, count: 0 });
  });

  it('a store without get reads 0 (fails open, like a store outage)', async () => {
    const bare: RateLimitStore = { incr: async () => 999 };
    expect(await peekRateLimit(bare, '10.0.0.5', opts)).toMatchObject({ allowed: true, count: 0 });
  });
});
