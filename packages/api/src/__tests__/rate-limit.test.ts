import { describe, expect, it } from 'vitest';
import { checkRateLimit, MemoryRateLimitStore, refundRateLimit, resetRateLimit, type RateLimitStore } from '../rateLimit';

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

describe('refundRateLimit (count every attempt atomically, give back successes)', () => {
  const t0 = 1_000_000_000_000;
  const opts = { limit: 30, windowSec: 900, prefix: 'login:ip', now: () => t0 };

  it('40 successful logins from one IP (count + refund each) are all allowed', async () => {
    const store = new MemoryRateLimitStore(() => t0);
    for (let i = 0; i < 40; i++) {
      expect((await checkRateLimit(store, '10.0.0.1', opts)).allowed, `login ${i + 1}`).toBe(true);
      await refundRateLimit(store, '10.0.0.1', opts);
    }
    expect(await checkRateLimit(store, '10.0.0.1', opts)).toMatchObject({ allowed: true, count: 1 });
  });

  it('30 failures refuse the 31st attempt; a success in between gives back only its own unit', async () => {
    const store = new MemoryRateLimitStore(() => t0);
    for (let i = 0; i < 15; i++) await checkRateLimit(store, '10.0.0.2', opts); // 15 failures
    await checkRateLimit(store, '10.0.0.2', opts); // a success…
    await refundRateLimit(store, '10.0.0.2', opts); // …refunded: still 15, not reset
    for (let i = 0; i < 15; i++) await checkRateLimit(store, '10.0.0.2', opts); // 30 failures
    expect(await checkRateLimit(store, '10.0.0.2', opts)).toMatchObject({ allowed: false, count: 31 });
    expect((await checkRateLimit(store, '10.0.0.3', opts)).allowed).toBe(true);
  });

  it('a parallel burst is still bounded: every attempt is counted before any refund', async () => {
    const store = new MemoryRateLimitStore(() => t0);
    const results = await Promise.all(Array.from({ length: 50 }, () => checkRateLimit(store, '10.0.0.4', opts)));
    expect(results.filter((r) => r.allowed)).toHaveLength(30);
  });

  it('never goes below 0 and never creates a key (refund in a new window is a no-op)', async () => {
    let t = t0;
    const store = new MemoryRateLimitStore(() => t);
    const o = { ...opts, now: () => t };
    await refundRateLimit(store, '10.0.0.5', o);
    await refundRateLimit(store, '10.0.0.5', o);
    expect(await checkRateLimit(store, '10.0.0.5', o)).toMatchObject({ count: 1 });
    t += 900_000;
    await refundRateLimit(store, '10.0.0.5', o);
    expect(await checkRateLimit(store, '10.0.0.5', o)).toMatchObject({ count: 1 });
  });

  it('a store without decr throws (the caller logs it), it never silently changes the limit', async () => {
    const bare: RateLimitStore = { incr: async () => 1 };
    await expect(refundRateLimit(bare, '10.0.0.6', opts)).rejects.toThrow(/decr/);
  });
});
