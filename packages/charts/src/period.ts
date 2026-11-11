import type { Database } from '@restomatch/db';
import { computeLeakSummary, type ViewSpec } from './leak-views';
import type { LeakHero } from './leak-hero';

/**
 * W2-09c · one period grammar (deep-fix class 9: "no delta without its span").
 *
 * `resolveWindow` is the pure, labelled form of the SQL `boundsCte`: local
 * calendar dates in the restaurant's time zone, inclusive. While a period runs,
 * the current window ends today and the previous one covers the same days
 * (1–25.10 vs 1–25.09; on 31.10 vs 1–30.09: clamped to the shorter month);
 * after close it is full vs full. `computeLeakComparison` runs both windows
 * through the same `computeLeakSummary` (so the ₪ is the hero's definition)
 * and adds coverage: how many of each window's invoices were checked.
 */

export interface DateSpan {
  /** Inclusive local dates, 'YYYY-MM-DD'. */
  from: string;
  to: string;
}

export interface ResolvedWindow {
  current: DateSpan;
  previous: DateSpan;
  /** The period is still running (its window ends today, not at its natural end). */
  running: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Days in month m (1-12) of year y. */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parse = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });
const addDays = (s: string, n: number) => {
  const { y, m, d } = parse(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
const spanDays = (a: string, b: string) => {
  const p = parse(a);
  const q = parse(b);
  return Math.round((Date.UTC(q.y, q.m - 1, q.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86_400_000) + 1;
};
/** Shift a date by whole months, clamping the day to the target month (31.03 − 1 month = 28/29.02). */
const shiftMonths = (s: string, n: number) => {
  const { y, m, d } = parse(s);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth() + 1;
  return ymd(ty, tm, Math.min(d, daysIn(ty, tm)));
};
const minDate = (a: string, b: string) => (a <= b ? a : b);

/** Today's local date in `tz`. */
export function localToday(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** The period's natural span and its calendar step in months (null = a length shift). */
function naturalSpan(view: Pick<ViewSpec, 'period' | 'from' | 'to'>, today: string): { span: DateSpan; step: number | null } {
  const { y, m } = parse(today);
  switch (view.period) {
    case 'this_month':
      return { span: { from: ymd(y, m, 1), to: ymd(y, m, daysIn(y, m)) }, step: 1 };
    case 'last_month': {
      const from = shiftMonths(ymd(y, m, 1), -1);
      const p = parse(from);
      return { span: { from, to: ymd(p.y, p.m, daysIn(p.y, p.m)) }, step: 1 };
    }
    case 'quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      const end = shiftMonths(ymd(y, qm, 1), 2);
      const e = parse(end);
      return { span: { from: ymd(y, qm, 1), to: ymd(e.y, e.m, daysIn(e.y, e.m)) }, step: 3 };
    }
    case 'ytd':
      return { span: { from: ymd(y, 1, 1), to: today }, step: null };
    case 'last_12m': {
      const from = shiftMonths(ymd(y, m, 1), -11);
      return { span: { from, to: ymd(y, m, daysIn(y, m)) }, step: 12 };
    }
    case 'custom': {
      if (!view.from || !view.to) throw new Error('custom period needs from/to as YYYY-MM-DD');
      const [a, b] = view.from <= view.to ? [view.from, view.to] : [view.to, view.from];
      return { span: { from: a, to: b }, step: null };
    }
  }
}

/** The current and previous windows of a view, as local inclusive dates. Mirrors `boundsCte` (compare 'prev'). */
export function resolveWindow(
  view: Pick<ViewSpec, 'period' | 'from' | 'to'>,
  now: Date,
  tz = 'Asia/Jerusalem',
): ResolvedWindow {
  const today = localToday(now, tz);
  const { span, step } = naturalSpan(view, today);
  const running = span.from <= today && today < span.to;
  const current = { from: span.from, to: running ? today : span.to };
  let previous: DateSpan;
  if (step != null) {
    const pFrom = shiftMonths(span.from, -step);
    const pEnd = addDays(shiftMonths(addDays(span.to, 1), -step), -1); // the shifted period's last day
    // Running: the same days of the shifted period (clamped to its length); closed: the whole shifted period.
    previous = { from: pFrom, to: running ? minDate(shiftMonths(current.to, -step), pEnd) : pEnd };
  } else {
    // A length shift: the same number of days, right before (ytd, custom).
    const len = spanDays(span.from, minDate(span.to, running ? today : span.to));
    const pTo = addDays(span.from, -1);
    previous = { from: addDays(pTo, -(len - 1)), to: pTo };
  }
  return { current, previous, running };
}

/** How much of a window was measured: checked (PO-linked) invoices of all its invoices. */
export interface Coverage {
  checked: number;
  invoices: number;
}

/** The ₪ display contract's measured state (class 10). `partial` = some of the window's invoices are not checked yet. */
export type MeasuredState = 'noData' | 'partial' | 'clean' | 'leak';

export function measuredStateOf(w: { leakIls: number } & Coverage): MeasuredState {
  if (w.checked <= 0 && w.leakIls <= 0) return 'noData';
  if (w.checked < w.invoices) return 'partial';
  return w.leakIls > 0 ? 'leak' : 'clean';
}

export interface LeakComparisonWindow extends DateSpan, Coverage {
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  state: MeasuredState;
}

export interface LeakComparison {
  current: LeakComparisonWindow;
  previous: LeakComparisonWindow;
  running: boolean;
  /** current − previous leak, in agorot (integer). */
  deltaAgorot: number;
  /** Relative change; null when the previous leak is 0 or the coverage differs materially. */
  deltaPct: number | null;
  /** False when the windows' coverage differs by more than COVERAGE_GAP: the % would mislead. */
  comparable: boolean;
}

/** Coverage difference (in share of invoices checked) above which a % change is hidden. */
export const COVERAGE_GAP = 0.2;

const share = (c: Coverage) => (c.invoices > 0 ? c.checked / c.invoices : 1);
const windowOf = (span: DateSpan, h: LeakHero): LeakComparisonWindow => {
  const cov = { checked: h.matchedInvoiceCount, invoices: h.invoiceCount };
  return { ...span, ...cov, leakIls: h.leakIls, spendIls: h.spendIls, leakPct: h.leakPct, state: measuredStateOf({ leakIls: h.leakIls, ...cov }) };
};

/** The view's current window vs the same span before it, with coverage. The ₪ is `computeLeakSummary`'s. */
export async function computeLeakComparison(
  db: Database,
  restaurantId: string,
  view: ViewSpec,
  tz = 'Asia/Jerusalem',
): Promise<LeakComparison> {
  const now = view.now ?? new Date();
  const spec = { ...view, now };
  const [cur, prev] = await Promise.all([
    computeLeakSummary(db, restaurantId, spec, 'off'),
    computeLeakSummary(db, restaurantId, spec, 'prev'),
  ]);
  const w = resolveWindow(view, now, tz);
  const current = windowOf(w.current, cur);
  const previous = windowOf(w.previous, prev);
  const deltaAgorot = Math.round(current.leakIls * 100) - Math.round(previous.leakIls * 100);
  const comparable = Math.abs(share(current) - share(previous)) <= COVERAGE_GAP;
  const deltaPct = comparable && previous.leakIls > 0 ? deltaAgorot / Math.round(previous.leakIls * 100) : null;
  return { current, previous, running: w.running, deltaAgorot, deltaPct, comparable };
}
