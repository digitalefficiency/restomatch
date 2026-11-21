import { addCalendarDaysInTz, atLocalTimeInTz, localDateKeyInTz } from '../../lib/time';

/**
 * The zone a test restaurant runs in: `restaurants.timezone` defaults to
 * 'Asia/Jerusalem' (schema), and the day-scoped routers fall back to the same
 * DEFAULT_TZ (receiving.todayExpectations, orders).
 */
export const RESTAURANT_TZ = 'Asia/Jerusalem';

/**
 * "Today at HH:00" on the RESTAURANT'S calendar day, as a UTC instant.
 *
 * Fixtures must not build "today" with `new Date().setHours(h)`: that is the
 * runner's day (UTC on CI), which is a different calendar day from the
 * Israeli one every night 00:00–02:00 IST / 00:00–03:00 IDT (22:00/21:00–24:00Z).
 * In that window a PO "scheduled for today" lands on yesterday's Israeli day and
 * drops out of `receiving.todayExpectations`, so the test fails on the clock,
 * not on the code.
 *
 * Built on the product's own day math (`lib/time.ts`), so the fixture's day is
 * the same day the router computes. DST-safe: the wall-clock hour is resolved
 * through the zone's offset at that hour. `dayOffset` moves whole calendar days
 * in the zone (−1 = the restaurant's yesterday at the same local hour).
 */
export function restaurantTodayAt(
  hour: number,
  opts: { dayOffset?: number; tz?: string; now?: Date } = {},
): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`restaurantTodayAt: hour must be an integer 0–23, got ${hour}`);
  }
  const tz = opts.tz ?? RESTAURANT_TZ;
  const at = atLocalTimeInTz(opts.now ?? new Date(), tz, hour, 0);
  return opts.dayOffset ? addCalendarDaysInTz(at, opts.dayOffset, tz) : at;
}

/**
 * `now` moved back `days` CALENDAR days in the restaurant's zone, at the same
 * local wall-clock time — "N days ago" for a rule that counts calendar days
 * (e.g. a claim is overdue after more than OVERDUE_DAYS calendar days).
 *
 * Never `Date.now() - days * 86_400_000`: across a DST change a local day is 23 h
 * or 25 h long. For a week after the autumn change, "8 × 24 h ago" seen at
 * 23:00–24:00 is only 7 calendar days back, so a calendar-day rule correctly
 * says "not yet" and the test fails on the clock, not on the code.
 */
export function restaurantDaysAgo(
  days: number,
  opts: { tz?: string; now?: Date } = {},
): Date {
  return addCalendarDaysInTz(opts.now ?? new Date(), -days, opts.tz ?? RESTAURANT_TZ);
}

/**
 * 'YYYY-MM-DD' of the restaurant's today (or `dayOffset` calendar days away) —
 * the calendar day a period filter (`from`/`to`, read in the restaurant's zone)
 * must name to contain a row dated with `restaurantTodayAt`. Never
 * `new Date().toISOString().slice(0, 10)`: that is the UTC day, i.e. the
 * restaurant's yesterday every night after local midnight.
 */
export function restaurantDateKey(
  opts: { dayOffset?: number; tz?: string; now?: Date } = {},
): string {
  return localDateKeyInTz(restaurantTodayAt(12, opts), opts.tz ?? RESTAURANT_TZ);
}

/**
 * 'YYYY-MM' of the restaurant's current month — the month the leak hero and the
 * monthly report treat as "this month". The runner's `getFullYear()/getMonth()`
 * is still last month on the 1st between local midnight and 02:00/03:00.
 */
export function restaurantMonthKey(opts: { tz?: string; now?: Date } = {}): string {
  return restaurantDateKey(opts).slice(0, 7);
}
