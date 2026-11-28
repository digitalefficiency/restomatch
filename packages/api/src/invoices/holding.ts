import { and, discrepancies, eq, inArray, matchRuns, restaurants, type Database, type UserRole } from '@restomatch/db';
import { notZeroShortTwin } from '@restomatch/charts';
import { vatBasisOf, type VatBasis } from '../lib/claims';
import type { WAIVE_REASON_CODES } from '../routers/approvals';
import { canActOn } from '../lib/roles';
import { discrepancyDecidableSql } from '../lifecycle/predicates';
import type { InvoiceState } from './state';

/**
 * INV-00 · with whom an invoice's gap is, since when and why (`holding`), and what a person
 * decided last (`lastDecision`): ONE definition that every screen of the invoices area reads,
 * on `invoices.list` rows, `invoices.detail`, `invoices.holding` and the approvals queue row.
 *
 * Reads only. The row set is the approvals queue's own (open or escalated, without the
 * engine's ₪0 QTY_SHORT twin: `routers/approvals.ts` myQueue), so every screen counts what the
 * desk counts. The open ₪ comes from `approvals/awaiting.ts` (`awaitingDecisionDetail`, the
 * letters' rule with the per-invoice cap), never from a sum of its own. The server returns
 * structures and never a printed word: `apps/web/lib/invoices/words.ts` words them (the
 * stored `rule_name` holds the retired word "הפרש", so it is never shown).
 */

/**
 * The zone the invoices area counts days in when a restaurant stores none. Every whole day and
 * every "today" of the area is counted on the restaurant's own calendar (`restaurants.timezone`),
 * and each payload that feeds a wait carries that zone (`timeZone`) for the words module.
 */
export const DEFAULT_AREA_TIME_ZONE = 'Asia/Jerusalem';

