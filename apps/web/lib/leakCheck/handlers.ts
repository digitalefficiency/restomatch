import 'server-only';
import { NextResponse } from 'next/server';
import { canonicalizeEmail, clientIpFromHeaders, isOriginAllowed, leakCheck as lc } from '@restomatch/api';
import { leads } from '@restomatch/db';
import { ClaudePoParser, ClaudeVision } from '@restomatch/ocr';
import { authDb } from '@/lib/authDb';
import { db } from '@/lib/db';
import { localeFromCookieHeader } from '@/lib/i18n/config';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

/**
 * Public leak-check surface (S15 wave 1). Three POST routes:
 *   /api/leak-check/challenge  → a signed proof-of-work challenge
 *   /api/leak-check/submit     → multipart upload → OCR → analysis → signed result link
 *   /api/leak-check/lead       → "book a demo" from a result (creates a lead row)
 *
 * Defences, in the order they run: feature gate (404 when off) → same-origin →
 * body-size cap before parsing → per-IP rate limit → honeypot → single-use
 * proof of work → per-email rate limit → upload count/size/magic-byte type →
 * daily OCR (Claude) budget. No tenant id is ever read from the client; the
 * sandbox is reached on the owner connection only by a signed short-lived link.
 */

export const LIMITS = {
  challenge: { limit: 30, windowSec: 60 * 60, prefix: 'lc-challenge' },
  submitIp: { limit: 5, windowSec: 24 * 60 * 60, prefix: 'lc-submit-ip' },
  submitEmail: { limit: 3, windowSec: 24 * 60 * 60, prefix: 'lc-submit-email' },
  lead: { limit: 10, windowSec: 60 * 60, prefix: 'lc-lead' },
} as const;

/**
 * Site-wide cap on submissions per hour, independent of who asks: even an
 * attacker with many real IPs can drain at most one hour's slice of the daily
 * OCR budget before real prospects get through again.
 */
export const GLOBAL_SUBMIT_LIMIT = { limit: 40, windowSec: 60 * 60, prefix: 'lc-submit-global' } as const;

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const fail = (error: string, status: number, headers?: Record<string, string>) =>
  json({ ok: false, error }, status, headers);

/** Shared preamble. Returns a Response to short-circuit, or the client IP. */
async function guard(req: Request, limit: (typeof LIMITS)[keyof typeof LIMITS]): Promise<Response | string> {
  if (!lc.leakCheckPublicEnabled()) return fail('not_found', 404);
  // Per-IP limits are meaningless on a spoofable left-most X-Forwarded-For.
  // In production this spend surface fails CLOSED until the proxy depth is
  // declared (TRUSTED_PROXY_HOPS=1 on Vercel).
  if (process.env.NODE_ENV === 'production' && trustedProxyHops() === 0) {
    console.error('[leak-check] TRUSTED_PROXY_HOPS is not set — refusing (per-IP limits would be spoofable)');
    return fail('unavailable', 503);
  }
  if (
    req.method !== 'POST' ||
    !isOriginAllowed({
      method: req.method,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
    })
  ) {
    return fail('origin_not_allowed', 403);
  }
  const ip = clientIpFromHeaders(req.headers, { trustedProxyHops: trustedProxyHops() });
  const rl = await enforceRateLimit(ip, limit);
  if (!rl.allowed) return fail('rate_limited', 429, { 'retry-after': String(rl.resetSec) });
  return ip;
}

function secretOr503(): string | Response {
  try {
    return lc.leakCheckSecret();
  } catch {
    console.error('[leak-check] LEAK_CHECK_SECRET / AUTH_SECRET missing');
    return fail('unavailable', 503);
  }
}

