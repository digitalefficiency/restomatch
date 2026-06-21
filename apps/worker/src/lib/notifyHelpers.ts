/**
 * Shared helpers for notification worker jobs (supplier-delays, order-reminders).
 *
 * IL day boundaries reuse the vetted `startOfDayInTz` from @restomatch/api
 * (wave-0 tz fix) rather than re-deriving offset math here — the latter is where
 * the known timezone bugs lived.
 */
import { startOfDayInTz } from '@restomatch/api';

export const IL_TZ = 'Asia/Jerusalem';

/** Start of the Asia/Jerusalem calendar day containing `ref`, as a UTC Date. */
export function startOfIlDay(ref: Date): Date {
  return startOfDayInTz(ref, IL_TZ);
}

/** Hebrew weekday number for `ref` in IL time: 0 = Sunday … 6 = Saturday. */
export function ilWeekday(ref: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: IL_TZ, weekday: 'short' }).format(ref);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? ref.getDay();
}

const HE_WEEKDAYS = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
  'שבת',
] as const;

/** Hebrew weekday label, e.g. "יום ראשון". */
export function ilWeekdayLabel(ref: Date): string {
  return HE_WEEKDAYS[ilWeekday(ref)] ?? '';
}

/** Localized IL date+time label, e.g. "21.6.2026, 14:30". */
export function formatIlDate(ref: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: IL_TZ,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ref);
}

/**
 * Format an agorot-safe shekel amount for email copy, e.g. "₪1,240".
 * Whole shekels by default (emails are headlines, not ledgers).
 */
export function formatIlsAmount(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Public app base URL for deep links in emails (no trailing slash). */
export function appBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ?? process.env.AUTH_URL ?? 'https://app.restomatch.co.il';
  return raw.replace(/\/+$/, '');
}
