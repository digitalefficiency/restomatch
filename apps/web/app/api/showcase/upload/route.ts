/**
 * POST /api/showcase/upload — the public showcase receiver's invoice upload (SB-3).
 *
 * Same-origin, rate-limited per IP, multipart (`file` field). The file is
 * validated (type allowlist + magic bytes + size) and uploaded with the
 * SERVICE ROLE to `invoice-scans/walk-ins/<day>/…`; the response carries only a
 * short-lived signed URL. The anonymous browser never talks to storage, so the
 * anon INSERT/SELECT policies on walk-ins/ (which exposed every prospect's
 * upload) are no longer needed — S1's migration drops them.
 */
import { NextResponse } from 'next/server';
import {
  clientIpFromHeaders,
  getServiceStorageClient,
  isOriginAllowed,
  SHOWCASE_MAX_BYTES,
  uploadShowcaseScan,
  type RateLimitOptions,
} from '@restomatch/api';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';
import { SHOWCASE_OCR_OFF_CODE, showcaseRealOcrEnabled } from '../gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Anonymous storage writes: 20 uploads per IP per hour. */
const SHOWCASE_UPLOAD_LIMIT: RateLimitOptions = {
  limit: 20,
  windowSec: 60 * 60,
  prefix: 'showcase-upload',
};

/** Multipart envelope headroom on top of the file itself. */
const MAX_BODY_BYTES = SHOWCASE_MAX_BYTES + 64 * 1024;

const json = (status: number, body: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function POST(req: Request) {
  // Same pilot kill-switch as /api/showcase/ocr: no walk-ins writes while it is
  // off. `not_configured` is the code the browser client already maps to "keep
  // going with the local preview" (lib/supabase/client.ts), so the demo goes on.
  if (!showcaseRealOcrEnabled()) {
    return json(503, { ok: false, error: 'not_configured', code: SHOWCASE_OCR_OFF_CODE });
  }

  if (
    !isOriginAllowed({
      method: req.method,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
    })
  ) {
    return json(403, { ok: false, error: 'origin_not_allowed' });
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: 'too_large', maxBytes: SHOWCASE_MAX_BYTES });
  }

  const ip = clientIpFromHeaders(req.headers, { trustedProxyHops: trustedProxyHops() });
  const rl = await enforceRateLimit(ip, SHOWCASE_UPLOAD_LIMIT);
  if (!rl.allowed) {
    return json(429, { ok: false, error: 'too_many_requests' }, { 'retry-after': String(rl.resetSec) });
  }

  const storage = getServiceStorageClient();
  if (!storage) {
    // No storage configured (local dev): the client falls back to demo mode.
    return json(503, { ok: false, error: 'not_configured' });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    file = f instanceof File ? f : null;
  } catch {
    return json(400, { ok: false, error: 'invalid_form' });
  }
  if (!file) return json(400, { ok: false, error: 'missing_file' });
  if (file.size > SHOWCASE_MAX_BYTES) {
    return json(413, { ok: false, error: 'too_large', maxBytes: SHOWCASE_MAX_BYTES });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadShowcaseScan(storage, bytes, file.type);
  if (!result.ok) return json(result.status, { ok: false, error: result.error, maxBytes: SHOWCASE_MAX_BYTES });

  return json(200, {
    ok: true,
    scanId: result.scanId,
    signedUrl: result.signedUrl,
    mimeType: result.mimeType,
  });
}
