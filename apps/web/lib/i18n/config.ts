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

/**
 * Receiver languages (wave 1, flag `receiverLanguages`): the foreign workers who
 * receive deliveries. Only the receiver experience (receiving wizard, invoice /
 * PO lines, nav, login) is translated into them — every other screen falls back
 * to English (see translate.ts). Formatting (dates, numbers, ₪) follows the
 * BASE locale (`baseLocaleOf`), so existing `Locale` code sees 'en' for them.
 */
export const RECEIVER_LOCALES = ['ar', 'ru', 'th', 'ti'] as const;
export type ReceiverLocale = (typeof RECEIVER_LOCALES)[number];
/** Every locale the UI can render in (cookie / `?lang=` / preferred_locale). */
export const APP_LOCALES = [...LOCALES, ...RECEIVER_LOCALES] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** Native names for the language picker. */
export const LOCALE_NATIVE_NAMES: Record<AppLocale, string> = {
  he: 'עברית',
  en: 'English',
  ar: 'العربية',
  ru: 'Русский',
  th: 'ไทย',
  ti: 'ትግርኛ',
};

export function isReceiverLocale(value: unknown): value is ReceiverLocale {
  return typeof value === 'string' && (RECEIVER_LOCALES as readonly string[]).includes(value);
}

export function isAppLocale(value: unknown): value is AppLocale {
  return isLocale(value) || isReceiverLocale(value);
}

/** The he/en locale used for formatting and for every non-receiver string. */
export function baseLocaleOf(locale: AppLocale): Locale {
  return isLocale(locale) ? locale : 'en';
}

/** A receiver locale resolves to English here (base locale); anything unknown → Hebrew. */
export function resolveLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  return isReceiverLocale(value) ? 'en' : DEFAULT_LOCALE;
}

export function resolveAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The language of the FIRST paint: the device's choice (the `rm_locale`
 * cookie — the switcher always wins on that device); with none, the signed-in
 * member's saved language. Before, a device without the cookie painted Hebrew
 * and switched after LocaleSync's refresh (a visible he → en flash).
 */
export function pickAppLocale(cookieValue: string | undefined | null, memberLocale: string | undefined | null): AppLocale {
  if (isAppLocale(cookieValue)) return cookieValue;
  return resolveAppLocale(memberLocale);
}

export function dirOf(locale: AppLocale): 'rtl' | 'ltr' {
  return locale === 'he' || locale === 'ar' ? 'rtl' : 'ltr';
}

/** BCP-47 tag for Intl formatters. English uses en-GB (dd/mm/yyyy, like Israel). */
export function intlLocaleOf(locale: Locale): string {
  return locale === 'he' ? 'he-IL' : 'en-GB';
}

/** Read the raw (app) locale out of a `Cookie` header (edge + node). */
export function appLocaleFromCookieHeader(cookieHeader: string | null | undefined): AppLocale {
  if (!cookieHeader) return DEFAULT_LOCALE;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LOCALE_COOKIE) return resolveAppLocale(decodeURIComponent(rest.join('=')));
  }
  return DEFAULT_LOCALE;
}

/** Read the (base) locale out of a raw `Cookie` header (edge + node). */
export function localeFromCookieHeader(cookieHeader: string | null | undefined): Locale {
  if (!cookieHeader) return DEFAULT_LOCALE;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LOCALE_COOKIE) return resolveLocale(decodeURIComponent(rest.join('=')));
  }
  return DEFAULT_LOCALE;
}

/** Return a `Cookie` header with `rm_locale` set to `locale` (replacing any old value). */
export function withLocaleCookie(cookieHeader: string | null | undefined, locale: AppLocale): string {
  const kept = (cookieHeader ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${LOCALE_COOKIE}=`));
  return [...kept, `${LOCALE_COOKIE}=${locale}`].join('; ');
}