export async function handleChallenge(req: Request): Promise<Response> {
  const g = await guard(req, LIMITS.challenge);
  if (typeof g !== 'string') return g;
  const secret = secretOr503();
  if (typeof secret !== 'string') return secret;
  if (!lc.leakCheckOcrMode()) return fail('unavailable', 503);
  const c = lc.issuePowChallenge(secret);
  return json({ ok: true, token: c.token, salt: c.salt, bits: c.bits, expiresAt: c.expiresAt });
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;

const ERROR_STATUS: Record<lc.LeakCheckErrorCode, number> = {
  no_files: 400,
  too_many_files: 400,
  file_too_large: 413,
  body_too_large: 413,
  bad_file_type: 415,
  budget_exhausted: 503,
  ocr_failed: 422,
};

async function fileToUpload(v: FormDataEntryValue): Promise<lc.LeakCheckUpload | null> {
  if (typeof v === 'string') return null;
  if (v.size > lc.MAX_FILE_BYTES) return { name: v.name, bytes: Buffer.alloc(lc.MAX_FILE_BYTES + 1) };
  return { name: v.name || 'file', bytes: Buffer.from(await v.arrayBuffer()) };
}

export async function handleSubmit(req: Request): Promise<Response> {
  if (!lc.leakCheckPublicEnabled()) return fail('not_found', 404);
  // Size cap BEFORE parsing — a missing/lying content-length is caught again
  // by the per-file and total checks in validateUploads.
  // A chunked body (no content-length) would be buffered whole by formData():
  // browsers always send a length for FormData, so require one.
  const lengthHeader = req.headers.get('content-length');
  if (lengthHeader === null) return fail('length_required', 411);
  const declared = Number(lengthHeader);
  if (!Number.isFinite(declared) || declared > lc.MAX_BODY_BYTES + 64 * 1024) {
    return fail('body_too_large', 413);
  }
  const g = await guard(req, LIMITS.submitIp);
  if (typeof g !== 'string') return g;
  const ip = g;
  const global = await enforceRateLimit('all', GLOBAL_SUBMIT_LIMIT);
  if (!global.allowed) return fail('budget_exhausted', 503, { 'retry-after': String(global.resetSec) });

  const secret = secretOr503();
  if (typeof secret !== 'string') return secret;
  const mode = lc.leakCheckOcrMode();
  if (!mode) return fail('unavailable', 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('bad_request', 400);
  }

  // Honeypot: a human never fills `website`. Pretend success, do nothing.
  const hp = form.get('website');
  if (typeof hp === 'string' && hp.trim().length > 0) return json({ ok: true, token: null });

  const pow = lc.verifyPow(secret, String(form.get('powToken') ?? ''), String(form.get('powNonce') ?? ''));
  if (!pow.ok) return fail('proof_of_work', 403);
  // Single use: a solved challenge buys exactly one submission.
  const once = await enforceRateLimit(pow.salt, { limit: 1, windowSec: lc.POW_TTL_SEC + 60, prefix: 'lc-pow' });
  if (!once.allowed) return fail('proof_of_work', 403);

  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (email.length > 320 || !EMAIL_RE.test(email)) return fail('invalid_email', 400);
  const perEmail = await enforceRateLimit(canonicalizeEmail(email), LIMITS.submitEmail);
  if (!perEmail.allowed) return fail('rate_limited', 429, { 'retry-after': String(perEmail.resetSec) });

  const nameRaw = form.get('name');
  const name = typeof nameRaw === 'string' ? nameRaw.trim().slice(0, 200) : '';
  const invoiceEntries = form.getAll('invoices');
  if (invoiceEntries.length > lc.MAX_INVOICES) return fail('too_many_files', 400);
  const invoices = (await Promise.all(invoiceEntries.map(fileToUpload))).filter(
    (u): u is lc.LeakCheckUpload => u !== null,
  );
  const plEntry = form.get('priceList');
  const priceList = plEntry && typeof plEntry !== 'string' && plEntry.size > 0 ? await fileToUpload(plEntry) : null;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.LEAK_CHECK_CLAUDE_MODEL ?? process.env.OCR_CLAUDE_MODEL;
  try {
    const out = await lc.runLeakCheck(
      authDb,
      { invoices, priceList, email, name: name || null, locale: localeFromCookieHeader(req.headers.get('cookie')), ip },
      {
        mode,
        secret,
        dailyOcrBudget: lc.dailyOcrBudget(),
        ...(mode === 'claude'
          ? {
              ocr: new ClaudeVision({ apiKey, model }),
              poParser: new ClaudePoParser({ apiKey, model, platform: 'manual' }),
            }
          : {}),
      },
    );
    return json({ ok: true, token: out.token });
  } catch (err) {
    if (err instanceof lc.LeakCheckError) return fail(err.code, ERROR_STATUS[err.code]);
    console.error('[leak-check] submit failed:', err);
    return fail('internal', 500);
  }
}

export async function handleLead(req: Request): Promise<Response> {
  const lengthHeader = req.headers.get('content-length');
  if (lengthHeader === null) return fail('length_required', 411);
  if (!(Number(lengthHeader) <= 4096)) return fail('body_too_large', 413);
  const g = await guard(req, LIMITS.lead);
  if (typeof g !== 'string') return g;
  const secret = secretOr503();
  if (typeof secret !== 'string') return secret;

  let body: { token?: unknown; phone?: unknown; restaurantName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('bad_request', 400);
  }
  const sessionId = lc.verifyResultLink(secret, typeof body.token === 'string' ? body.token : '');
  if (!sessionId) return fail('invalid_link', 400);
  const s = await lc.markLeadRequested(authDb, sessionId);
  if (!s) return fail('invalid_link', 400);
  if (s.firstTime) {
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 32) : '';
    const restaurantName = typeof body.restaurantName === 'string' ? body.restaurantName.trim().slice(0, 200) : '';
    // Public INSERT-only policy on leads — the tenant (app-role) connection suffices.
    await db.insert(leads).values({
      name: s.name || s.email,
      email: s.email,
      phone: phone || null,
      restaurantName: restaurantName || null,
      source: 'leak-check',
      note: `leak check: ${s.leakAgorot} agorot found in a sample of ${s.spendAgorot} agorot`,
    });
  }
  return json({ ok: true });
}
