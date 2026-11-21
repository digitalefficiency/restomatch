import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Process-local limiter store for the test (no external store) — set before the import
// so rateLimit.ts picks the memory store.
delete process.env.REDIS_URL;
delete process.env.TRUSTED_PROXY_HOPS;

let guard: typeof import('../publicGuard');
beforeAll(async () => {
  guard = await import('../publicGuard');
});

let n = 0;
// Two hazards of fixed 1-hour windows, both seen as night-time reds:
//  - a test whose calls straddle an hour boundary (22:59:59 → 23:00:00) lands
//    them in two windows and the expected 429 never comes → each limiter pins
//    the clock it buckets by, as rateLimitPostgres.test.ts does (#151);
//  - with a database configured the counters are rate_limit_counters rows that
//    outlive the run: a second run within the same hour started from the first
//    run's counts (pg-test-1 … were the same keys every run) → a per-run prefix.
// No assertion changed.
const RUN = `${process.pid}-${Date.now().toString(36)}`;
const limit = (max = 100) => {
  const t = Date.now();
  return { limit: max, windowSec: 3600, prefix: `pg-test-${RUN}-${++n}`, now: () => t };
};

function post(body: BodyInit | null, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('http://localhost:3000/api/public/x', {
    method,
    body,
    headers: { 'content-type': 'application/json', ...headers },
    // Node's fetch needs this for a streamed request body.
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
}

/** A chunked body with NO content-length — what a header-only check misses. */
function chunked(totalBytes: number, chunk = 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= totalBytes) return c.close();
      const size = Math.min(chunk, totalBytes - sent);
      sent += size;
      c.enqueue(new TextEncoder().encode('a'.repeat(size)));
    },
  });
}

const schema = z.object({ email: z.string().email(), qty: z.number().int().positive() });

