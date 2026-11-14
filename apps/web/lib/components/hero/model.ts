/**
 * The honest leak hero's rules (W1-05), kept pure so the home, the showcase and
 * the public leak check render the same states from the same numbers.
 *
 *  - Typed state: no data ("—", one CTA) · clean (T3 sentence) · leak (T1) ·
 *    pending-only (consolidated invoices waiting for a link, T4).
 *  - Thin base: under THIN_BASE_INVOICES checked invoices the ₪ shows, the % does not.
 *  - The delta compares the SAME day-span of the previous period (Oct 1–25 vs
 *    Sep 1–25), never a running month against a full one.
 */

export type LeakHeroState = 'noData' | 'clean' | 'leak' | 'pendingOnly';

/** Fewer checked invoices than this and a % of spend is noise. */
export const THIN_BASE_INVOICES = 5;

export interface HeroFigures {
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  invoiceCount: number;
  matchedInvoiceCount: number;
  pendingLinkCount: number;
  /** Receiving scans waiting for their receipt's count (not "no data": they will be checked). */
  awaitingCountCount?: number;
  /** G-08: invoices held for a "זה אותו מוצר?" question (they will be checked after the answer). */
  awaitingQuestionCount?: number;
}

export function leakHeroState(h: HeroFigures): LeakHeroState {
  if (h.leakIls > 0) return 'leak';
  if (h.matchedInvoiceCount > 0) return 'clean';
  if (h.pendingLinkCount > 0 || (h.awaitingCountCount ?? 0) > 0 || (h.awaitingQuestionCount ?? 0) > 0) return 'pendingOnly';
  return 'noData';
}

/** Show a % only on a real base (spend and enough checked invoices). */
export function showsPct(h: HeroFigures): boolean {
  return h.leakPct != null && h.spendIls > 0 && h.matchedInvoiceCount >= THIN_BASE_INVOICES;
}

export type DeltaDirection = 'up' | 'down' | 'same';

export interface HeroDelta {
  direction: DeltaDirection;
  /** |current − previous| in ₪. */
  amountIls: number;
  /** Signed relative change (−0.19 = 19% lower); null on a thin or empty base. */
  pct: number | null;
}

/**
 * Leak now vs the same day-span before. null when the previous span has no
 * invoices (nothing honest to compare with). A thin previous base keeps the ₪
 * difference but drops the % (₪20 → ₪60 is not "+200%").
 */
export function heroDelta(
  current: Pick<HeroFigures, 'leakIls'>,
  previous: Pick<HeroFigures, 'leakIls' | 'invoiceCount' | 'matchedInvoiceCount'> | null,
): HeroDelta | null {
  if (!previous || previous.invoiceCount === 0) return null;
  const diffAgorot = Math.round(current.leakIls * 100) - Math.round(previous.leakIls * 100);
  const direction: DeltaDirection = diffAgorot > 0 ? 'up' : diffAgorot < 0 ? 'down' : 'same';
  const thin = previous.matchedInvoiceCount < THIN_BASE_INVOICES || previous.leakIls <= 0;
  return {
    direction,
    amountIls: Math.abs(diffAgorot) / 100,
    pct: thin ? null : diffAgorot / Math.round(previous.leakIls * 100),
  };
}

/**
 * The calendar day-span a hero covers: [monthStart, monthEnd) as UTC instants
 * of local midnights → the first and last local day (for "1–25 בספטמבר").
 */
export function daySpan(monthStart: string, monthEnd: string): { from: Date; to: Date } {
  const from = new Date(monthStart);
  const to = new Date(new Date(monthEnd).getTime() - 1);
  // Guard a zero-length span (never shown, but never "25–24").
  return { from, to: to < from ? from : to };
}

/**
 * The hero's split, by payment status, so the parts add up to the hero to the
 * agora: the leak on invoices not yet marked paid (`caughtBeforePaymentIls`, where
 * payment can still be held) and the rest, on invoices already paid (a credit is
 * the only way back). Never a decision status — the engine's "caught" is the leak
 * on UNPAID invoices whatever their decision, so it is labelled as exactly that.
 */
export function leakSplit(h: { leakIls: number; caughtBeforePaymentIls: number }): { unpaidIls: number; paidIls: number } {
  const leak = Math.max(0, Math.round(h.leakIls * 100));
  const unpaid = Math.min(leak, Math.max(0, Math.round(h.caughtBeforePaymentIls * 100)));
  return { unpaidIls: unpaid / 100, paidIls: (leak - unpaid) / 100 };
}

/**
 * The hero's primary CTA is ALWAYS the secondary button (owner decision D9,
 * DS2-SPEC): red is reserved for act-now T2 items. The danger rail and border
 * carry the leak state; the button never does.
 */
