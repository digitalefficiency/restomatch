import 'server-only';
import type { ZodType } from 'zod';
import { clientIpFromHeaders, isOriginAllowed } from '@restomatch/api';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

/**
 * SHIM — S4 owns the real `apps/web/lib/publicGuard.ts` (claude/client-ready-auth-admin,
 * db7bc63). This file has the agreed signature only, so callers don't change when
 * the real one is copied over byte-for-byte; do not extend it here.
 *
 *   const g = await guardPublicRequest(req, { rateLimit, maxBodyBytes, schema, sameOrigin: true, key });
 *   if (!g.ok) return g.response;   // otherwise g.data, g.rawBody, g.ip
 */
export interface PublicGuardOptions<T> {
  rateLimit: { limit: number; windowSec: number; prefix: string };
  maxBodyBytes: number;
  schema: ZodType<T>;
  sameOrigin?: boolean;
  key?: (ip: string) => string;
}

export type PublicGuardResult<T> =
  | { ok: true; data: T; rawBody: string; ip: string }
  | { ok: false; response: Response };

const deny = (status: number, error: string, headers: Record<string, string> = {}) => ({
  ok: false as const,
  response: new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  }),
});

export async function guardPublicRequest<T>(req: Request, opts: PublicGuardOptions<T>): Promise<PublicGuardResult<T>> {
  if (
    opts.sameOrigin &&
    !isOriginAllowed({
      method: req.method,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
    })
  ) {
    return deny(403, 'origin_not_allowed');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > opts.maxBodyBytes) return deny(413, 'too_large');

  const ip = clientIpFromHeaders(req.headers, { trustedProxyHops: trustedProxyHops() });
  const rl = await enforceRateLimit(opts.key ? opts.key(ip) : ip, opts.rateLimit);
  if (!rl.allowed) return deny(429, 'rate_limited', { 'retry-after': String(rl.resetSec) });

  // Count the stream — content-length is not trusted.
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBodyBytes) {
        await reader.cancel().catch(() => {});
        return deny(413, 'too_large');
      }
      chunks.push(value);
    }
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return deny(400, 'invalid_body');
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) return deny(400, 'invalid_body');
  return { ok: true, data: parsed.data, rawBody, ip };
}
