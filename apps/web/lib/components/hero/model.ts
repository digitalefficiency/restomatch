import type { PaceSeries } from '../data-viz';

/**
 * The honest leak hero's rules (W1-05, DS3 SPEC §10.1), kept pure so the home, the showcase and
 * the public leak check render the same states from the same numbers.
 *
 *  - Typed state: no data ("—", one CTA) · clean (T3 sentence) · leak (T1) ·
 *    pending-only (consolidated invoices waiting for a link, T4).
 *  - Thin base: under THIN_BASE_INVOICES checked invoices the ₪ shows, the % does not.
 *  - The delta compares the SAME day-span of the previous period (Oct 1–25 vs
 *    Sep 1–25), never a running month against a full one.
 *
 * Nothing here computes a ₪ that is shown: the figures come from the procedures. The integer
 * agorot below are for checks (the pace line ends on the hero, the calculation panel matches it)
 * and for the G-16 markers, never for a label.
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
 * DS2-SPEC): red is reserved for act-now T2 items. In the clean finish the leak
 * state is carried by the 8 px dot beside the label; the button never carries it.
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
/** The secondary button's look (SPEC §5: white with a strong border), for a caller that cannot use LinkButton. */
export const HERO_CTA_CLASS: Record<HeroCtaVariant, string> = {
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-hover',
};

/* ─────────────────────────── agorot, for checks and markers ─────────────────────────── */

/** Integer agorot of a ₪ figure as a procedure returned it (2 dp). For checks and data markers only. */
export function agorotOf(ils: number): number {
  return Math.round(ils * 100);
}

/* ─────────────────────────── DS3 · the split ─────────────────────────── */

/**
 * The two-part bar and its legend need both parts at ₪0.50 or more: a smaller part would print
 * as "₪0" beside a visible segment (Money inline rounds to the shekel), so the hero says the
 * whole sum sits on one side instead (v2 C2).
 */
export const SPLIT_MIN_AGOROT = 50;

export type HeroSplitForm =
  /** Nothing to split. */
  | { kind: 'none' }
  /** Parts without exact agorot (the showcase's strings): the legend alone, no bar. */
  | { kind: 'legend' }
  /** Both parts at ₪0.50 or more: the bar and the legend, sized by the agorot. */
  | { kind: 'bar'; first: number; second: number }
  /** (Almost) all of the sum on one side: one line about part `index`. */
  | { kind: 'single'; index: 0 | 1 };

/** Which form the hero's split takes, from the parts' exact agorot (when they carry them). */
export function heroSplitForm(parts: ReadonlyArray<{ agorot?: number | null }> | null | undefined): HeroSplitForm {
  if (!parts || parts.length === 0) return { kind: 'none' };
  const exact = parts.every((p) => typeof p.agorot === 'number' && Number.isFinite(p.agorot));
  if (!exact || parts.length !== 2) return { kind: 'legend' };
  const a = parts[0]!.agorot as number;
  const b = parts[1]!.agorot as number;
  if (a >= SPLIT_MIN_AGOROT && b >= SPLIT_MIN_AGOROT) return { kind: 'bar', first: a, second: b };
  return { kind: 'single', index: b > a ? 1 : 0 };
}

/* ─────────────────────────── DS3 · the calculation panel ─────────────────────────── */

/**
 * The 'YYYY-MM' that owner.leakReport takes for the hero's month (v2 A1). The hero's bounds are
 * the UTC instants of local midnights, so `monthStart.slice(0, 7)` is the PREVIOUS month in
 * Israel (1.11 00:00 local = 31.10 22:00Z); the middle of the month is in the right one, in any
 * zone. null when the bounds do not parse.
 */
export function heroMonthKey(monthStart: string, monthEnd: string): string | null {
  const mid = (Date.parse(monthStart) + Date.parse(monthEnd)) / 2;
  return Number.isFinite(mid) ? new Date(mid).toISOString().slice(0, 7) : null;
}

