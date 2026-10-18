import { intlLocaleOf, type Locale } from './config';

/**
 * Locale-aware date/number formatting. Money stays in `formatIls()`
 * (lib/money.ts) — pass `{ locale }` there.
 *
 * Dates render in Israel time by default so a server render (UTC) and the
 * browser agree on the calendar day.
 */
const TZ = 'Asia/Jerusalem';

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: DateInput,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone: TZ, ...opts }).format(toDate(value));
}

export function formatDateTime(
  value: DateInput,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return formatDate(value, locale, { dateStyle: 'short', timeStyle: 'short', ...opts });
}

export function formatNumber(value: number, locale: Locale, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocaleOf(locale), opts).format(value);
}

export function formatPercent(value: number, locale: Locale, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(intlLocaleOf(locale), {
    style: 'percent',
    maximumFractionDigits,
  }).format(value);
}

/** "3 days ago" / "לפני 3 ימים" — relative to `now`. */
export function formatRelative(value: DateInput, locale: Locale, now: Date = new Date()): string {
  const diffSec = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocaleOf(locale), { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86400 * 365)), 'year');
}
