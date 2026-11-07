import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * H-06ʰ — the supplier's reply link for a "מכתב בקשת זיכוי".
 *
 * TOKEN FORMAT (stateless, no DB row, no schema change)
 *
 *   c1.<payload>.<sig>   payload = base64url( restaurantId(16) ‖ supplierId(16) ‖ issuedAt(uint32 BE, unix s) )
 *   c2.<payload>.<sig>   the same ‖ letterId(16): the G-03 `claim_letters` row (0071, deploys 24.11).
 *                        Signed now; per-letter scoping switches on once claim_letters is deployed
 *                        (until then the scope is supplier + letter_sent_at ≤ issuedAt for both shapes).
 *     (the version prefix is inside the HMAC input, so c1 and c2 cannot be swapped)
 *     sig     = base64url( HMAC-SHA256(key, "restomatch/claim-portal/v1" ‖ 0x00 ‖ payload-bytes) )
 *
 * - The lifetime is NOT in the token: it is always `issuedAt + 72 h`, so a
 *   signing bug can never mint a longer link.
 * - The key is `CLAIM_PORTAL_SECRET` (≥ 32 chars, Phase-6, set by a human). No
 *   secret ⇒ nothing verifies and nothing can be minted: the portal is OFF.
 * - Verification order: length cap → exact shape regex → constant-time HMAC
 *   check → decode. Anything that fails is the same `null` (a guesser cannot
 *   tell "bad signature" from "malformed").
 * - Rotating the secret revokes every outstanding link at once. A single link
 *   is "revoked" by moving its claims out of `letter_sent` (the portal answers
 *   only `letter_sent` lines).
 */

export const CLAIM_LINK_TTL_MS = 72 * 60 * 60 * 1000;
export const CLAIM_SECRET_MIN_LENGTH = 32;
const DOMAIN = 'restomatch/claim-portal/v1';
const BASE_BYTES = 36;
const LETTER_BYTES = 52;
/** `c1.` + 48 + `.` + 43 = 95 chars; `c2.` + 70 + `.` + 43 = 117 chars. */
export const CLAIM_TOKEN_LENGTH = 95;
export const CLAIM_TOKEN_LENGTH_WITH_LETTER = 117;
const TOKEN_RE = /^(c1)\.([A-Za-z0-9_-]{48})\.([A-Za-z0-9_-]{43})$|^(c2)\.([A-Za-z0-9_-]{70})\.([A-Za-z0-9_-]{43})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClaimLinkClaims {
  restaurantId: string;
  supplierId: string;
  /** G-03 `claim_letters.id`, when the link was minted for one letter (c2). */
  letterId: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

export type ClaimTokenCheck =
  | { ok: true; claims: ClaimLinkClaims }
  | { ok: false; error: 'NOT_FOUND' | 'EXPIRED' };

/** The signing secret, or null when the portal is off (unset / too short). */
export function claimPortalSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.CLAIM_PORTAL_SECRET;
  return s && s.length >= CLAIM_SECRET_MIN_LENGTH ? s : null;
}

/** SHA-256 hex of the raw token: the only form that may key a limiter or reach a log. */
export function hashClaimToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function uuidBytes(id: string): Buffer {
  if (!UUID_RE.test(id)) throw new Error('claim link: not a uuid');
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

function bytesUuid(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sign(secret: string, version: 'c1' | 'c2', payload: Buffer): Buffer {
  return createHmac('sha256', secret).update(DOMAIN).update(Buffer.from([0])).update(version).update(Buffer.from([0])).update(payload).digest();
}

/**
 * Mint a link token. Throws when the portal is off (no secret) — callers check
 * `claimPortalSecret()` first and show "not available" instead.
 */
export function signClaimToken(
  input: { restaurantId: string; supplierId: string; letterId?: string | null; now?: Date },
  env: NodeJS.ProcessEnv = process.env,
): { token: string; issuedAt: Date; expiresAt: Date } {
  const secret = claimPortalSecret(env);
  if (!secret) throw new Error('claim portal is off: CLAIM_PORTAL_SECRET is not set');
  // Rounded UP so a line sent earlier in the same second is inside the letter.
  const seconds = Math.ceil((input.now ?? new Date()).getTime() / 1000);
  const version = input.letterId ? 'c2' : 'c1';
  const payload = Buffer.alloc(input.letterId ? LETTER_BYTES : BASE_BYTES);
  uuidBytes(input.restaurantId).copy(payload, 0);
  uuidBytes(input.supplierId).copy(payload, 16);
  payload.writeUInt32BE(seconds, 32);
  if (input.letterId) uuidBytes(input.letterId).copy(payload, 36);
  const token = `${version}.${payload.toString('base64url')}.${sign(secret, version, payload).toString('base64url')}`;
  const issuedAt = new Date(seconds * 1000);
  return { token, issuedAt, expiresAt: new Date(issuedAt.getTime() + CLAIM_LINK_TTL_MS) };
}

/**
 * Verify a raw token. Malformed, forged, wrong-secret and portal-off are all
 * NOT_FOUND; only a genuine link past its 72 h is EXPIRED. A link "issued" in
 * the future (clock skew > 5 min or a forged clock) is NOT_FOUND.
 */
export function verifyClaimToken(
  token: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): ClaimTokenCheck {
  const secret = claimPortalSecret(env);
  if (!secret || typeof token !== 'string' || (token.length !== CLAIM_TOKEN_LENGTH && token.length !== CLAIM_TOKEN_LENGTH_WITH_LETTER)) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  const m = TOKEN_RE.exec(token);
  if (!m) return { ok: false, error: 'NOT_FOUND' };
  const version = (m[1] ?? m[4]) as 'c1' | 'c2';
  const p64 = (m[2] ?? m[5])!;
  const s64 = (m[3] ?? m[6])!;
  const payload = Buffer.from(p64, 'base64url');
  const given = Buffer.from(s64, 'base64url');
  // Re-encoding must round-trip: rejects non-canonical base64url (trailing bits).
  if (payload.length !== (version === 'c2' ? LETTER_BYTES : BASE_BYTES) || payload.toString('base64url') !== p64) return { ok: false, error: 'NOT_FOUND' };
  if (given.length !== 32 || given.toString('base64url') !== s64) return { ok: false, error: 'NOT_FOUND' };
  const expected = sign(secret, version, payload);
  if (!timingSafeEqual(expected, given)) return { ok: false, error: 'NOT_FOUND' };

  const issuedAt = new Date(payload.readUInt32BE(32) * 1000);
  if (issuedAt.getTime() > now.getTime() + 5 * 60 * 1000) return { ok: false, error: 'NOT_FOUND' };
  const expiresAt = new Date(issuedAt.getTime() + CLAIM_LINK_TTL_MS);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, error: 'EXPIRED' };
  return {
    ok: true,
    claims: {
      restaurantId: bytesUuid(payload.subarray(0, 16)),
      supplierId: bytesUuid(payload.subarray(16, 32)),
      letterId: version === 'c2' ? bytesUuid(payload.subarray(36, 52)) : null,
      issuedAt,
      expiresAt,
    },
  };
}