/** What the calculation panel reads from owner.leakReport (the procedure's own type fits it). */
export interface CalcReport {
  hero: { monthStart: string; leakIls: number };
  byType: ReadonlyArray<{ amountIls: number }>;
  /** Σ rows − hero (≥ 0): what the per-invoice cap removed. */
  capAdjustmentIls: number;
}

/**
 * The panel's rows may stand under the hero only when they prove THIS hero (v4 H3): the report
 * covers the hero's month, its total is the hero's figure to the agora (a match landing between
 * the two reads changes it), and its rows minus the cap make its total (the server's identity).
 * Otherwise the panel says the sum changed since the page loaded and offers a refresh.
 */
export function calcRowsGuard(report: CalcReport, heroMonthStart: string, heroAgorot: number): boolean {
  const reportStart = Date.parse(report.hero.monthStart);
  if (!Number.isFinite(reportStart) || reportStart !== Date.parse(heroMonthStart)) return false;
  const total = agorotOf(report.hero.leakIls);
  if (total !== heroAgorot) return false;
  const rows = report.byType.reduce((sum, row) => sum + agorotOf(row.amountIls), 0);
  return rows - agorotOf(report.capAdjustmentIls) === total;
}

/* ─────────────────────────── DS3 · the pace line's data ─────────────────────────── */

/** One day of `owner.leakTrend` (bucket 'day'): the UTC instant of a local midnight and that day's leak. */
export interface PacePoint {
  bucketStart: string;
  leakIls: number;
}

export const DAY_MS = 86_400_000;
const IL_TZ = 'Asia/Jerusalem';

/**
 * 1-based day of a period of a LOCAL MIDNIGHT (a trend bucket start), against the period's first
 * local midnight. A clock change moves a midnight by an hour at most, so rounding the distance in
 * days is exact in any time zone and across daylight saving (v2 D2).
 */
export function bucketDayIndex(bucketStart: string, periodStart: string): number {
  return Math.round((Date.parse(bucketStart) - Date.parse(periodStart)) / DAY_MS) + 1;
}

/** An instant's wall clock in `timeZone`, written as if that wall clock were UTC (ms). */
function wallClockMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/**
 * 1-based local day of `now` in the period that starts at `periodStart` (a local midnight): the
 * distance between the two WALL CLOCKS, so the hour a clock change adds or removes inside the
 * month never shifts the day (v2 D3). The wall clock is Israel's, the zone every date in the app
 * is shown in (the page's date line says the same day). 0 when an instant does not parse.
 */
export function todayDayIndex(now: Date | string | number, periodStart: string, timeZone: string = IL_TZ): number {
  const at = new Date(now).getTime();
  const start = Date.parse(periodStart);
  if (!Number.isFinite(at) || !Number.isFinite(start)) return 0;
  return Math.floor((wallClockMs(at, timeZone) - wallClockMs(start, timeZone)) / DAY_MS) + 1;
}

/** A period's first local midnight and its leak, as one procedure returned them. */
export interface PacePeriod {
  monthStart: string;
  leakIls: number;
}

export interface PaceInput {
  /** owner.leakTrend's bucket: anything but days draws no pace (month buckets would all land on day 1). */
  bucket?: 'day' | 'month';
  /** This month's days (owner.leakTrend `points`; sparse: a day without invoices is absent). */
  points: readonly PacePoint[] | null | undefined;
  /** The hero (owner.leakHero): the line is drawn only when it ends on this figure, to the agora. */
  current: PacePeriod;
  /** Today's local day of the month (`todayDayIndex`): the axis runs from day 1 to today. */
  today: number;
  /**
   * The same days last month: owner.leakTrend `previous` as `points`, with leakSummary's previous
   * figures beside them. Drawn only when it has days, has checked invoices, and ends on that figure.
   */
  previous?: (PacePeriod & { points: readonly PacePoint[] | null | undefined; matchedInvoiceCount?: number }) | null;
}

/**
 * Sparse days → running totals in integer agorot for days 1..`days`. A day after `days` (an
 * invoice dated later this month) counts on the last day, so the line still ends on the period's
 * figure; a point before day 1 means the two reads disagree about the month → null.
 */
