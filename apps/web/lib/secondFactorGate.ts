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
 * A token has passed the second factor in THIS session only if the jwt callback
 * stamped `mfaAt` when it consumed a server-verified 2FA ticket (/login/2fa, or
 * the enrolment confirm in Settings, which itself verifies a TOTP code).
 *
 *  - 2FA not enrolled                      → allowed (nothing to bypass)
 *  - enrolled, token still pending         → allowed (the /login/2fa gate handles it)
 *  - enrolled, not pending, mfaAt stamped  → allowed (passed the factor here)
 *  - enrolled, not pending, no mfaAt       → BYPASS → the caller revokes the token
 */
export function bypassesSecondFactor(s: {
  twoFactorEnabled: boolean;
  twoFactorPending?: boolean;
  mfaAt?: number;
}): boolean {
  return s.twoFactorEnabled && s.twoFactorPending !== true && s.mfaAt === undefined;
}