export type HeroCtaVariant = 'secondary';
const HERO_CTA_VARIANT: Record<LeakHeroState, HeroCtaVariant> = {
  noData: 'secondary',
  clean: 'secondary',
  leak: 'secondary',
  pendingOnly: 'secondary',
};
export function heroCtaVariant(state: LeakHeroState): HeroCtaVariant {
  return HERO_CTA_VARIANT[state];
}
export const HERO_CTA_CLASS: Record<HeroCtaVariant, string> = {
  secondary: 'border border-line-strong bg-surface text-ink hover:border-primary/40 hover:text-primary',
};

/* ─────────────────────────── DS3 · the pace line ─────────────────────────── */

/** One day of `owner.leakTrend` (bucket 'day'): the UTC instant of a local midnight and that day's leak. */
export interface PacePoint {
  bucketStart: string;
  leakIls: number;
}

/**
 * The pace line's two series, as integer agorot running totals for days 1..`days`: this month
 * (`cur`) and the same days of last month (`prev`). Chart geometry only: no figure on the screen
 * is read from it, and the home draws it only when `cur`'s last value equals the hero to the agora.
 */
export interface PaceSeries {
  days: number;
  cur: number[];
  prev: number[] | null;
}

const IL_TZ = 'Asia/Jerusalem';

/** Day of the month (1–31) of an instant on the Israel wall clock, the zone every figure is dated in. */
export function israelDayOfMonth(value: Date | string | number): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: IL_TZ, day: 'numeric' }).format(new Date(value)));
}

function runningTotals(points: readonly PacePoint[], days: number): number[] {
  const perDay = new Array<number>(days).fill(0);
  for (const p of points) {
    const d = israelDayOfMonth(p.bucketStart);
    if (d >= 1 && d <= days) perDay[d - 1]! += Math.round(p.leakIls * 100);
  }
  let run = 0;
  return perDay.map((v) => (run += v));
}

/**
 * Sparse daily points (days without invoices are absent) → running totals day by day. The axis
 * runs from day 1 to today (or to the last dated day, if an invoice is dated later this month).
 * `null` before day 2: one day is a dot, not a pace.
 */
export function paceSeries(points: readonly PacePoint[], previous: readonly PacePoint[] | null, today: Date | string | number): PaceSeries | null {
  const lastPointDay = points.reduce((m, p) => Math.max(m, israelDayOfMonth(p.bucketStart)), 0);
  const days = Math.max(israelDayOfMonth(today), lastPointDay);
  if (days < 2) return null;
  return { days, cur: runningTotals(points, days), prev: previous ? runningTotals(previous, days) : null };
}

/** The reference's chart box (SPEC §10.1, ex1.html): x from 0 to 240, the baseline at y 64, the top at y 2. */
export const PACE_BOX = { viewBox: '-2 -6 250 78', width: 240, baseline: 64, top: 2 } as const;

/**
 * A step-after path of a running total ("M0,64 V… H… V…"): each total holds until the next day it
 * changes, then rises. Time runs left to right in every language (charts never mirror).
 */
export function pacePath(totals: readonly number[], max: number): string {
  const n = totals.length;
  const x = (i: number) => (n <= 1 ? 0 : (i * PACE_BOX.width) / (n - 1));
  const y = (v: number) => PACE_BOX.baseline - (max > 0 ? (v / max) * (PACE_BOX.baseline - PACE_BOX.top) : 0);
  const r = (v: number) => Math.round(v * 10) / 10;
  let d = `M0,${PACE_BOX.baseline}`;
  totals.forEach((v, i) => {
    if (i > 0) d += ` H${r(x(i))}`;
    d += ` V${r(y(v))}`;
  });
  return d;
}

/** Geometry of the whole chart: both paths on one scale and the end dot on today's total. */
export function paceGeometry(s: PaceSeries): { cur: string; prev: string | null; end: { x: number; y: number } } {
  const last = (xs: readonly number[]) => xs[xs.length - 1] ?? 0;
  const max = Math.max(last(s.cur), s.prev ? last(s.prev) : 0, 1);
  const endY = PACE_BOX.baseline - (last(s.cur) / max) * (PACE_BOX.baseline - PACE_BOX.top);
  return {
    cur: pacePath(s.cur, max),
    prev: s.prev ? pacePath(s.prev, max) : null,
    end: { x: PACE_BOX.width, y: Math.round(endY * 10) / 10 },
  };
}

/* ─────────────────────────── DS3 · motion helpers ─────────────────────────── */

/** "400ms" / "0.4s" (the motion tokens) → milliseconds. */
export function msOf(token: string): number {
  const m = /^([\d.]+)(ms|s)$/.exec(token.trim());
  if (!m) return 0;
  return m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
}

/** "cubic-bezier(0,0,0.38,0.9)" (an easing token) → its four control values, or null. */
export function parseCubicBezier(token: string): [number, number, number, number] | null {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(token.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

/**
 * The CSS cubic-bezier timing function, for the one motion CSS cannot run: a number counting to
 * its value (SPEC §8). x(t) is solved by bisection; precise to well under a frame.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = progress;
    for (let i = 0; i < 40; i++) {
      t = (lo + hi) / 2;
      const x = at(x1, x2, t);
      if (Math.abs(x - progress) < 1e-6) break;
      if (x < progress) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}
