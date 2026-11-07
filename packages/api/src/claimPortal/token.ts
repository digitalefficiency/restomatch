import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * H-06ʰ — the supplier's reply link for a "מכתב בקשת זיכוי".
 *
 * TOKEN FORMAT (stateless, no DB row, no schema change)
 *
 *   c1.<payload>.<sig>
 *     payload = base64url( restaurantId(16 bytes) ‖ supplierId(16 bytes) ‖ issuedAt(uint32 BE, unix seconds) )
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
const PAYLOAD_BYTES = 36;
/** `c1.` + 48 (36 bytes b64url) + `.` + 43 (32 bytes b64url) = 95 chars. */
export const CLAIM_TOKEN_LENGTH = 95;
const TOKEN_RE = /^c1\.([A-Za-z0-9_-]{48})\.([A-Za-z0-9_-]{43})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClaimLinkClaims {
  restaurantId: string;
  supplierId: string;
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

function sign(secret: string, payload: Buffer): Buffer {
  return createHmac('sha256', secret).update(DOMAIN).update(Buffer.from([0])).update(payload).digest();
}

/**
 * Mint a link token. Throws when the portal is off (no secret) — callers check
 * `claimPortalSecret()` first and show "not available" instead.
 */
export function signClaimToken(
  input: { restaurantId: string; supplierId: string; now?: Date },
  env: NodeJS.ProcessEnv = process.env,
): { token: string; issuedAt: Date; expiresAt: Date } {
  const secret = claimPortalSecret(env);
  if (!secret) throw new Error('claim portal is off: CLAIM_PORTAL_SECRET is not set');
  // Rounded UP so a line sent earlier in the same second is inside the letter.
  const seconds = Math.ceil((input.now ?? new Date()).getTime() / 1000);
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  uuidBytes(input.restaurantId).copy(payload, 0);
  uuidBytes(input.supplierId).copy(payload, 16);
  payload.writeUInt32BE(seconds, 32);
  const token = `c1.${payload.toString('base64url')}.${sign(secret, payload).toString('base64url')}`;
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
  if (!secret || typeof token !== 'string' || token.length !== CLAIM_TOKEN_LENGTH) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  const m = TOKEN_RE.exec(token);
  if (!m) return { ok: false, error: 'NOT_FOUND' };
  const payload = Buffer.from(m[1]!, 'base64url');
  const given = Buffer.from(m[2]!, 'base64url');
  // Re-encoding must round-trip: rejects non-canonical base64url (trailing bits).
  if (payload.length !== PAYLOAD_BYTES || payload.toString('base64url') !== m[1]) return { ok: false, error: 'NOT_FOUND' };
  if (given.length !== 32 || given.toString('base64url') !== m[2]) return { ok: false, error: 'NOT_FOUND' };
  const expected = sign(secret, payload);
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
      issuedAt,
      expiresAt,
    },
  };
}
