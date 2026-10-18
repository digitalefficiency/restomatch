/**
 * Locale contract for the web app (Hebrew-first, English second).
 *
 * Edge-safe (pure) — imported by middleware, server components and client
 * components alike. The active locale lives in the `rm_locale` cookie; anything
 * unknown falls back to Hebrew, the product's default market.
 */
export const LOCALES = ['he', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'he';
export const LOCALE_COOKIE = 'rm_locale';
/** One year — the switcher is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;
/** `?lang=en` on any page sets the cookie (shareable English links). */
export const LOCALE_QUERY_PARAM = 'lang';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function dirOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr';
}

/** BCP-47 tag for Intl formatters. English uses en-GB (dd/mm/yyyy, like Israel). */
export function intlLocaleOf(locale: Locale): string {
  return locale === 'he' ? 'he-IL' : 'en-GB';
}

/** Read the locale out of a raw `Cookie` header (edge + node). */
export function localeFromCookieHeader(cookieHeader: string | null | undefined): Locale {
  if (!cookieHeader) return DEFAULT_LOCALE;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LOCALE_COOKIE) return resolveLocale(decodeURIComponent(rest.join('=')));
  }
  return DEFAULT_LOCALE;
}

/** Return a `Cookie` header with `rm_locale` set to `locale` (replacing any old value). */
export function withLocaleCookie(cookieHeader: string | null | undefined, locale: Locale): string {
  const kept = (cookieHeader ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${LOCALE_COOKIE}=`));
  return [...kept, `${LOCALE_COOKIE}=${locale}`].join('; ');
}
