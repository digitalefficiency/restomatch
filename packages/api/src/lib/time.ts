/**
 * Timezone-correct day/cutoff math.
 *
 * All day-boundary and calendar-day arithmetic in RestoMatch must anchor to the
 * RESTAURANT'S wall clock, not the server's local time (which on a deployed box
 * is UTC). These helpers take a reference UTC instant + an IANA timezone string
 * and return UTC instants that correspond to local wall-clock boundaries.
 *
 * DST correctness: we NEVER do `date.getTime() ± 86_400_000`. A day is not
 * always 86.4M ms — spring-forward days are 23h, fall-back days are 25h. Instead
 * we read the zone's actual UTC offset at the relevant instant via
 * Intl.DateTimeFormat#formatToParts and solve for the instant whose local
 * representation matches the target wall-clock fields. No new npm dependency.
 */

/** The local wall-clock fields of a UTC instant, as seen in a given timezone. */
interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

/**
 * Decompose a UTC instant into the wall-clock fields shown in `tz`.
 * Uses the 24-hour `en-CA`-style formatting so parts are unambiguous.
 */
function getLocalParts(instant: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(instant);
  const grab = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: grab('year'),
    month: grab('month'),
    day: grab('day'),
    hour: grab('hour'),
    minute: grab('minute'),
    second: grab('second'),
  };
}

/**
 * The signed UTC offset (in ms) of `tz` at the moment `instant`.
 * Positive east of UTC (e.g. Asia/Jerusalem winter = +2h = +7_200_000).
 */
function tzOffsetMs(instant: Date, tz: string): number {
  const lp = getLocalParts(instant, tz);
  // Interpret the local wall-clock fields AS IF they were UTC, then compare to
  // the real instant. The difference is the zone's offset at that instant.
  const asUtc = Date.UTC(lp.year, lp.month - 1, lp.day, lp.hour, lp.minute, lp.second);
  // instant truncated to whole seconds (formatToParts has no sub-second parts).
  const instantSec = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - instantSec;
}

/**
 * Find the UTC instant corresponding to a specific local wall-clock time
 * (y/m/d h:m:s) in `tz`. Solves the offset fixed-point: the offset can differ
 * between the naive guess and the real instant across a DST transition, so we
 * iterate once (sufficient for all real-world IANA zones).
 */
function utcFromLocalFields(
  tz: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // First guess: subtract the offset measured at the naive instant.
  let offset = tzOffsetMs(new Date(naiveUtc), tz);
  let candidate = naiveUtc - offset;
  // Re-measure at the candidate; if the offset changed (DST edge), correct once.
  const offset2 = tzOffsetMs(new Date(candidate), tz);
  if (offset2 !== offset) {
    offset = offset2;
    candidate = naiveUtc - offset;
  }
  return new Date(candidate);
}

/**
 * UTC instant of the START of the local day (00:00:00.000 wall clock in `tz`)
 * that CONTAINS `refUtc`.
 */
export function startOfDayInTz(refUtc: Date, tz: string): Date {
  const lp = getLocalParts(refUtc, tz);
  return utcFromLocalFields(tz, lp.year, lp.month, lp.day, 0, 0, 0, 0);
}

/**
 * UTC instant of the END of the local day (23:59:59.999 wall clock in `tz`)
 * that CONTAINS `refUtc`.
 */
export function endOfDayInTz(refUtc: Date, tz: string): Date {
  const lp = getLocalParts(refUtc, tz);
  return utcFromLocalFields(tz, lp.year, lp.month, lp.day, 23, 59, 59, 999);
}

/**
 * Add `n` CALENDAR days to `d`, preserving the local wall-clock time-of-day in
 * `tz`. DST-safe: a +1 across spring-forward is 23h, across fall-back is 25h,
 * but the local clock time is held constant. `n` may be negative.
 */
export function addCalendarDaysInTz(d: Date, n: number, tz: string): Date {
  const lp = getLocalParts(d, tz);
  // Normalise the target calendar date via UTC date arithmetic on the wall-clock
  // Y/M/D (no offset involved — this is pure calendar counting), then resolve
  // back to a UTC instant at the same local time-of-day.
  const shifted = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + n));
  return utcFromLocalFields(
    tz,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    lp.hour,
    lp.minute,
    lp.second,
    0,
  );
}