describe('guardPublicRequest', () => {
  it('parses + validates a good JSON body and returns the raw body too', async () => {
    const raw = JSON.stringify({ email: 'a@b.test', qty: 3 });
    const r = await guard.guardPublicRequest(post(raw), { rateLimit: limit(), schema });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ email: 'a@b.test', qty: 3 });
      expect(r.rawBody).toBe(raw);
    }
  });

  it('405s a method outside the allow-list, with Allow', async () => {
    const r = await guard.guardPublicRequest(post(null, {}, 'GET'), { rateLimit: limit() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(405);
      expect(r.response.headers.get('allow')).toBe('POST');
    }
  });

  it('413s on a declared Content-Length over the cap, before touching the limiter', async () => {
    const rl = limit(1);
    const r = await guard.guardPublicRequest(post('{}', { 'content-length': '999999' }), {
      rateLimit: rl,
      maxBodyBytes: 1024,
    });
    expect(!r.ok && r.response.status).toBe(413);
    // The limiter wasn't charged: the one allowed request still goes through.
    const ok = await guard.guardPublicRequest(post('{}'), { rateLimit: rl, maxBodyBytes: 1024 });
    expect(ok.ok).toBe(true);
  });

  it('413s a CHUNKED body over the cap (no Content-Length) and never hands it to zod', async () => {
    let parsed = false;
    const spy = z.unknown().superRefine(() => {
      parsed = true;
    });
    const r = await guard.guardPublicRequest(post(chunked(64 * 1024)), {
      rateLimit: limit(),
      maxBodyBytes: 4096,
      schema: spy,
    });
    expect(!r.ok && r.response.status).toBe(413);
    expect(parsed).toBe(false);
  });

  it('accepts a chunked body exactly at the cap', async () => {
    const r = await guard.guardPublicRequest(post(chunked(4096)), {
      rateLimit: limit(),
      maxBodyBytes: 4096,
      bodyType: 'text',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rawBody.length).toBe(4096);
  });

  it('counts the cap in BYTES, not characters (multi-byte Hebrew)', async () => {
    const he = JSON.stringify({ name: 'א'.repeat(600) }); // ~1.2 KB of UTF-8 in 600 chars
    const r = await guard.guardPublicRequest(post(he), { rateLimit: limit(), maxBodyBytes: 1000 });
    expect(!r.ok && r.response.status).toBe(413);
  });

  it('400s invalid JSON', async () => {
    const r = await guard.guardPublicRequest(post('{"a":'), { rateLimit: limit(), schema });
    expect(!r.ok && r.response.status).toBe(400);
  });

  it('422s a schema failure with field paths only — never the submitted values', async () => {
    const r = await guard.guardPublicRequest(post(JSON.stringify({ email: 'evil<script>', qty: -1 })), {
      rateLimit: limit(),
      schema,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(422);
      const body = await r.response.json();
      expect(body.fields.sort()).toEqual(['email', 'qty']);
      expect(JSON.stringify(body)).not.toContain('evil');
    }
  });

  it('429s past the limit with a Retry-After, per client IP', async () => {
    const rl = limit(2);
    const from = (ip: string) => post('{}', { 'x-forwarded-for': ip });
    expect((await guard.guardPublicRequest(from('203.0.113.1'), { rateLimit: rl })).ok).toBe(true);
    expect((await guard.guardPublicRequest(from('203.0.113.1'), { rateLimit: rl })).ok).toBe(true);
    const third = await guard.guardPublicRequest(from('203.0.113.1'), { rateLimit: rl });
    expect(!third.ok && third.response.status).toBe(429);
    if (!third.ok) expect(Number(third.response.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await guard.guardPublicRequest(from('203.0.113.2'), { rateLimit: rl })).ok).toBe(true);
  });

  it('a custom key narrows the bucket (e.g. per supplier-link token)', async () => {
    const rl = limit(1);
    const opts = (token: string) => ({ rateLimit: rl, key: (ip: string) => `${ip}:${token}` });
    expect((await guard.guardPublicRequest(post('{}'), opts('t1'))).ok).toBe(true);
    expect((await guard.guardPublicRequest(post('{}'), opts('t2'))).ok).toBe(true);
    const again = await guard.guardPublicRequest(post('{}'), opts('t1'));
    expect(!again.ok && again.response.status).toBe(429);
  });

  it('a burst that straddles an hour boundary is still counted in one window (pinned limiter clock)', async () => {
    const boundary = Date.parse('2026-10-31T23:00:00.000Z');
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(boundary - 1); // 22:59:59.999
      const rl = limit(1); // the helper pins the limiter to THIS instant
      expect((await guard.guardPublicRequest(post('{}'), { rateLimit: rl })).ok).toBe(true);
      clock.mockReturnValue(boundary + 1); // the real clock is now in the next hour's window
      const again = await guard.guardPublicRequest(post('{}'), { rateLimit: rl });
      expect(!again.ok && again.response.status).toBe(429); // still the same window: counted
    } finally {
      clock.mockRestore();
    }
  });

  it("bodyType 'text' returns the raw string unparsed (webhook signatures)", async () => {
    const raw = 'not json; signed bytes';
    const r = await guard.guardPublicRequest(post(raw), { rateLimit: limit(), bodyType: 'text' });
    expect(r.ok && r.rawBody).toBe(raw);
  });

  it('sameOrigin: 403s a cross-site or Origin-less POST, allows our own origin', async () => {
    const opts = { rateLimit: limit(), sameOrigin: true };
    const cross = await guard.guardPublicRequest(post('{}', { origin: 'https://evil.test', host: 'localhost:3000' }), opts);
    expect(!cross.ok && cross.response.status).toBe(403);
    const none = await guard.guardPublicRequest(post('{}', { host: 'localhost:3000' }), opts);
    expect(!none.ok && none.response.status).toBe(403);
    const own = await guard.guardPublicRequest(
      post('{}', { origin: 'http://localhost:3000', host: 'localhost:3000' }),
      opts,
    );
    expect(own.ok).toBe(true);
  });

  it('an empty body with a schema is a 422, not a crash', async () => {
    const r = await guard.guardPublicRequest(post(''), { rateLimit: limit(), schema });
    expect(!r.ok && r.response.status).toBe(422);
  });
});

describe('readBodyCapped', () => {
  it('returns the text under the cap and too_large over it', async () => {
    expect(await guard.readBodyCapped(post('hello'), 5)).toEqual({ ok: true, text: 'hello' });
    expect(await guard.readBodyCapped(post('hello!'), 5)).toEqual({ ok: false, reason: 'too_large' });
  });
});
