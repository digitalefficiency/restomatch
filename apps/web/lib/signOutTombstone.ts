import { SESSION_TTL_LONG_SEC } from './sessionLifetime';

/**
 * Sign-out tombstone (DB-free).
 *
 * Every authenticated response re-issues the session cookie (rolling JWT). A
 * request still in flight when the user signs out (a link prefetch, a tRPC
 * query) can land AFTER the sign-out response and plant the still-valid JWT
 * again — the user is "signed out" and still in (~30% of sign-outs on a
 * production build).
 *
 * So sign-out also sets this HttpOnly cookie to the sign-out time, and the node
 * jwt callback rejects any token that was issued (loginAt) at or before it.
 * Only THIS browser is affected: the user's other devices keep their sessions,
 * and a fresh sign-in here gets a newer loginAt and passes. The in-flight
 * responses that re-plant the session cookie never touch this one.
 */
export const SIGNOUT_COOKIE = 'rm_so';

/** Outlives any JWT it could need to reject (the longest session window). */
export const SIGNOUT_COOKIE_MAX_AGE_SEC = SESSION_TTL_LONG_SEC;

export function signOutCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: SIGNOUT_COOKIE_MAX_AGE_SEC,
  };
}

/** Clock-skew allowance before a tombstone counts as "from the future". */
export const SIGNOUT_FUTURE_SKEW_MS = 60_000;

/**
 * True when the token predates this browser's last sign-out. A token without
 * loginAt (pre-B.5) counts as oldest. A missing / malformed tombstone never
 * rejects anything — nor does one dated in the future (we only ever write
 * "now"): a forged far-future rm_so (cookie tossing, a hostile extension)
 * would otherwise reject every new sign-in on this browser for 30 days.
 */
export function issuedBeforeSignOut(
  loginAtMs: number | undefined,
  tombstone: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!tombstone) return false;
  const signedOutAt = Number(tombstone);
  if (!Number.isFinite(signedOutAt) || signedOutAt <= 0) return false;
  if (signedOutAt > nowMs + SIGNOUT_FUTURE_SKEW_MS) return false;
  return (loginAtMs ?? 0) <= signedOutAt;
}
