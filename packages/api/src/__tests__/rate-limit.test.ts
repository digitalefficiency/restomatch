import { describe, expect, it } from 'vitest';
import { checkRateLimit, MemoryRateLimitStore } from '../rateLimit';

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
