import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import type { Period } from './state';

/**
 * Human label for a view's resolved range [start, end): a month name for the
 * month periods, "1 Jan 2026 – 18 Oct 2026" otherwise (end is exclusive, so the
 * last day shown is end − 1 ms, in Israel time like every other dashboard date).
 */
export function rangeLabel(period: Period, startIso: string, endIso: string, locale: Locale, sep = ' – '): string {
  const lastDay = new Date(new Date(endIso).getTime() - 1);
  if (period === 'this_month' || period === 'last_month') {
    return formatDate(startIso, locale, { month: 'long', year: 'numeric' });
  }
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${formatDate(startIso, locale, opts)}${sep}${formatDate(lastDay, locale, opts)}`;
}

/** 'YYYY-MM-DD' of the instant's calendar day in Israel time (CSV cells). */
export function localDay(value: Date | string | number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

/** Short bucket label for a trend point (day → "12 Oct", month → "Oct 2026"). */
export function bucketLabel(bucket: 'day' | 'month', iso: string, locale: Locale): string {
  return bucket === 'day'
    ? formatDate(iso, locale, { day: 'numeric', month: 'short' })
    : formatDate(iso, locale, { month: 'short', year: 'numeric' });
}