/** The restaurant's IANA zone (`restaurants.timezone`), else DEFAULT_AREA_TIME_ZONE. */
export async function areaTimeZoneOf(db: Database, restaurantId: string): Promise<string> {
  const [r] = await db
    .select({ timeZone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return r?.timeZone?.trim() || DEFAULT_AREA_TIME_ZONE;
}

/** The roles a gap can wait for: the engine routes only to these three. */
export const GAP_ROLES = ['owner', 'manager', 'bookkeeper'] as const satisfies ReadonlyArray<UserRole>;
export type GapRole = (typeof GAP_ROLES)[number];

/** Integer agorot per VAT basis (`lib/claims` VatBasis). Never add the three together. */
export interface AgorotByBasis {
  /** Line ₪ before VAT. */
  excl: number;
  /** A duplicate's ₪, including VAT. */
  incl: number;
  /** A VAT mismatch: the VAT amount itself. */
  vat: number;
}

/**
 * What routed a gap to its role, from the rule stored on it (`discrepancies.rule_id`,
 * `packages/api/src/approvals/engine.ts`) and, for `severity-block`, the gap's own kind:
 *  - `duplicate` · duplicate-invoice (to the bookkeeper)
 *  - `large_without_order` · large-invoice-without-po
 *  - `unordered_item` · unordered-item-significant
 *  - `billed_over_received` · severity-block on a QTY_OVER (billed above what was received)
 *  - `price_rise` · severity-block on a PRICE_HIGHER
 *  - `blocking` · severity-block on any other kind
 *  - `large` · cumulative-large
 *  - `medium` · cumulative-medium
 *  - `fallback` · no rule matched (the engine's fallback, the manager)
 *  - `other` · a rule id this build does not know, an auto rule, or none stored
 */
export const REASON_KINDS = [
  'duplicate',
  'large_without_order',
  'unordered_item',
  'billed_over_received',
  'price_rise',
  'blocking',
  'large',
  'medium',
  'fallback',
  'other',
] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];

/**
 * Why a gap is with its role. A reason carries numbers only when they are provably the ones
 * that routed the gap; otherwise the number is null and no screen prints it.
 */
export interface GapReason {
  /** The routing rule stored on the gap (an engine rule id, or 'fallback'); null when none is stored. */
  ruleId: string | null;
  kind: ReasonKind;
  /**
   * `price_rise` only: the restaurant's own `tolerances.blockPricePercent` today, as the setting
   * stores it (a fraction: 0.1 = 10%), and only when the gap's own rise is at or above it.
   * Otherwise null.
   */
  blockPricePercent: number | null;
  /**
   * `medium` only: the restaurant's ₪ band before VAT today (cumulativeMediumAmountMin,
   * cumulativeLargeAmount), integer agorot, and only when running the rules again on the
   * stored facts with today's thresholds returns `cumulative-medium` by its amount clause.
   */
  bandAgorot: { min: number; max: number } | null;
}

/** A gap that was passed on to the owner (`approvals.escalate`). */
export interface PassedOn {
  /** The role that passed it on; null when the audit row does not record it. */
  byRole: GapRole | null;
  /** When it was passed on; null when it was carried through a re-match (the time is not known). */
  at: Date | null;
  /** Whole days, in the restaurant's zone, the gap had waited before it was passed on; null when carried. */
  waitedDays: number | null;
  /** Carried through a re-match: no time, no days, and no pass-on phrase is printed. */
  carried: boolean;
}

export type GapSeverity = 'block' | 'warn' | 'info';

/**
 * With whom an invoice's open gaps are. Null when the invoice has no open gap.
 *
 * The leading gap: when one of the invoice's open gaps is routed to the viewer's role it is
 * the viewer's own (blocking first, then the longest wait) and `mine` is true; otherwise it
 * is the invoice's blocking-first, longest-waiting gap. `role`, `since`, `reason` and
 * `passedOn` describe the leading gap.
 *
 * A gap with no routed role (`requires_role` null; the engine leaves none open today) is in
 * nobody's "mine" (the product's one definition, `approvals/awaiting.ts`) and has `routed`
 * false; for a place and a role word it counts as the manager's, because `canActOn` lets
 * exactly the owner and the manager decide it, as a manager's gap, and the engine's fallback
 * routes there.
 */
export interface Holding {
  /** The leading gap's role (the manager's for a gap with no routed role: see `routed`). */
  role: GapRole;
  /** The leading gap has a routed role (`requires_role` set). */
  routed: boolean;
  /**
   * The leading gap is routed to the viewer's own role ("אצלכם"), not merely decidable by the
   * viewer; never for a gap with no routed role.
   */
  mine: boolean;
  /** Exactly `decideGapId !== null`. */
  canAct: boolean;
  /** When the leading gap's wait started: its pass-on, else the creation of the gap row. */
  since: Date;
  /**
   * The leading gap's id (`role`, `since`, `reason` and `passedOn` describe it). Never the
   * target of "להחלטה": that is `decideGapId`.
   */
  leadingGapId: string;
  /**
   * The first gap of the invoice the viewer may decide (own routing first, blocking before
   * warning, the longest wait first), or null. Every "להחלטה" links here, never to `leadingGapId`.
   */
  decideGapId: string | null;
  /** The leading gap's own severity: the orders and the leading gap's level read this. */
  severity: GapSeverity;
  /** The worst severity among the invoice's open gaps: the state pill and the dots read this. */
  worstSeverity: GapSeverity;
  /** The invoice's open gaps: the rows the approvals desk shows for it. */
  openCount: number;
  /** Their claimable ₪ by VAT basis, integer agorot (the letters' rule, capped per invoice). */
  openAgorot: AgorotByBasis;
  reason: GapReason;
  passedOn: PassedOn | null;
}

/**
 * What a person decided on a gap:
 *  - `credit` · accepted: added to the credit request ("נוסף לבקשת הזיכוי")
 *  - `as_billed` · waived: paid as billed ("שולם כפי שחויב")
 *  - `duplicate_held` · an accepted duplicate: the copy is held, not paid
 *  - `not_duplicate` · a waived duplicate: not a copy
 *  - `reviewed` · a gap with no ₪ marked as checked (reason code `reviewed`)
 */
export const DECISION_RESULTS = ['credit', 'as_billed', 'duplicate_held', 'not_duplicate', 'reviewed'] as const;
export type DecisionResult = (typeof DECISION_RESULTS)[number];

/** A waive reason code, as `approvals.reject` / `decideMany` validate and the audit row stores it. */
export type WaiveReasonCode = (typeof WAIVE_REASON_CODES)[number];

/**
 * A person's decision on one gap, still in force (an undone decision is never one), roles only
 * (no user id, no name, no e-mail). A gap the system closed by itself is never one.
 */
export interface DecisionRecord {
  gapId: string;
  result: DecisionResult;
  at: Date;
  /** The role that decided; null when it was not recorded (a decision carried through a re-match). */
  role: GapRole | null;
  /**
   * The role the gap was routed to when it was decided, when another role decided it (the
   * owner on the manager's gap); else null, also for a gap that had no routed role.
   */
  inPlaceOf: GapRole | null;
  /**
   * The ₪ the decision is about, integer agorot, on `basis`: for `credit` and `duplicate_held`
   * the ₪ it put in the credit request, for a waive the claimable ₪ the decider saw (both as
   * the audit row records them), else the gap's own |Δ|. 0 for a gap with no ₪ (`reviewed`):
   * a screen prints no amount then.
   */
  amountAgorot: number;
  basis: VatBasis;
  /** The waive reason code (`approvals` WAIVE_REASON_CODES, validated when it was written), or null. */
  reasonCode: WaiveReasonCode | null;
  /** The words the person typed for the reason "אחר", or null. Shown as text. */
  reasonText: string | null;
  /** The caller decided it. */
  byYou: boolean;
}

/**
 * Where an invoice of the month is, for the viewer: every invoice in exactly one place.
 *  - `r-owner`, `r-manager`, `r-bookkeeper` · an open gap of the desk's row set holds it (open
 *    or escalated, not the ₪0 twin), with the role of its `holding`, in any state but paid and
 *    the waiting states (the viewer's own role's place is "אצלכם"; a gap with no routed role
 *    counts as the manager's)
 *  - `wait` · being read, waiting for the count, or waiting to be linked (`in_ocr`,
 *    `awaiting_count`, `awaiting_link`), whatever gap it has
 *  - `dup` · a copy held as a duplicate with nothing left to decide
 *  - `alloc` · no open gap of the desk's row set, waiting for nothing else, and missing an
 *    allocation number by the pay run's rule (`allocationMissing`)
 *  - `ok` · no open gap of the desk's row set (clean, approved, or a credit to ask for)
 *  - `paid` · marked paid (`invoices.status = 'paid'`)
 * The order the screens show them in, and the aliases of the old `view` tab ids, are
 * `apps/web/lib/invoices/places.ts`.
 */
export const PLACE_IDS = ['r-owner', 'r-manager', 'r-bookkeeper', 'wait', 'dup', 'alloc', 'ok', 'paid'] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

/** One place of the month, for the viewer. The places partition the month. */
export interface PlaceSummary {
  id: PlaceId;
  /** Invoices in the place. */
  count: number;
  /** The open gaps of its invoices (Σ `holding.openCount`): the rows the desk shows for them. */
  openCount: number;
  /** Σ their totals including VAT, integer agorot. */
  totalInclVatAgorot: number;
  /** Σ their open gaps' claimable ₪ by VAT basis, integer agorot (as in `holding`). */
  openAgorot: AgorotByBasis;
  /** The worst open severity among its invoices, or null when none has an open gap. */
  worstSeverity: GapSeverity | null;
  /** How many of its invoices are consolidated invoices (חשבוניות מרכזות). */
  consolidatedCount: number;
  /** How many of its invoices had their missing allocation number asked of the supplier already. */
  allocationRequestedCount: number;
  /** How many of its invoices are in each canonical state. */
  byState: Record<InvoiceState, number>;
}

/**
 * The role a stored routing reads as: `requires_role` (or a queue row's `waitingOn`). No
 * routing (null, 'unrouted') reads as the manager's: see `Holding`.
 */
export function gapRoleOf(routing: string | null | undefined): GapRole {
  return routing === 'owner' || routing === 'bookkeeper' ? routing : 'manager';
}

const KIND_OF_RULE: Readonly<Record<string, ReasonKind>> = {
  'duplicate-invoice': 'duplicate',
  'large-invoice-without-po': 'large_without_order',
  'unordered-item-significant': 'unordered_item',
  'cumulative-large': 'large',
  'cumulative-medium': 'medium',
  fallback: 'fallback',
};

/** Pure: the reason kind of a stored rule id on a gap of `type` (see REASON_KINDS). */
export function reasonKindOf(ruleId: string | null, type: string): ReasonKind {
  if (ruleId === 'severity-block') {
    if (type === 'QTY_OVER') return 'billed_over_received';
    if (type === 'PRICE_HIGHER') return 'price_rise';
    return 'blocking';
  }
  return (ruleId != null && KIND_OF_RULE[ruleId]) || 'other';
}

/** A reason with no number proven (the stored rule only). */
export function reasonOfRule(ruleId: string | null, type: string): GapReason {
  return { ruleId, kind: reasonKindOf(ruleId, type), blockPricePercent: null, bandAgorot: null };
}

export const ZERO_AGOROT: Readonly<AgorotByBasis> = Object.freeze({ excl: 0, incl: 0, vat: 0 });

/** The VAT basis a gap's ₪ is on (`lib/claims` vatBasisOf): before VAT, incl. VAT (a duplicate), or VAT. */
export function gapBasisOf(type: string): VatBasis {
  return vatBasisOf(type);
}

// ───────────────────────────────────────────────────────────────────────────────
// The open gaps of a set of invoices: the approvals queue's row set.
// ───────────────────────────────────────────────────────────────────────────────

/** One open gap as the readers of this module see it. */
export interface OpenGap {
  id: string;
  invoiceId: string;
  type: string;
  severity: string;
  status: string;
  /** `requires_role` as stored (null = unrouted). */
  routing: UserRole | null;
  ruleId: string | null;
  createdAt: Date;
}

const SEVERITY_RANK: Readonly<Record<string, number>> = { block: 0, warn: 1, info: 2 };
const sevRank = (s: string) => SEVERITY_RANK[s] ?? 3;

/**
 * The invoices' open gaps, exactly the approvals queue's row set for them: this tenant's
 * discrepancies that are open or escalated, without the ₪0 QTY_SHORT twin, on any match run
 * of the invoice (`routers/approvals.ts` myQueue, scope 'all'). Foreign ids match nothing.
 */
export async function loadOpenGaps(
  db: Database,
  restaurantId: string,
  invoiceIds: readonly string[],
): Promise<OpenGap[]> {
  const ids = [...new Set(invoiceIds)];
  if (ids.length === 0) return [];
  const out: OpenGap[] = [];
  for (let at = 0; at < ids.length; at += 500) {
    const chunk = ids.slice(at, at + 500);
    const rows = await db
      .select({
        id: discrepancies.id,
        invoiceId: matchRuns.invoiceId,
        type: discrepancies.type,
        severity: discrepancies.severity,
        status: discrepancies.resolutionStatus,
        routing: discrepancies.requiresRole,
        ruleId: discrepancies.ruleId,
        createdAt: discrepancies.createdAt,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, restaurantId)))
      .where(
        and(
          eq(discrepancies.restaurantId, restaurantId),
          discrepancyDecidableSql(discrepancies.resolutionStatus),
          notZeroShortTwin(),
          inArray(matchRuns.invoiceId, chunk),
        ),
      );
    for (const r of rows) {
      if (!r.invoiceId) continue;
      out.push({ ...r, invoiceId: r.invoiceId, status: String(r.status), type: String(r.type), severity: String(r.severity) });
    }
  }
  return out;
}

