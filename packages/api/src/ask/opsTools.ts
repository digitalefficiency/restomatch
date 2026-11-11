/**
 * AU-06 · Ask answers "what needs me" — five read-only operational tools.
 *
 *   waiting_for_me    what waits for my decision        (G-12a awaitingDecision)
 *   intake_stuck      what is stuck in intake           (AU-02 intakeAttention; counts only, no ₪)
 *   who_owes_me       which suppliers still owe credits (recovery listClaims + overdueSql)
 *   to_pay_this_week  what is due this week             (W2-03 due-date buckets)
 *   vat_at_risk       input VAT at risk                 (vat/vatAtRisk — its OWN figure, never leak)
 *
 * Rules:
 *  • Read-only. Same tenant-scoped functions the screens use; the session
 *    restaurant id only, never an id from the model.
 *  • Every ₪ field ends in `Ils` (figures.ts naming rule) so grounding sees it.
 *    Recovery stores integer agorot: summed as integers, ÷100 once at the edge.
 *  • Unknown is a sentence, never ₪0: a tool whose source is not live (or whose
 *    feature is off) returns `{ available: false, reason }`.
 *  • The interim sources below are one-line swaps when the dependency merges
 *    (see SOURCES). They never copy another package's unmerged code.
 *
 * This module returns `{data, links}`; `runTool` (tools.ts) adds the figures and
 * applies the role table (roles.ts).
 */
import type { Database, UserRole } from '@restomatch/db';
import { z } from 'zod';
import { isFeatureOn } from '../lib/featureGate';
import { awaitingDecision } from '../approvals/awaiting';
import { isNeverClaimable } from '../lib/claims';
import { listClaims } from '../recovery/service';
import { vatAtRisk } from '../vat/vatAtRisk';
import type { ScreenLink } from './tools';

export const OPS_TOOL_NAMES = [
  'waiting_for_me',
  'intake_stuck',
  'who_owes_me',
  'to_pay_this_week',
  'vat_at_risk',
] as const;
export type OpsToolName = (typeof OPS_TOOL_NAMES)[number];

export function isOpsTool(name: string): name is OpsToolName {
  return (OPS_TOOL_NAMES as readonly string[]).includes(name);
}

/** Why a tool has no answer. The web turns each into an honest sentence. */
export type UnavailableReason =
  /** The source package has not landed on main yet. */
  | 'not_live'
  /** W2-03 due dates are not computed yet. */
  | 'due_dates_not_live'
  /** The restaurant's feature flag is off. */
  | 'feature_off';

export interface Unavailable {
  available: false;
  reason: UnavailableReason;
  feature?: 'recovery' | 'vatAtRisk' | 'payRun';
}

/** The period every fact covers (G-12 contract): Israel calendar days, inclusive. */
export interface FactPeriod {
  from: string;
  through: string;
  /** true = the figure covers the whole period (a snapshot "as of today" is complete). */
  complete: boolean;
}

export interface OpsContext {
  db: Database;
  restaurantId: string;
  role?: UserRole;
  now: Date;
  locale: 'he' | 'en';
}

// ---------------------------------------------------------------------------
// Interim sources (one-line swaps)
// ---------------------------------------------------------------------------

/** The subset of G-12a `AwaitingDecision` this tool reads. */
export interface AwaitingSnapshot {
  count: number;
  blockers: number;
  oldestAt: Date | null;
  toDecide: { count: number };
  /** Claimable ₪ by VAT basis; never added across bases. `null` without money view. */
  ils: { excl: number; incl: number; vat: number; mixedBasis: boolean } | null;
}
export type AwaitingSource = (
  db: Database,
  ctx: { session: { restaurantId: string; role: UserRole } },
  opts: { scope: 'mine' | 'all' },
) => Promise<AwaitingSnapshot>;

/** The subset of AU-02 `intakeAttention` this tool reads (counts only). */
export interface IntakeSnapshot {
  /** Inbox documents needing review; null when no ingest channel is on. */
  needsReview: { count: number; oldestAgeHours: number | null } | null;
  ocrStuck: number;
  ocrFailed: number;
  noSupplier: number;
}
export type IntakeSource = (db: Database, restaurantId: string, now: Date) => Promise<IntakeSnapshot>;

