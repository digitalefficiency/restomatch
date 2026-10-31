/**
 * Leak-check public-surface security primitives (S15 wave 1).
 *
 *  - gate:          the public page/routes exist only with LEAK_CHECK_PUBLIC=1
 *                   AND the leakCheck feature not killed by FEATURES_OFF.
 *  - proof of work: CAPTCHA-free bot cost. The server hands out an HMAC-signed
 *                   challenge; the browser finds a nonce whose SHA-256 has N
 *                   leading zero bits. Stateless to issue, single-use enforced
 *                   by the caller (rate-limit store key on the salt).
 *  - signed links:  the result / claim link is `<sessionId>.<exp>.<hmac>` —
 *                   short-lived and unguessable, so nobody reaches another
 *                   prospect's results by changing an id.
 *  - file sniffing: type is decided by magic bytes, never by the client's
 *                   declared mime or file name.
 *
 * Every HMAC is domain-separated ("lc-pow.", "lc-link.") so a token of one kind
 * can never be replayed as the other.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { featureEnabled } from '../lib/features';

export function leakCheckPublicEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LEAK_CHECK_PUBLIC !== '1') return false;
  return featureEnabled({ features: { leakCheck: true } }, 'leakCheck', env);
}

export type LeakCheckOcrMode = 'claude' | 'stub';

/**
 * Which OCR the public check may use. Real Claude Vision only with a key AND an
 * explicit spend opt-in (LEAK_CHECK_REAL_OCR=1). The deterministic sample stub
 * runs outside production, or in production only with LEAK_CHECK_ALLOW_SAMPLE=1
 * (a demo deployment) — a real prospect must never get sample numbers silently.
 * Null ⇒ the check is unavailable.
 */
export function leakCheckOcrMode(env: NodeJS.ProcessEnv = process.env): LeakCheckOcrMode | null {
  if (env.ANTHROPIC_API_KEY && env.LEAK_CHECK_REAL_OCR === '1') return 'claude';
  if (env.NODE_ENV !== 'production' || env.LEAK_CHECK_ALLOW_SAMPLE === '1') return 'stub';
  return null;
}

export function leakCheckSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.LEAK_CHECK_SECRET || env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('leak check: LEAK_CHECK_SECRET (or AUTH_SECRET) is not configured');
  }
  return secret;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function hmac(secret: string, domain: string, payload: string): string {
  return b64url(createHmac('sha256', secret).update(`${domain}.${payload}`).digest());
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ── Proof of work ─────────────────────────────────────────────────────── */

export const POW_DEFAULT_BITS = 16;
export const POW_TTL_SEC = 10 * 60;

export interface PowChallenge {
  /** Opaque signed token the client echoes back. */
  token: string;
  salt: string;
  bits: number;
  expiresAt: number;
}

export function issuePowChallenge(
  secret: string,
  opts: { bits?: number; now?: number } = {},
): PowChallenge {
  const bits = opts.bits ?? POW_DEFAULT_BITS;
  const expiresAt = Math.floor((opts.now ?? Date.now()) / 1000) + POW_TTL_SEC;
  const salt = randomBytes(16).toString('hex');
  const payload = `${salt}.${bits}.${expiresAt}`;
  return { token: `${payload}.${hmac(secret, 'lc-pow', payload)}`, salt, bits, expiresAt };
}

export function leadingZeroBits(hash: Buffer): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function powHash(salt: string, nonce: string): Buffer {
  return createHash('sha256').update(`${salt}:${nonce}`).digest();
}

/** Brute-force a nonce (tests / server-side tooling; the browser does the same in WebCrypto). */
export function solvePow(salt: string, bits: number): string {
  for (let n = 0; ; n++) {
    if (leadingZeroBits(powHash(salt, String(n))) >= bits) return String(n);
  }
}

export type PowVerdict = { ok: true; salt: string } | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'work' };

export function verifyPow(
  secret: string,
  token: string,
  nonce: string,
  opts: { now?: number; minBits?: number } = {},
): PowVerdict {
  const parts = token.split('.');
  if (parts.length !== 4 || !/^\d{1,12}$/.test(nonce)) return { ok: false, reason: 'malformed' };
  const [salt, bitsRaw, expRaw, sig] = parts as [string, string, string, string];
  const payload = `${salt}.${bitsRaw}.${expRaw}`;
  if (!safeEqual(sig, hmac(secret, 'lc-pow', payload))) return { ok: false, reason: 'signature' };
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < (opts.minBits ?? POW_DEFAULT_BITS)) return { ok: false, reason: 'malformed' };
  if (Number(expRaw) < Math.floor((opts.now ?? Date.now()) / 1000)) return { ok: false, reason: 'expired' };
  if (leadingZeroBits(powHash(salt, nonce)) < bits) return { ok: false, reason: 'work' };
  return { ok: true, salt };
}

/* ── Signed result links ───────────────────────────────────────────────── */

export const LINK_TTL_SEC = 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function signResultLink(
  secret: string,
  sessionId: string,
  opts: { ttlSec?: number; now?: number } = {},
): string {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + (opts.ttlSec ?? LINK_TTL_SEC);
  const payload = `${sessionId}.${exp}`;
  return `${payload}.${hmac(secret, 'lc-link', payload)}`;
}

/** The session id behind a valid, unexpired link — null for anything else. */
export function verifyResultLink(secret: string, token: string, opts: { now?: number } = {}): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, expRaw, sig] = parts as [string, string, string];
  if (!UUID_RE.test(sessionId) || !/^\d{1,12}$/.test(expRaw)) return null;
  if (!safeEqual(sig, hmac(secret, 'lc-link', `${sessionId}.${expRaw}`))) return null;
  if (Number(expRaw) < Math.floor((opts.now ?? Date.now()) / 1000)) return null;
  return sessionId;
}

/* ── Upload limits ─────────────────────────────────────────────────────── */

export const MAX_INVOICES = 10;
/** One file. Phones' photos are downscaled in the browser before upload. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** The whole multipart body — under the ~4.5 MB serverless request cap. */
export const MAX_BODY_BYTES = 4_400_000;

export type SniffedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffMime(buf: Buffer): SniffedMime | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** IPs are never stored raw — a keyed hash, so the table can't be joined to logs without the secret. */
export function hashIp(secret: string, ip: string): string {
  return createHmac('sha256', secret).update(`lc-ip.${ip}`).digest('hex');
}
