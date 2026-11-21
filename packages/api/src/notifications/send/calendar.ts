/** Restaurant-calendar helpers (pure). Never the UTC day. */
export const DEFAULT_TZ = 'Asia/Jerusalem';

/** `YYYY-MM-DD` of `at` in `tz`. */
export function localDateKey(at: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Whole calendar days from `from` to `to` in `tz` (to − from). */
export function calendarDaysBetween(from: Date, to: Date, tz: string = DEFAULT_TZ): number {
  const a = Date.parse(`${localDateKey(from, tz)}T00:00:00Z`);
  const b = Date.parse(`${localDateKey(to, tz)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