/** W2-03 due-date buckets for the Israel week (Sun–Sat). Agorot. */
export interface DueWeekSnapshot {
  dueAgorot: number;
  overdueAgorot: number;
  heldAgorot: number;
  heldCount: number;
  dueCount: number;
  overdueCount: number;
}
export type DueWeekSource = (db: Database, restaurantId: string, now: Date) => Promise<DueWeekSnapshot | null>;

/**
 * Sources. `awaiting` is G-12a's `awaitingDecision` (live). INTERIM: null = not merged yet.
 *  - intake    → `intakeAttention` (AU-02)
 *  - dueWeek   → a W2-03 bucket helper (today the pay-run totals live inline in routers/payRun.ts)
 */
const DEFAULT_SOURCES = {
  awaiting: awaitingDecision as AwaitingSource,
  intake: null as IntakeSource | null,
  dueWeek: null as DueWeekSource | null,
};
const SOURCES: { awaiting: AwaitingSource | null; intake: IntakeSource | null; dueWeek: DueWeekSource | null } = {
  ...DEFAULT_SOURCES,
};

/** Test seam: plug a source (e.g. a fake) without waiting for its package. */
export function __setOpsSources(s: Partial<typeof SOURCES>): void {
  Object.assign(SOURCES, s);
}
export function __resetOpsSources(): void {
  Object.assign(SOURCES, DEFAULT_SOURCES);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' of an instant in Israel time. */
export function israelDayKey(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(d));
}

