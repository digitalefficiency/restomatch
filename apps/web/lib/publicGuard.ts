/**
 * Guard for PUBLIC (no-session) route handlers — supplier links, inbound
 * webhooks, the leak check — so each one gets the same front door instead of
 * re-implementing it:
 *
 *   1. method allow-list                         → 405
 *   2. optional same-origin check (browser forms) → 403
 *   3. Content-Length pre-check                  → 413
 *   4. per-client rate limit (lib/rateLimit.ts)  → 429 + Retry-After
 *   5. STREAMED body read with a hard byte cap   → 413
 *   6. JSON.parse (bodyType 'json')              → 400
 *   7. zod safeParse — only AFTER the cap        → 422 (field paths only)
 *
 * Step 5 is the one that matters for GHSA-mrhx-c7xc-m3w5 (our zod exception
 * holds only while zod never sees attacker-sized input): the cap is enforced on
 * the bytes actually read, so a chunked body or a lying Content-Length can't get
 * past it the way a header-only check lets it.
 *
 * Rate limiting goes through the existing `enforceRateLimit` — this file never
 * touches the store. It fails open if the store is down, like every other
 * limiter. Callers run on `runtime = 'nodejs'`: the rate-limit store is Postgres.
 */
import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { clientIpFromHeaders, isOriginAllowed, type RateLimitOptions } from '@restomatch/api';
import { enforceRateLimit, trustedProxyHops } from './rateLimit';

/** Default body cap when a route doesn't set one: 16 KiB covers any form/JSON payload we take. */
export const PUBLIC_DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export interface PublicGuardOptions<T> {
  /** Per-client limit (`prefix` namespaces it — give every route its own). */
  rateLimit: RateLimitOptions;
  /** Hard cap on the raw request body, in bytes. Default 16 KiB. */
  maxBodyBytes?: number;
  /** Allowed HTTP methods (upper-case). Default `['POST']`. */
  methods?: readonly string[];
  /** `'json'` (default) parses the body; `'text'` hands back only the raw string (e.g. signed webhooks). */
  bodyType?: 'json' | 'text';
  /** Validates the parsed JSON (after the cap). Without it `data` is the parsed value, untyped. */
  schema?: ZodType<T>;
  /**
   * Require a same-origin browser request (Origin must match Host / AUTH_URL /
   * APP_URL). Use for forms posted from our own pages; leave off for
   * server-to-server webhooks, which send no Origin.
   */
  sameOrigin?: boolean;
  /** Rate-limit key from the client IP — e.g. `(ip) => \`${ip}:${token}\``. Default: the IP. */
  key?: (ip: string) => string;
}

export type PublicGuardResult<T> =
  | { ok: true; ip: string; rawBody: string; data: T }
  | { ok: false; response: NextResponse };

export type CappedBody = { ok: true; text: string } | { ok: false; reason: 'too_large' };

function fail(status: number, error: string, headers?: Record<string, string>): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ ok: false, error }, { status, headers }) };
}

/** Client IP the same way every other limiter attributes it (right-most trusted hop). */
export function publicClientIp(headers: Headers): string {
  return clientIpFromHeaders(headers, { trustedProxyHops: trustedProxyHops() });
}

/**
 * Read a request body, stopping (and cancelling the stream) as soon as it
 * exceeds `maxBytes`. Never buffers more than `maxBytes` + one chunk.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<CappedBody> {
  if (!req.body) return { ok: true, text: '' };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

export async function guardPublicRequest<T = unknown>(
  req: Request,
  opts: PublicGuardOptions<T>,
): Promise<PublicGuardResult<T>> {
  const methods = opts.methods ?? ['POST'];
  const maxBytes = opts.maxBodyBytes ?? PUBLIC_DEFAULT_MAX_BODY_BYTES;

  if (!methods.includes(req.method.toUpperCase())) {
    return fail(405, 'method not allowed', { allow: methods.join(', ') });
  }

  if (
    opts.sameOrigin &&
    !isOriginAllowed({
      method: req.method,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
    })
  ) {
    return fail(403, 'origin not allowed');
  }

  // Cheap early reject; the streamed cap below is the real enforcement.
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return fail(413, 'payload too large');
  }

  const ip = publicClientIp(req.headers);
  const rl = await enforceRateLimit(opts.key ? opts.key(ip) : ip, opts.rateLimit);
  if (!rl.allowed) {
    return fail(429, 'too many requests', { 'retry-after': String(Math.max(1, rl.resetSec)) });
  }

  const body = await readBodyCapped(req, maxBytes);
  if (!body.ok) return fail(413, 'payload too large');

  if (opts.bodyType === 'text') {
    return { ok: true, ip, rawBody: body.text, data: body.text as T };
  }

  let parsed: unknown;
  try {
    parsed = body.text === '' ? undefined : JSON.parse(body.text);
  } catch {
    return fail(400, 'invalid json');
  }

  if (!opts.schema) return { ok: true, ip, rawBody: body.text, data: parsed as T };

  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    // Paths only — never echo the submitted values back.
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(root)'))];
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'invalid input', fields }, { status: 422 }),
    };
  }
  return { ok: true, ip, rawBody: body.text, data: result.data };
}
