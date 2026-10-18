/**
 * "Remember me" session-lifetime policy (Epic B.5).
 *
 * Pure + dependency-free so it is unit-testable and safe to import from either
 * runtime. Auth.js v5 has no native per-login maxAge, so auth.ts enforces these
 * windows itself in the jwt callback (absolute cap from loginAt) AND uses
 * `cookieMaxAge` for the Set-Cookie Max-Age:
 *   - remember ON  → a persistent cookie with a long (30d) Max-Age + long token.
 *   - remember OFF → a SESSION cookie (no Max-Age, undefined) + short (1d) token.
 */

/** Short window — default, "this browser session" (~1 day). */
export const SESSION_TTL_SHORT_SEC = 24 * 60 * 60;
/** Long window — "remember me" + the absolute cap on a remembered session (~30 days). */
export const SESSION_TTL_LONG_SEC = 30 * 24 * 60 * 60;

export interface SessionLifetime {
  /** JWT lifetime in seconds (also the absolute cap from first login). */
  tokenTtlSec: number;
  /**
   * Cookie Max-Age in seconds, or `undefined` for a browser SESSION cookie
   * (cleared when the browser closes) — the default when "remember me" is off.
   */
  cookieMaxAge: number | undefined;
}

export function sessionLifetime(rememberMe: boolean): SessionLifetime {
  return rememberMe
    ? { tokenTtlSec: SESSION_TTL_LONG_SEC, cookieMaxAge: SESSION_TTL_LONG_SEC }
    : { tokenTtlSec: SESSION_TTL_SHORT_SEC, cookieMaxAge: undefined };
}

/**
 * Whether a token minted at `loginAtMs` for a (non-)remembered session has
 * outlived its window as of `nowMs`. Enforced in the jwt callback so the
 * lifetime is real regardless of Auth.js's own encode-time exp handling.
 */
export function isSessionExpired(loginAtMs: number, rememberMe: boolean, nowMs: number): boolean {
  const { tokenTtlSec } = sessionLifetime(rememberMe);
  return nowMs - loginAtMs > tokenTtlSec * 1000;
}
