/**
 * Explicit Auth.js cookie pinning (D1.3).
 *
 * Auth.js v5 already derives HttpOnly + Secure + SameSite=Lax (and the
 * `__Secure-`/`__Host-` name prefixes) from the deployment URL. This module
 * makes that derivation EXPLICIT in code so it no longer silently depends on
 * runtime URL auto-detection — and gives Epic B (remember-me / 2FA) a single,
 * tested place to vary cookie lifetimes from.
 *
 * IMPORTANT — must reproduce the current Auth.js defaults EXACTLY: changing a
 * cookie NAME would invalidate every live session (a login outage). The names
 * and flags below mirror `@auth/core`'s `defaultCookies(useSecureCookies)`.
 *
 * Pure + dependency-free so it unit-tests without a Next runtime.
 */

type SameSite = 'lax' | 'strict' | 'none';

interface CookieOption {
  name: string;
  options: {
    httpOnly: boolean;
    sameSite: SameSite;
    path: string;
    secure: boolean;
  };
}

export interface AuthCookieConfig {
  sessionToken: CookieOption;
  callbackUrl: CookieOption;
  csrfToken: CookieOption;
}

interface SecureCookieEnv {
  AUTH_URL?: string;
  NEXTAUTH_URL?: string;
  APP_URL?: string;
  NODE_ENV?: string;
}

/**
 * Decide whether cookies must carry the Secure flag / secure name prefixes.
 *
 * Mirrors Auth.js: the canonical URL's protocol wins (https ⇒ secure, http ⇒
 * not), and when no URL is set we fall back to `NODE_ENV === 'production'`. This
 * yields the SAME result as today's auto-detection in every environment, so live
 * cookie names do not change.
 */
export function resolveUseSecureCookies(env: SecureCookieEnv = process.env): boolean {
  const url = env.AUTH_URL ?? env.NEXTAUTH_URL ?? env.APP_URL ?? '';
  if (url.startsWith('https://')) return true;
  if (url.startsWith('http://')) return false;
  return env.NODE_ENV === 'production';
}

/**
 * Build the explicit `cookies` block for NextAuth. Reproduces `@auth/core`
 * defaults: `__Secure-` prefix on the session/callback cookies and `__Host-` on
 * the CSRF cookie when secure; all HttpOnly + SameSite=Lax + path `/`.
 */
export function authCookieConfig(useSecureCookies: boolean): AuthCookieConfig {
  const sharedPrefix = useSecureCookies ? '__Secure-' : '';
  const hostPrefix = useSecureCookies ? '__Host-' : '';
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: useSecureCookies,
  };
  return {
    sessionToken: {
      name: `${sharedPrefix}authjs.session-token`,
      options: { ...baseOptions },
    },
    callbackUrl: {
      name: `${sharedPrefix}authjs.callback-url`,
      options: { ...baseOptions },
    },
    csrfToken: {
      name: `${hostPrefix}authjs.csrf-token`,
      options: { ...baseOptions },
    },
  };
}
