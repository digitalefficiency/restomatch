import 'server-only';
import { clientIpFromHeaders, hashSupplierToken, isOriginAllowed } from '@restomatch/api';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

/**
 * Request guard for the public supplier-confirmation surface (/s/[token] and
 * POST /api/supplier-confirm/[token]). Same contract as S4's publicGuard
 * (raw-body cap + per-IP rate limit through the shared Redis/memory store);
 * swap the body of these functions for publicGuard once it lands — callers
 * don't change. Rate limits key on the IP AND on the token's hash (never the raw
 * token), so one leaked link can't be hammered from many IPs either.
 */

export const SUPPLIER_BODY_MAX_BYTES = 16 * 1024;
const VIEW_LIMIT = { limit: 60, windowSec: 600, prefix: 'rl:supplier-view' };
const POST_IP_LIMIT = { limit: 20, windowSec: 600, prefix: 'rl:supplier-post-ip' };
const POST_TOKEN_LIMIT = { limit: 10, windowSec: 600, prefix: 'rl:supplier-post-token' };

export type GuardFail = { status: 403 | 413 | 429 | 400; error: string; retryAfter?: number };

function ipOf(headers: Headers): string {
  return clientIpFromHeaders(headers, { trustedProxyHops: trustedProxyHops() });
}

/** Page views: per-IP limit only (reading needs the token anyway). */
export async function guardSupplierView(headers: Headers): Promise<GuardFail | null> {
  const rl = await enforceRateLimit(ipOf(headers), VIEW_LIMIT);
  return rl.allowed ? null : { status: 429, error: 'rate_limited', retryAfter: rl.resetSec };
}

/**
 * POSTs: same-origin, per-IP + per-token limits, then read the body with a hard
 * byte cap (content-length is not trusted — the stream is counted).
 */
export async function guardSupplierPost(
  req: Request,
  token: string,
): Promise<{ ok: true; body: string } | { ok: false; fail: GuardFail }> {
  if (
    !isOriginAllowed({
      method: req.method,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
    })
  ) {
    return { ok: false, fail: { status: 403, error: 'origin_not_allowed' } };
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > SUPPLIER_BODY_MAX_BYTES) {
    return { ok: false, fail: { status: 413, error: 'too_large' } };
  }
  const ipRl = await enforceRateLimit(ipOf(req.headers), POST_IP_LIMIT);
  if (!ipRl.allowed) return { ok: false, fail: { status: 429, error: 'rate_limited', retryAfter: ipRl.resetSec } };
  const tokRl = await enforceRateLimit(hashSupplierToken(token), POST_TOKEN_LIMIT);
  if (!tokRl.allowed) return { ok: false, fail: { status: 429, error: 'rate_limited', retryAfter: tokRl.resetSec } };

  const reader = req.body?.getReader();
  if (!reader) return { ok: false, fail: { status: 400, error: 'empty' } };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SUPPLIER_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return { ok: false, fail: { status: 413, error: 'too_large' } };
    }
    chunks.push(value);
  }
  return { ok: true, body: Buffer.concat(chunks).toString('utf8') };
}
