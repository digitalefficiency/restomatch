/**
 * The sign-in "hint" — what the last attempt on THIS browser typed, so the next
 * screen can keep it: the email after a wrong password (auth-06), the failure
 * count that offers the email-link fallback (auth-25), and the address +
 * send time "check your email" shows (auth-07). Kept in an httpOnly cookie
 * scoped to /login (never in the URL, never readable by scripts). Pure, so the
 * codec unit-tests without a Next runtime.
 */
export const HINT_COOKIE = 'rm_login_hint';
export const HINT_MAX_AGE_SEC = 15 * 60;
/** Wrong passwords before the email-link fallback is offered. */
export const FALLBACK_AFTER_FAILS = 2;
/**
 * Seconds of the "resend" UX countdown on "check your email". Not a rate limit:
 * the cookie is client-held. The real limit is MAGIC_LINK_LIMIT (lib/rateLimit.ts).
 */
export const RESEND_COOLDOWN_SEC = 30;

export interface LoginHint {
  /** The address typed last (≤ 254 chars). */
  email: string;
  /** Consecutive wrong passwords on this browser. */
  fails: number;
  /** When a sign-in link was last requested (epoch ms), if one was. */
  sentAt: number | null;
  /** Where the link should land (a validated same-origin path). */
  next: string | null;
}

const EMAIL_MAX = 254;

export function encodeHint(h: LoginHint): string {
  return JSON.stringify({ e: h.email.slice(0, EMAIL_MAX), f: h.fails, s: h.sentAt, n: h.next });
}

/** Parse a cookie value; anything malformed is "no hint". */
export function decodeHint(raw: string | undefined | null): LoginHint | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const v = JSON.parse(raw) as { e?: unknown; f?: unknown; s?: unknown; n?: unknown };
    if (typeof v.e !== 'string' || v.e.length === 0 || v.e.length > EMAIL_MAX) return null;
    const fails = typeof v.f === 'number' && Number.isInteger(v.f) && v.f >= 0 ? Math.min(v.f, 99) : 0;
    const sentAt = typeof v.s === 'number' && Number.isFinite(v.s) && v.s > 0 ? v.s : null;
    const next = typeof v.n === 'string' && v.n.startsWith('/') && !v.n.startsWith('//') ? v.n.slice(0, 512) : null;
    return { email: v.e, fails, sentAt, next };
  } catch {
    return null;
  }
}

/** "dana@kfar.co.il" → "da•••@kfar.co.il"; a 1–2 letter local part keeps one. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${keep}•••@${domain}`;
}

/** Seconds left before another link may be sent (0 = now). */
export function resendWaitSec(sentAt: number | null, now: number = Date.now()): number {
  if (!sentAt) return 0;
  const left = Math.ceil((sentAt + RESEND_COOLDOWN_SEC * 1000 - now) / 1000);
  return Math.max(0, Math.min(left, RESEND_COOLDOWN_SEC));
}