/** Pure: blocking first, then the longest wait (earliest start), then the oldest row, then the id. */
function byUrgency(since: (g: OpenGap) => Date) {
  return (a: OpenGap, b: OpenGap) =>
    sevRank(a.severity) - sevRank(b.severity) ||
    since(a).getTime() - since(b).getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Pure: the leading gap of one invoice's open gaps for `viewer` (see `Holding`), or null when
 * there is none. `since` gives each gap's wait start (its pass-on, else its creation).
 */
export function leadingGap(
  gaps: readonly OpenGap[],
  viewer: UserRole,
  since: (g: OpenGap) => Date = (g) => g.createdAt,
): OpenGap | null {
  if (gaps.length === 0) return null;
  const order = byUrgency(since);
  // Own = routed to the viewer's role as stored (a gap with no routed role is nobody's own).
  const own = gaps.filter((g) => g.routing != null && g.routing === viewer);
  return [...(own.length > 0 ? own : gaps)].sort(order)[0] ?? null;
}

/**
 * Pure: the first gap `viewer` may decide (own routing first, blocking before warning, the
 * longest wait first), or null. Who may decide what is `canActOn` (lib/roles), unchanged.
 */
export function decideGap(
  gaps: readonly OpenGap[],
  viewer: UserRole,
  since: (g: OpenGap) => Date = (g) => g.createdAt,
): OpenGap | null {
  const order = byUrgency(since);
  const own = (g: OpenGap) => Number(g.routing != null && g.routing === viewer);
  const mineFirst = (a: OpenGap, b: OpenGap) => own(b) - own(a) || order(a, b);
  return [...gaps].filter((g) => canActOn(viewer, g.routing)).sort(mineFirst)[0] ?? null;
}

/** Pure: the worst severity of a set of open gaps. */
export function worstSeverityOf(gaps: readonly OpenGap[]): GapSeverity | null {
  if (gaps.length === 0) return null;
  const worst = [...gaps].sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0]!.severity;
  return worst === 'block' || worst === 'warn' ? worst : 'info';
}