function runningTotals(points: readonly PacePoint[], periodStart: string, days: number): number[] | null {
  const perDay = new Array<number>(days).fill(0);
  for (const p of points) {
    const day = bucketDayIndex(p.bucketStart, periodStart);
    if (!Number.isFinite(day) || day < 1) return null;
    perDay[Math.min(day, days) - 1]! += agorotOf(p.leakIls);
  }
  let run = 0;
  return perDay.map((v) => (run += v));
}

/**
 * The pace line's two series (DS3 SPEC §10.1; v2 D1–D4), in the shared `PaceSeries` shape. Chart
 * geometry only: no label, aria text or title reads these totals.
 *  - null when the trend is not daily, before day 2 (one day is a dot, not a pace), or when this
 *    month's line does not end on the hero to the agora (never imply a different figure);
 *  - `prev` is null when last month's same days are unknown: no days at all ([] is never drawn as
 *    zeros), no checked invoices, or a line that does not end on leakSummary's previous figure.
 */
export function paceSeries(input: PaceInput): PaceSeries | null {
  if (input.bucket !== undefined && input.bucket !== 'day') return null;
  const days = Math.floor(input.today);
  if (!Number.isFinite(days) || days < 2) return null;
  const cur = runningTotals(input.points ?? [], input.current.monthStart, days);
  if (!cur || cur[days - 1] !== agorotOf(input.current.leakIls)) return null;
  return { cur, prev: previousTotals(input.previous, days) };
}

function previousTotals(previous: PaceInput['previous'], days: number): number[] | null {
  if (!previous?.points || previous.points.length === 0) return null;
  if (previous.matchedInvoiceCount !== undefined && previous.matchedInvoiceCount <= 0) return null;
  const prev = runningTotals(previous.points, previous.monthStart, days);
  return prev && prev[days - 1] === agorotOf(previous.leakIls) ? prev : null;
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

/** The hero section, as the coarse-pointer rule in globals.css already names it. */
const HERO_SCOPE = 'section[aria-labelledby="leak-hero-label"][data-entry]';

/**
 * The entry motion, once (SPEC §8, §10.1; v4 H1): the ONE hero-scoped stylesheet the owner home
 * renders with `data-entry`. Everything runs only under `prefers-reduced-motion: no-preference`,
 * on the motion tokens (`var(--dur-*)`, `var(--ease-*)`), and plays when the streamed HTML is
 * inserted, whatever the hydration timing:
 *  - `count` — the final number is held invisible for the long duration, with NO fill, so CSS
 *    alone shows it again even if no script runs; the HeroAmount island counts over that hold;
 *  - `draw` / `fade` / `pop` — the shared pace line's parts; the shared split bar grows from its
 *    start edge (its transform origin is set where it is rendered).
 * The keyframes are `rm-hero-*` (globals.css already has an `rm-draw`).
 */
export const HERO_ENTRY_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  `${HERO_SCOPE} [data-entry-part="count"]{animation:rm-hero-hold var(--dur-long) linear}`,
  `${HERO_SCOPE} [data-entry-part="draw"]{animation:rm-hero-draw var(--dur-long) var(--ease-standard) both}`,
  `${HERO_SCOPE} [data-entry-part="fade"]{animation:rm-hero-fade var(--dur-medium) linear both}`,
  `${HERO_SCOPE} [data-entry-part="pop"]{animation:rm-hero-pop var(--dur-short) var(--ease-enter) calc(var(--dur-long) - var(--dur-short)) backwards}`,
  `${HERO_SCOPE} [data-split-bar]{animation:rm-hero-grow var(--dur-long) var(--ease-enter) both}`,
  '}',
  '@keyframes rm-hero-hold{from,to{opacity:0}}',
  '@keyframes rm-hero-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}',
  '@keyframes rm-hero-fade{from{opacity:0}to{opacity:1}}',
  '@keyframes rm-hero-pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}',
  '@keyframes rm-hero-grow{from{transform:scaleX(0)}to{transform:none}}',
].join('');

/** The name of the hold animation the HeroAmount island reads (it counts only while the hold runs). */
export const HERO_HOLD_ANIMATION = 'rm-hero-hold';
