import { beforeAll, describe, expect, it, vi } from 'vitest';

// Never mutate process.env here: the web suites share one fork (vitest.config
// singleFork), so a deleted DATABASE_URL leaks into every later file. The limiter
// uses whatever store the config gives (Postgres in CI); each run gets its own
// random client-IP range so counters from earlier runs never collide.
const RUN = `${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}`;

let h: typeof import('../handler');
beforeAll(async () => {
  h = await import('../handler');
});

const CLAIM = '0b8a2f36-3b0e-4b55-9a77-5d7c2e8f9a10';
let n = 0;
/** Each test gets its own fake client IP, so the limiters don't bleed between tests. */
const ip = () => `${RUN}.${Math.floor(++n / 250)}.${n % 250}`;

function post(token: string, body: unknown, opts: { ip?: string; origin?: string | null; method?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: 'localhost:3000', 'x-forwarded-for': opts.ip ?? '10.9.9.9' };
  if (opts.origin !== null) headers.origin = opts.origin ?? 'http://localhost:3000';
  return new Request(`http://localhost:3000/api/claims/${token}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' ? null : (opts.raw ?? JSON.stringify(body)),
  });
}

const good = { lines: [{ claimId: CLAIM, answer: 'agree' }] };
const okSubmit = vi.fn(async () => ({ ok: true as const, acknowledged: 1, checking: 0 }));

describe('POST /api/claims/[token] (H-06ʰ)', () => {
  it('passes a valid same-origin answer to submit and returns only counts', async () => {
    const submit = vi.fn(async () => ({ ok: true as const, acknowledged: 1, checking: 0 }));
    const res = await h.handleClaimAnswer(post('tok-a', good, { ip: ip() }), 'tok-a', submit);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, acknowledged: 1, checking: 0 });
    expect(submit).toHaveBeenCalledWith('tok-a', good);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('405 for GET, 403 cross-origin, 413 over the cap, 422 on unknown fields — submit never runs', async () => {
    const submit = vi.fn(okSubmit);
    expect((await h.handleClaimAnswer(post('t', null, { method: 'GET', ip: ip() }), 't', submit)).status).toBe(405);
    expect((await h.handleClaimAnswer(post('t', good, { origin: 'https://evil.example', ip: ip() }), 't', submit)).status).toBe(403);
    const big = JSON.stringify({ ...good, note: 'א'.repeat(h.CLAIM_BODY_MAX_BYTES) });
    expect((await h.handleClaimAnswer(post('t', null, { raw: big, ip: ip() }), 't', submit)).status).toBe(413);
    const extra = await h.handleClaimAnswer(post('t', { ...good, status: 'credited' }, { ip: ip() }), 't', submit);
    expect(extra.status).toBe(422);
    const bad = await h.handleClaimAnswer(post('t', { lines: [{ claimId: CLAIM, answer: 'credited' }] }, { ip: ip() }), 't', submit);
    expect(bad.status).toBe(422);
    const empty = await h.handleClaimAnswer(post('t', { lines: [] }, { ip: ip() }), 't', submit);
    expect(empty.status).toBe(422);
    expect(submit).not.toHaveBeenCalled();
  });

  it('maps service errors to 404 / 410 / 409 / 400 with fixed bodies', async () => {
    const cases = [
      ['NOT_FOUND', 404],
      ['EXPIRED', 410],
      ['ALREADY_ANSWERED', 409],
      ['INVALID_LINES', 400],
    ] as const;
    for (const [error, status] of cases) {
      const res = await h.handleClaimAnswer(post('t', good, { ip: ip() }), 't', async () => ({ ok: false, error }));
      expect(res.status).toBe(status);
      expect(JSON.stringify(await res.json())).not.toContain('t,');
    }
  });

  it('limits per (IP × token hash): the 11th try on one link from one IP is 429 before submit', async () => {
    const who = ip();
    const submit = vi.fn(okSubmit);
    for (let i = 0; i < h.CLAIM_TOKEN_LIMIT.limit; i++) {
      expect((await h.handleClaimAnswer(post('same-link', good, { ip: who }), 'same-link', submit)).status).toBe(200);
    }
    const blocked = await h.handleClaimAnswer(post('same-link', good, { ip: who }), 'same-link', submit);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(h.CLAIM_TOKEN_LIMIT.limit);
  });

  it('limits per IP across links: rotating tokens from one IP is 429 after the IP budget', async () => {
    const who = ip();
    const submit = vi.fn(okSubmit);
    let last = 0;
    for (let i = 0; i <= h.CLAIM_IP_LIMIT.limit; i++) {
      last = (await h.handleClaimAnswer(post(`guess-${i}`, good, { ip: who }), `guess-${i}`, submit)).status;
    }
    expect(last).toBe(429);
    expect(submit).toHaveBeenCalledTimes(h.CLAIM_IP_LIMIT.limit);
  });

  it('keys limiters by the token hash, never the raw token', async () => {
    const rl = await import('@/lib/rateLimit');
    const spy = vi.spyOn(rl, 'enforceRateLimit');
    const raw = 'c1.RAW-TOKEN-MUST-NOT-APPEAR';
    await h.handleClaimAnswer(post(raw, good, { ip: ip() }), raw, okSubmit);
    const keys = spy.mock.calls.map((c) => String(c[0]));
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const k of keys) expect(k).not.toContain('RAW-TOKEN');
    spy.mockRestore();
  });
});

describe('the reply link is reachable without a session (H-06ʰ)', () => {
  it('lists /api/claims/<token> and /s/c/<token> as public, not /api/claimsX', async () => {
    const { isPublicPath } = await import('@/lib/publicPaths');
    expect(isPublicPath('/api/claims/c1.abc.def')).toBe(true);
    expect(isPublicPath('/s/c/c1.abc.def')).toBe(true);
    expect(isPublicPath('/api/claimsX')).toBe(false);
  });
});
