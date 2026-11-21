/**
 * Does this already-issued session token skip the second factor? (Epic C.)
 *
 * twoFactorPending is stamped at SIGN-IN from the account's enrolment state, so
 * a token minted BEFORE the user enrolled TOTP carries `twoFactorPending: false`
 * without ever having passed a second factor. Such a token must not keep working
 * once the account has 2FA — the admin console (adminProcedure) and every other
 * surface would otherwise accept it for its whole lifetime (up to 30 days with
 * remember-me).
 *
 * A token has passed the second factor of the CURRENT enrolment only if the jwt
 * callback, when it consumed a server-verified 2FA ticket (/login/2fa, or the
 * enrolment confirm in Settings, which itself verifies a TOTP code), stamped
 * `mfaFor` with that enrolment's id — user_credentials.totp_enabled_at as epoch
 * ms, read from the DB (an exact match, no clock comparison). Disabling and
 * re-enrolling changes it, so a session that passed the OLD factor (e.g. with a
 * stolen secret or recovery code) does not survive a re-enrolment.
 *
 *  - 2FA not enrolled                             → allowed (nothing to bypass)
 *  - enrolled, token still pending                → allowed (the /login/2fa gate handles it)
 *  - enrolled, not pending, mfaFor === enrolment  → allowed (passed THIS factor here)
 *  - enrolled, not pending, otherwise             → BYPASS → the caller revokes the token
 *    (after ENROLMENT_GRACE_MS from arming, so the enrolling browser's in-flight
 *    requests are not revoked while its own token is being re-stamped)
 */
export function bypassesSecondFactor(s: {
  twoFactorEnabledAt: number | null;
  twoFactorPending?: boolean;
  mfaFor?: number;
  /** Epoch ms of this check (defaults to Date.now()). */
  now?: number;
}): boolean {
  if (s.twoFactorEnabledAt === null) return false;
  if (s.twoFactorPending === true) return false;
  if (s.mfaFor === s.twoFactorEnabledAt) return false;
  // The enrolling browser's requests that are already in flight when 2FA is
  // armed still carry its old token; revoking them would send an emptied cookie
  // that can overwrite the freshly stamped one (and sign the enrolling user out).
  // So a just-armed enrolment is enforced after a short grace.
  const now = s.now ?? Date.now();
  return now - s.twoFactorEnabledAt > ENROLMENT_GRACE_MS;
}

/**
 * How long after arming 2FA a not-yet-cleared token still works (see above).
 * The trade-off: a session minted before enrolment survives at most this long.
 */
export const ENROLMENT_GRACE_MS = 15_000;