/**
 * Pure: the place of one invoice of the month for the viewer (see PLACE_IDS). `holdingRole`
 * is the role of the invoice's holding for this viewer (null when it has no open gap).
 */
export function placeOf(state: InvoiceState, holdingRole: GapRole | null, allocationMissing: boolean): PlaceId {
  switch (state) {
    case 'paid':
      return 'paid';
    case 'in_ocr':
    case 'awaiting_count':
    case 'awaiting_link':
      return 'wait';
    case 'held_duplicate':
      // A held copy with nothing left to decide is `dup`.
      return holdingRole ? `r-${holdingRole}` : 'dup';
    case 'flagged_open':
    case 'clean':
    case 'claim_open':
    case 'approved':
      // `flagged_open` always has an open gap of the desk's row set (its finding is open,
      // warn/block and non-zero). The other states can still carry one the canonical state does
      // not count as a leak (a MISSING_ON_INVOICE, a ₪0 UNIT_MISMATCH): it stays with its role,
      // never in `ok`, whose words say there is no open gap.
      if (holdingRole) return `r-${holdingRole}`;
      return allocationMissing ? 'alloc' : 'ok';
    default: {
      // A new canonical state must choose its place here (pull request 190 adds one).
      const unplaced: never = state;
      throw new Error(`placeOf: no place for state ${String(unplaced)}`);
    }
  }
}

