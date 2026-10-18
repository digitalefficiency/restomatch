/**
 * Cookie-consent state (E.3). A single first-party cookie records the visitor's
 * choice. Strictly-necessary cookies (Auth.js session/CSRF) are always set;
 * NON-essential / analytics cookies are gated behind an explicit opt-in.
 *
 * Values:
 *   'all'       — accepted analytics + necessary
 *   'necessary' — declined analytics; only strictly-necessary cookies
 */
export const CONSENT_COOKIE = 'rm_cookie_consent';
export const CONSENT_MAX_AGE_DAYS = 180;

export type ConsentChoice = 'all' | 'necessary';

/** Read the raw consent value from a cookie string (SSR-safe). */
export function readConsentFrom(cookieString: string | undefined | null): ConsentChoice | null {
  if (!cookieString) return null;
  const match = cookieString
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(CONSENT_COOKIE.length + 1));
  return value === 'all' || value === 'necessary' ? value : null;
}

/** Browser helper — current choice, or null if not yet decided. */
export function getConsentChoice(): ConsentChoice | null {
  if (typeof document === 'undefined') return null;
  return readConsentFrom(document.cookie);
}

/** Persist the choice as a first-party cookie. */
export function setConsentChoice(choice: ConsentChoice): void {
  if (typeof document === 'undefined') return;
  const maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

/**
 * Whether non-essential analytics may run. Callers that send analytics MUST gate
 * on this — analytics must never fire before an explicit opt-in.
 */
export function isAnalyticsConsented(): boolean {
  return getConsentChoice() === 'all';
}
