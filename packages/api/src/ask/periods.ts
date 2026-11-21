/**
 * G-12b — every Ask fact carries its period. A figure without `{from, through,
 * complete}` cannot be compared fairly, so every period tool returns one, and a
 * delta always ships with its span label ("1–25 באוק׳ מול 1–25 בספט׳").
 *
 * Days are LOCAL to the restaurant (`restaurants.timezone`, default
 * Asia/Jerusalem), inclusive, 'YYYY-MM-DD'. `complete` = the period is the whole
 * calendar month and that month is over. A month to date, or a part of a month,
 * is not complete.
 */
import { eq, restaurants, type Database } from '@restomatch/db';

export const DEFAULT_TZ = 'Asia/Jerusalem';

export interface Period {
  /** First local day, inclusive. */
  from: string;
  /** Last local day, inclusive. */
  through: string;
  /** The whole calendar month, and it is over. */
  complete: boolean;
}

export async function restaurantTimezone(db: Database, restaurantId: string): Promise<string> {
  const [r] = await db
    .select({ tz: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return r?.tz || DEFAULT_TZ;
}

/** 'YYYY-MM-DD' of an instant in `tz`. */
export function localDay(d: Date | string, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(d));
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

function ymd(day: string): [number, number, number] {
  return day.split('-').map(Number) as [number, number, number];
}
/** [year, month 1..12] of `offset` months from `day`'s month. */
function shiftMonth(y: number, m: number, offset: number): [number, number] {
  const idx = y * 12 + (m - 1) + offset;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

/** 'YYYY-MM' of `offset` months from now, in the restaurant's time zone. */
export function monthKey(offset = 0, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const [y, m] = ymd(localDay(now, tz));
  const [yy, mm] = shiftMonth(y, m, offset);
  return `${yy}-${pad(mm)}`;
}

/** The period a month tool covers: the whole month when it is over, else 1st → today. */
export function monthPeriod(
  offset: number,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): Period {
  const today = localDay(now, tz);
  const [y, m] = ymd(today);
  const [yy, mm] = shiftMonth(y, m, offset);
  const from = `${yy}-${pad(mm)}-01`;
  const last = `${yy}-${pad(mm)}-${pad(daysIn(yy, mm))}`;
  if (offset < 0) return { from, through: last, complete: true };
  return { from, through: today < last ? today : last, complete: false };
}

/**
 * Like for like: this month from the 1st to today, against the SAME days of the
 * previous month (clamped to its length: 31.10 → 1–30.09; 30.10 → 1–30.09).
 * When `monthOffset` < 0 the current window is that closed month in full,
 * against the full month before it.
 */
export function alignedWindows(
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
  monthOffset = 0,
): { cur: Period; prev: Period } {
  if (monthOffset < 0)
    return { cur: monthPeriod(monthOffset, now, tz), prev: monthPeriod(monthOffset - 1, now, tz) };
  const cur = monthPeriod(0, now, tz);
  const [y, m, d] = ymd(cur.through);
  const [py, pm] = shiftMonth(y, m, -1);
  const prevLast = daysIn(py, pm);
  const prevThrough = Math.min(d, prevLast);
  // A previous span that reaches the end of its month is that month in full (and it is over).
  return {
    cur,
    prev: {
      from: `${py}-${pad(pm)}-01`,
      through: `${py}-${pad(pm)}-${pad(prevThrough)}`,
      complete: prevThrough === prevLast,
    },
  };
}

/** U+2060 WORD JOINER: invisible, no break. `plainLabel()` strips it for comparisons. */
export const WJ = '\u2060';
export const plainLabel = (s: string) => s.replace(/\u2060/g, '');

const HE_MONTHS = [
  'ינו׳',
  'פבר׳',
  'מרץ',
  'אפר׳',
  'מאי',
  'יוני',
  'יולי',
  'אוג׳',
  'ספט׳',
  'אוק׳',
  'נוב׳',
  'דצמ׳',
];
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "1–25 בספט׳" / "Sep 1–25" — always the days, so a reader sees what was compared. */
export function spanLabel(p: Period, locale: 'he' | 'en'): string {
  const [, m, d1] = ymd(p.from);
  const [, , d2] = ymd(p.through);
  // Word joiners keep "1–25" on one line (an en dash is a line-break opportunity).
  const days = d1 === d2 ? `${d1}` : `${d1}${WJ}–${WJ}${d2}`;
  return locale === 'he' ? `${days} ב${HE_MONTHS[m - 1]}` : `${EN_MONTHS[m - 1]} ${days}`;
}

/** "1–25 באוק׳ מול 1–25 בספט׳" / "Oct 1–25 vs Sep 1–25". */
export function comparisonLabel(cur: Period, prev: Period, locale: 'he' | 'en'): string {
  return locale === 'he'
    ? `${spanLabel(cur, 'he')} מול ${spanLabel(prev, 'he')}`
    : `${spanLabel(cur, 'en')} vs ${spanLabel(prev, 'en')}`;
}

/**
 * Two periods compare fairly when both are whole closed months, or both run from
 * the 1st over the same days — where a whole month that is shorter counts as
 * "the same days" (31.10 to date vs all of September is like for like).
 */
export function fairlyComparable(a: Period, b: Period): boolean {
  if (a.complete && b.complete) return true;
  if (ymd(a.from)[2] !== 1 || ymd(b.from)[2] !== 1)
    return ymd(a.from)[2] === ymd(b.from)[2] && ymd(a.through)[2] === ymd(b.through)[2];
  const ad = ymd(a.through)[2];
  const bd = ymd(b.through)[2];
  if (ad === bd) return true;
  // Clamped: the whole (complete) month ends before the other's day.
  if (a.complete && !b.complete) return bd >= ad;
  if (b.complete && !a.complete) return ad >= bd;
  return false;
}