/** Group a list by invoice id. */
export function byInvoice<T extends { invoiceId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.invoiceId);
    if (list) list.push(r);
    else out.set(r.invoiceId, [r]);
  }
  return out;
}

/** ₪0 QTY_SHORT twin: the engine's second row for a bill above the receipt (never a gap, never counted). */
export function isZeroTwin(type: string, deltaAmount: string | number | null | undefined): boolean {
  // Mirrors charts `notZeroShortTwin()` (SQL `NOT (type = 'QTY_SHORT' AND delta_amount = 0)`,
  // which also drops a QTY_SHORT whose Δ is NULL).
  return type === 'QTY_SHORT' && (deltaAmount == null || Number(deltaAmount) === 0);
}

/** One of the approvals queue's rows: open or escalated, and not the ₪0 twin. */
export function isQueueRow(f: { resolutionStatus: string; type: string; deltaAmount: string | number | null }): boolean {
  return (f.resolutionStatus === 'open' || f.resolutionStatus === 'escalated') && !isZeroTwin(f.type, f.deltaAmount);
}

/**
 * The role of each invoice's leading open gap for `viewer` (see `Holding`): the role place
 * of an invoice held by an open gap. Invoices with no open gap are absent.
 */
export async function leadingRolesFor(
  db: Database,
  restaurantId: string,
  viewer: UserRole,
  invoiceIds: readonly string[],
): Promise<Map<string, GapRole>> {
  const out = new Map<string, GapRole>();
  for (const [invoiceId, gaps] of byInvoice(await loadOpenGaps(db, restaurantId, invoiceIds))) {
    const lead = leadingGap(gaps, viewer);
    if (lead) out.set(invoiceId, gapRoleOf(lead.routing));
  }
  return out;
}

/** `invoices.holding`: one entry per id that is the caller's; a foreign or unknown id is absent. */
export interface InvoiceHoldingEntry {
  invoiceId: string;
  holding: Holding | null;
  lastDecision: DecisionRecord | null;
  /** A consolidated invoice (חשבונית מרכזת): it waits for its delivery notes, not an order. */
  consolidated: boolean;
  /**
   * The restaurant's IANA zone (`restaurants.timezone`): the calendar every wait and every
   * "today" of this entry is counted on. Pass it to the words module.
   */
  timeZone: string;
}