/** Whole calendar days between two 'YYYY-MM-DD' keys. */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The Israel week (Sun–Sat) holding `now`. */
export function israelWeek(now: Date): { from: string; through: string } {
  const today = israelDayKey(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - dow * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { from: start.toISOString().slice(0, 10), through: end.toISOString().slice(0, 10) };
}

/** Untrusted name (OCR'd / supplier-entered) → short single line. */
function clipName(text: string | null | undefined, max = 60): string | null {
  if (text == null) return null;
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function nameIn(locale: 'he' | 'en', he: string | null, en: string | null): string | null {
  return clipName(locale === 'en' ? en || he : he || en);
}

const agorotToIls = (a: number): number => a / 100;
const snapshotPeriod = (now: Date): FactPeriod => {
  const d = israelDayKey(now);
  return { from: d, through: d, complete: true };
};

export interface OpsToolResult {
  data: (Record<string, unknown> & { available: true; period: FactPeriod }) | Unavailable;
  links: ScreenLink[];
}

// ---------------------------------------------------------------------------
// The five tools
// ---------------------------------------------------------------------------

export async function waitingForMe(ctx: OpsContext): Promise<OpsToolResult> {
  const links: ScreenLink[] = [{ screen: 'approvals', href: '/dashboard/approvals' }];
  const source = SOURCES.awaiting;
  if (!source || !ctx.role) return { data: { available: false, reason: 'not_live' }, links };
  const a = await source(ctx.db, { session: { restaurantId: ctx.restaurantId, role: ctx.role } }, { scope: 'mine' });
  const today = israelDayKey(ctx.now);
  return {
    data: {
      available: true,
      period: snapshotPeriod(ctx.now),
      count: a.count,
      toDecideCount: a.toDecide.count,
      blockingCount: a.blockers,
      // Before-VAT claimable ₪ is the headline; the other bases are shown apart, never added.
      awaitingIls: a.ils ? a.ils.excl : null,
      awaitingInclVatIls: a.ils && a.ils.incl ? a.ils.incl : null,
      awaitingVatIls: a.ils && a.ils.vat ? a.ils.vat : null,
      mixedBasis: a.ils?.mixedBasis ?? false,
      oldestAgeDays: a.oldestAt ? dayDiff(israelDayKey(a.oldestAt), today) : null,
    },
    links,
  };
}

export async function intakeStuck(ctx: OpsContext): Promise<OpsToolResult> {
  const source = SOURCES.intake;
  if (!source) return { data: { available: false, reason: 'not_live' }, links: [] };
  const s = await source(ctx.db, ctx.restaurantId, ctx.now);
  // The inbox (and its link) exists only when an ingest channel is on (ingest.inbox → requireIngest).
  const links: ScreenLink[] = s.needsReview ? [{ screen: 'inbox', href: '/dashboard/inbox' }] : [];
  return {
    data: {
      available: true,
      period: snapshotPeriod(ctx.now),
      needsReviewCount: s.needsReview ? s.needsReview.count : null,
      oldestReviewAgeHours: s.needsReview ? s.needsReview.oldestAgeHours : null,
      ocrStuckCount: s.ocrStuck,
      ocrFailedCount: s.ocrFailed,
      noSupplierCount: s.noSupplier,
      totalCount: (s.needsReview?.count ?? 0) + s.ocrStuck + s.ocrFailed + s.noSupplier,
    },
    links,
  };
}

export async function whoOwesMe(ctx: OpsContext): Promise<OpsToolResult> {
  const links: ScreenLink[] = [{ screen: 'recovery', href: '/dashboard/recovery' }];
  if (!(await isFeatureOn(ctx.db, ctx.restaurantId, 'recovery'))) {
    return { data: { available: false, reason: 'feature_off', feature: 'recovery' }, links };
  }
  const today = israelDayKey(ctx.now);
  // Every claim (summaries never truncate). `overdue` is overdueSql — the reminder job's
  // rule WITHOUT its re-chase gate, so a claim reminded yesterday still counts as owed.
  const claims = await listClaims(ctx.db, ctx.restaurantId, { now: ctx.now, limit: null });
  type Acc = {
    supplierId: string | null;
    he: string | null;
    en: string | null;
    claimCount: number;
    outstandingAgorot: number;
    overdueAgorot: number;
    oldestDay: string;
    overdue: boolean;
  };
  const bySupplier = new Map<string, Acc>();
  let oldest = today;
  for (const c of claims) {
    if (c.outstandingAgorot <= 0) continue; // closed, recovered, written off, fully credited
    if (isNeverClaimable(c.discrepancyType)) continue; // owner 31.10: never owed (MISSING_ON_INVOICE …)
    const key = c.supplierId ?? '∅';
    const waitingSince = israelDayKey(c.letterSentAt ?? c.claimedAt);
    const e =
      bySupplier.get(key) ??
      ({
        supplierId: c.supplierId,
        he: c.supplierName,
        en: c.supplierNameEn,
        claimCount: 0,
        outstandingAgorot: 0,
        overdueAgorot: 0,
        oldestDay: waitingSince,
        overdue: false,
      } satisfies Acc);
    e.claimCount += 1;
    e.outstandingAgorot += c.outstandingAgorot;
    if (c.overdue) {
      e.overdueAgorot += c.outstandingAgorot;
      e.overdue = true;
    }
    if (waitingSince < e.oldestDay) e.oldestDay = waitingSince;
    if (waitingSince < oldest) oldest = waitingSince;
    bySupplier.set(key, e);
  }
  const all = [...bySupplier.values()].sort(
    (a, b) => b.overdueAgorot - a.overdueAgorot || b.outstandingAgorot - a.outstandingAgorot,
  );
  const totalAgorot = all.reduce((s, e) => s + e.outstandingAgorot, 0);
  const overdueAgorot = all.reduce((s, e) => s + e.overdueAgorot, 0);
  const top = all.slice(0, 5);
  for (const e of top) if (e.supplierId) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${e.supplierId}` });
  return {
    data: {
      available: true,
      period: { from: oldest, through: today, complete: true },
      supplierCount: all.length,
      claimCount: all.reduce((s, e) => s + e.claimCount, 0),
      outstandingIls: agorotToIls(totalAgorot),
      overdueIls: agorotToIls(overdueAgorot),
      overdueSupplierCount: all.filter((e) => e.overdue).length,
      suppliers: top.map((e) => ({
        supplierId: e.supplierId,
        supplier: nameIn(ctx.locale, e.he, e.en),
        claimCount: e.claimCount,
        outstandingIls: agorotToIls(e.outstandingAgorot),
        overdueIls: agorotToIls(e.overdueAgorot),
        oldestWaitingDays: dayDiff(e.oldestDay, today),
        overdue: e.overdue,
      })),
    },
    links,
  };
}

export async function toPayThisWeek(ctx: OpsContext): Promise<OpsToolResult> {
  const links: ScreenLink[] = [{ screen: 'payRun', href: '/dashboard/approvals/pay-run' }];
  if (!(await isFeatureOn(ctx.db, ctx.restaurantId, 'payRun'))) {
    return { data: { available: false, reason: 'feature_off', feature: 'payRun' }, links };
  }
  const source = SOURCES.dueWeek;
  const w = source ? await source(ctx.db, ctx.restaurantId, ctx.now) : null;
  if (!w) return { data: { available: false, reason: 'due_dates_not_live' }, links };
  const week = israelWeek(ctx.now);
  return {
    data: {
      available: true,
      period: { from: week.from, through: week.through, complete: true },
      dueIls: agorotToIls(w.dueAgorot),
      dueCount: w.dueCount,
      overdueIls: agorotToIls(w.overdueAgorot),
      overdueCount: w.overdueCount,
      heldIls: agorotToIls(w.heldAgorot),
      heldCount: w.heldCount,
    },
    links,
  };
}

export async function vatAtRiskTool(ctx: OpsContext): Promise<OpsToolResult> {
  const links: ScreenLink[] = [{ screen: 'overview', href: '/dashboard' }];
  if (!(await isFeatureOn(ctx.db, ctx.restaurantId, 'vatAtRisk'))) {
    return { data: { available: false, reason: 'feature_off', feature: 'vatAtRisk' }, links };
  }
  const r = await vatAtRisk(ctx.db, ctx.restaurantId, 'open', { now: ctx.now });
  const top = r.rows.slice(0, 5);
  for (const row of top) links.push({ screen: 'invoice', href: `/dashboard/invoices/${row.invoiceId}` });
  return {
    data: {
      available: true,
      period: snapshotPeriod(ctx.now),
      // A tax-compliance exposure, NOT leak: never added to the leak figure.
      label: 'vatAtRisk',
      count: r.count,
      totalVatAtRiskIls: r.totalVatAtRisk,
      soonestDaysLeft: top[0]?.daysLeft ?? null,
      rows: top.map((row) => ({
        invoiceId: row.invoiceId,
        supplier: nameIn(ctx.locale, row.supplierName, row.supplierNameEn),
        invoiceNumber: clipName(row.invoiceNumber, 30),
        vatAtRiskIls: row.vatAtRisk,
        daysLeft: row.daysLeft,
      })),
    },
    links,
  };
}

const NoInput = z.object({}).strict();

/** Run one ops tool (input is always `{}`; the model picks nothing). */
export async function runOpsTool(name: OpsToolName, rawInput: unknown, ctx: OpsContext): Promise<OpsToolResult> {
  NoInput.parse(rawInput ?? {});
  switch (name) {
    case 'waiting_for_me':
      return waitingForMe(ctx);
    case 'intake_stuck':
      return intakeStuck(ctx);
    case 'who_owes_me':
      return whoOwesMe(ctx);
    case 'to_pay_this_week':
      return toPayThisWeek(ctx);
    case 'vat_at_risk':
      return vatAtRiskTool(ctx);
  }
}

const EMPTY = { type: 'object', properties: {}, additionalProperties: false } as const;

/** Tool definitions sent to Claude (strict, no input). */
export const OPS_TOOL_DEFINITIONS = [
  {
    name: 'waiting_for_me',
    description:
      'What waits for MY decision now in the approvals queue: open discrepancies routed to my role, how many block payment, the claimable ₪ (before VAT; other VAT bases apart), and the oldest item age in days. If available=false, say it is not available yet.',
    input_schema: EMPTY,
    strict: true,
  },
  {
    name: 'intake_stuck',
    description:
      'What is stuck in document intake: inbox documents needing review (only when an intake channel is on), invoices still being read too long, invoices whose reading failed, invoices with no supplier. Counts only, no ₪. A consolidated or pending-link invoice is NOT stuck. If available=false, say it is not available yet.',
    input_schema: EMPTY,
    strict: true,
  },
  {
    name: 'who_owes_me',
    description:
      'Which suppliers still owe credits on credit requests already sent (בקשות זיכוי): per supplier the outstanding ₪, the overdue ₪ (no answer for more than 7 days), days waiting; top 5 and totals. If available=false, the recovery tracker is off.',
    input_schema: EMPTY,
    strict: true,
  },
  {
    name: 'to_pay_this_week',
    description:
      'Supplier invoices due this Israel week (Sun–Sat) and overdue, plus held payments and why. If available=false, payment due dates are not computed yet — say so, never ₪0.',
    input_schema: EMPTY,
    strict: true,
  },
  {
    name: 'vat_at_risk',
    description:
      'Input VAT at risk: invoices above the allocation-number threshold with no valid allocation number (מספר הקצאה), the ₪ VAT at risk and days left to deduct it. A SEPARATE figure: never add it to the leak.',
    input_schema: EMPTY,
    strict: true,
  },
] as const;
