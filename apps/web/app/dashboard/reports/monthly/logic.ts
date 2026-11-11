/**
 * "דוח החודש" (W3-08, owner decision I4): pure helpers for the one month
 * report with 3 tabs. No I/O, no formatting of ₪ here: the page formats every
 * amount through formatIls(); these helpers only decide what is shown, where
 * it links, and that the rows add up to the number.
 */

export const REPORT_TABS = ['proof', 'by', 'sent'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

/** `?tab=` → a known tab; anything else is the first tab (the number and its proof). */
export function parseTab(raw: string | string[] | undefined): ReportTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (REPORT_TABS as readonly string[]).includes(v ?? '') ? (v as ReportTab) : 'proof';
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const TZ = 'Asia/Jerusalem';

/** 'YYYY-MM' of the Israel month containing `now`, shifted by `offset` months. */
export function monthKey(offset = 0, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value) - 1 + offset;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** Whole months from `from` to `to` ('YYYY-MM'): monthsBetween('2026-11', '2026-10') = -1. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** The month before `month` ('YYYY-MM'). */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The 12 selectable months, newest first: this Israel month and the 11 before it. */
export function monthOptions(now: Date = new Date(), count = 12): string[] {
  return Array.from({ length: count }, (_, i) => monthKey(-i, now));
}

/**
 * The month to show. `month=YYYY-MM` wins when it is one of the 12 options;
 * `m=<offset>` (the old proof/breakdown links) is honoured inside the same
 * window; anything else is this month.
 */
export function parseMonth(sp: { month?: string | string[]; m?: string | string[] }, now: Date = new Date()): string {
  const options = monthOptions(now);
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  if (raw && MONTH_RE.test(raw) && options.includes(raw)) return raw;
  const off = Number.parseInt((Array.isArray(sp.m) ? sp.m[0] : sp.m) ?? '', 10);
  if (Number.isFinite(off) && off <= 0 && off > -options.length) return monthKey(off, now);
  return options[0]!;
}

/** Query string for a tab + month (the month always survives a tab change). */
export function reportHref(tab: ReportTab, month: string): string {
  return `/dashboard/reports/monthly?tab=${tab}&month=${month}`;
}

/* ─────────────────────────── status pill ─────────────────────────── */

export type ReportStatus =
  /** A live month: the numbers can still move. "פתוח · נכון ל-{date}". */
  | { state: 'open'; asOf: string }
  /** A frozen snapshot: what the owner received. "סגור · {date} · לא ישתנה". */
  | { state: 'closed'; closedOn: string };

export function statusOf(input: { frozen: boolean; generatedAt: string }, now: Date = new Date()): ReportStatus {
  return input.frozen ? { state: 'closed', closedOn: input.generatedAt } : { state: 'open', asOf: now.toISOString() };
}

/* ─────────────────────────── next steps ─────────────────────────── */

/** The snapshot's next-action codes (packages/api/src/reports/monthly.ts NextActionCode). */
export type NextCode =
  | 'chaseOverdue'
  | 'decideOpen'
  | 'sendClaims'
  | 'linkPending'
  | 'answerQuestions'
  | 'talkToSupplier'
  | 'allClear';

export interface NextStep {
  code: NextCode;
  /** T2 = act now (₪ + one verb link); T3 = calm good news (nothing to do). */
  tier: 'T2' | 'T3';
  /** Integer agorot when the step carries ₪, else null. */
  agorot: number | null;
  count: number | null;
  href: string | null;
  supplier?: { he: string; en: string };
  pct?: number;
}

interface SupplierRef {
  supplierId: string | null;
  supplierName: string | null;
}

/**
 * Each next action of the report → a T2 row with ₪, a count and a deep link.
 * The supplier step links to that supplier's page when the live breakdown
 * names it; "all clear" is the one T3 row.
 */
export function nextSteps(
  actions: Array<{ code: string; params: Record<string, string | number> }>,
  ctx: { month: string; thisMonth: string; suppliers?: SupplierRef[] },
): NextStep[] {
  const offset = monthsBetween(ctx.thisMonth, ctx.month);
  const breakdown = `/dashboard/leaks/breakdown${offset ? `?m=${offset}` : ''}`;
  const out: NextStep[] = [];
  for (const a of actions) {
    const p = a.params ?? {};
    const count = p.count == null ? null : Number(p.count);
    const agorot = p.agorot == null ? null : Math.round(Number(p.agorot));
    switch (a.code) {
      case 'chaseOverdue':
        out.push({ code: 'chaseOverdue', tier: 'T2', agorot, count, href: '/dashboard/recovery' });
        break;
      case 'decideOpen':
        out.push({ code: 'decideOpen', tier: 'T2', agorot, count, href: '/dashboard/approvals' });
        break;
      case 'sendClaims':
        out.push({ code: 'sendClaims', tier: 'T2', agorot, count, href: '/dashboard/leaks/claims' });
        break;
      case 'linkPending':
        out.push({ code: 'linkPending', tier: 'T2', agorot: null, count, href: breakdown });
        break;
      case 'answerQuestions':
        // G-08: invoices held on "is this the same product?" — answered on the mapping screen.
        out.push({ code: 'answerQuestions', tier: 'T2', agorot: null, count, href: '/dashboard/catalog/mapping' });
        break;
      case 'talkToSupplier': {
        const he = String(p.supplier ?? '');
        const id = ctx.suppliers?.find((s) => s.supplierName === he && s.supplierId)?.supplierId ?? null;
        out.push({
          code: 'talkToSupplier',
          tier: 'T2',
          agorot: null,
          count: null,
          href: id ? `/dashboard/suppliers/${id}` : '/dashboard/suppliers',
          supplier: { he, en: String(p.supplierEn ?? he) },
          pct: Number(p.pct ?? 0),
        });
        break;
      }
      default:
        out.push({ code: 'allClear', tier: 'T3', agorot: null, count: null, href: null });
    }
  }
  return out.length ? out : [{ code: 'allClear', tier: 'T3', agorot: null, count: null, href: null }];
}

/* ─────────────────────────── delta ─────────────────────────── */

export interface Delta {
  /** current − previous, integer agorot. */
  agorot: number;
  direction: 'up' | 'down' | 'same';
  /** Colour only when it is bad: the leak grew. */
  bad: boolean;
}

/** Aligned delta of the leak vs the previous month (both in integer agorot). */
export function deltaOf(currentAgorot: number, previousAgorot: number | null): Delta | null {
  if (previousAgorot == null) return null;
  const d = Math.round(currentAgorot) - Math.round(previousAgorot);
  return { agorot: d, direction: d > 0 ? 'up' : d < 0 ? 'down' : 'same', bad: d > 0 };
}

/* ─────────────────────────── totals ─────────────────────────── */

export const toAgorot = (ils: number): number => Math.round(ils * 100);

export interface Totals {
  /** Σ rows, integer agorot. */
  sumAgorot: number;
  /** Σ rows − the number (positive = rows above the number, e.g. the per-invoice cap). */
  gapAgorot: number;
  matches: boolean;
}

/** Do the rows (₪, from the live breakdown) add up to the month's number, to the agora? */
export function totalsOf(rowsIls: number[], numberAgorot: number): Totals {
  const sumAgorot = rowsIls.reduce((s, v) => s + toAgorot(v), 0);
  const gapAgorot = sumAgorot - Math.round(numberAgorot);
  return { sumAgorot, gapAgorot, matches: gapAgorot === 0 };
}

/* ─────────────────────────── D11 cover ─────────────────────────── */

/**
 * Text set in Frank Ruhl Libre (the cover and the print header) — owner
 * decision D11: the display face is never used for ₪. Throws if a cover
 * string carries a shekel sign or a currency figure.
 */
export function coverText(parts: string[]): string[] {
  for (const p of parts) {
    if (/₪|\bILS\b|NIS/.test(p)) throw new Error(`D11: the report cover never shows ₪ (${p})`);
  }
  return parts;
}

/* ─────────────────────────── legacy routes ─────────────────────────── */

/**
 * The month summaries that became tabs of "דוח החודש" (I4). Each old path
 * answers 308 to its tab: the digest page here, the proof page through the
 * orchestrator's next.config.ts line (W2-09 owns that page until then).
 */
export const LEGACY_TABS: Record<string, ReportTab> = {
  '/dashboard/reports/digest': 'sent',
  '/dashboard/leaks/proof': 'proof',
  '/dashboard/leaks/report': 'by',
};

/** Where an old link lands: its tab, with the month kept when it is valid. */
export function legacyTarget(path: string, month: string | undefined): string {
  const tab = LEGACY_TABS[path] ?? 'proof';
  const m = month && MONTH_RE.test(month) ? `&month=${month}` : '';
  return `/dashboard/reports/monthly?tab=${tab}${m}`;
}