/** At most this many ids per `invoices.holding` call (the pay run asks in chunks). */
export const HOLDING_MAX_IDS = 200;

/**
 * One routing of the open gaps (`approvals.queueSummary.byRouting`, `invoices.list.byRouting`).
 * Rows with no routed role are counted in the manager's routing (see `Holding`) and also
 * apart, in `unroutedCount`, so a screen can keep the desk's own "unrouted" lane.
 */
export interface RoutingSummary {
  role: GapRole;
  /** Open rows routed there (the desk's row set, under the read's filters). */
  count: number;
  /** Of `count`, the rows with no routed role (only ever in the manager's routing). */
  unroutedCount: number;
  /** Their claimable ₪ by VAT basis, integer agorot (approvals/awaiting's rule). */
  openAgorot: AgorotByBasis;
  /** Routed to the viewer's own role ("אצלכם"); rows with no routed role are nobody's. */
  mine: boolean;
  /** The viewer may decide gaps routed there (`canActOn`). */
  canAct: boolean;
}

const toAgorot = (ils: number | null | undefined) => Math.round((ils ?? 0) * 100);

/**
 * Pure: `approvals.queueSummary.byRouting` from `awaitingDecision({ scope: 'all' }).byRole`, in
 * the order owner, manager, bookkeeper, non-empty routings only. A row with no routing is
 * counted with the manager's (see `Holding`).
 */
export function byRoutingOf(
  byRole: ReadonlyArray<{ role: string; count: number; ils: { excl: number; incl: number; vat: number } | null }>,
  viewer: UserRole,
): RoutingSummary[] {
  const acc = new Map<GapRole, { count: number; unroutedCount: number; openAgorot: AgorotByBasis }>();
  for (const l of byRole) {
    const role = gapRoleOf(l.role);
    const e = acc.get(role) ?? { count: 0, unroutedCount: 0, openAgorot: { excl: 0, incl: 0, vat: 0 } };
    e.count += l.count;
    if (l.role === 'unrouted') e.unroutedCount += l.count;
    e.openAgorot.excl += toAgorot(l.ils?.excl);
    e.openAgorot.incl += toAgorot(l.ils?.incl);
    e.openAgorot.vat += toAgorot(l.ils?.vat);
    acc.set(role, e);
  }
  return GAP_ROLES.filter((r) => acc.has(r)).map((role) => ({
    role,
    ...acc.get(role)!,
    mine: role === viewer,
    canAct: canActOn(viewer, role),
  }));
}

/** `approvals.queueSummary.invoices`: the invoices with an open gap, and Σ their totals incl. VAT. */
export interface OpenInvoicesSummary {
  count: number;
  totalInclVatAgorot: number;
}

/**
 * `invoices.list.open`: the month's open gaps (the desk's row set of the month's invoices), for
 * the list's opening sentence and the "כל החודש" card. An invoice with gaps at two roles counts
 * in both routings. Read these totals, never a sum of rows' `holding`.
 */
export interface MonthOpenGaps {
  /** Open gaps of the month. */
  count: number;
  /** Their claimable ₪ by VAT basis, integer agorot. */
  openAgorot: AgorotByBasis;
  /** The same gaps by the role that decides them (as `approvals.queueSummary.byRouting`). */
  byRouting: RoutingSummary[];
}

/** Each queue row's reason and pass-on (`approvals.myQueue` rows), read once by the row ids. */
export interface GapFacts {
  reasonOf(row: { id: string; ruleId: string | null; type: string }): GapReason;
  passedOnOf(id: string): PassedOn | null;
}

/**
 * The reason and the pass-on of each given queue row. Contract (slice 0): the stored rule's
 * kind, no number proven yet, no pass-on yet.
 */
export async function gapFactsOf(
  _db: Database,
  _restaurantId: string,
  _rows: ReadonlyArray<{ id: string; ruleId: string | null; type: string }>,
): Promise<GapFacts> {
  return { reasonOf: (r) => reasonOfRule(r.ruleId, r.type), passedOnOf: () => null };
}
