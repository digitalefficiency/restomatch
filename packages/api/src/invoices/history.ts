import {
  activityEvents,
  and,
  asc,
  auditLog,
  desc,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  gte,
  inArray,
  invoiceLines,
  invoices,
  isNotNull,
  lt,
  matchRuns,
  memberships,
  poLines,
  products,
  purchaseOrders,
  sql,
  suppliers,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { notZeroShortTwin } from '@restomatch/charts';
import type { AwaitingRouting } from '../approvals/awaiting';
import type { VatBasis } from '../lib/claims';
import { addCalendarDaysInTz, localDateKeyInTz, startOfDayInTz } from '../lib/time';
import {
  DECIDED_STATUSES,
  GAP_ROLES,
  daysBetweenIn,
  decisionRecordOf,
  decisionsOf,
  gapBasisOf,
  gapRoleOf,
  isPersonDecision,
  isZeroTwin,
  gapFactsOf,
  loadAreaSettings,
  provenReason,
  type AgorotByBasis,
  type DecisionRecord,
  type GapReason,
  type GapRole,
  type PassedOn,
} from './holding';

/**
 * INV-00 · an invoice's story (`invoices.history`) and a person's decisions of a period
 * (`approvals.decided`), built only from what the product records, roles only: no user id,
 * no name and no e-mail anywhere in either payload, and "it was you" as a flag (owner
 * decision 4). A gap the system closed by itself is never shown as a person's decision.
 *
 * Known limit, stated and not mended: a re-match deletes the gap rows and writes new ones
 * (`routers/match.ts`), so the audit rows of the old gap ids can no longer be joined to the
 * invoice. A decision and a pass-on are carried onto the new row (`match/persist.ts`), but the
 * undo pairs, the decider's recorded role and reason code of a carried decision, and the time
 * of a carried pass-on are lost; `rematched` says when that can be the case.
 */

type InvoiceRow = typeof invoices.$inferSelect;

/** Where an invoice came in from (`invoices.source`): photo, e-mail, platform, manual, WhatsApp. */
export type InvoiceSource = InvoiceRow['source'];

/**
 * Who did an act, as a role, never a person: the role the doer holds in this restaurant
 * (`memberships`, or the role the audit row records for a decision, a pass-on and an undo);
 * `system` for what the product did by itself (the check, the routing); null when the product
 * does not record who did it (who sent an order).
 */
export type HistoryActor = UserRole | 'system' | null;

interface HistoryEventBase {
  /** When; null only for a pass-on carried through a re-match (its time is not known). */
  at: Date | null;
  /** The gap the event is about, or null for an event of the whole invoice. */
  gapId: string | null;
  /** The role beside the act (see `HistoryActor`). */
  by: HistoryActor;
  /** The caller did it. */
  byYou: boolean;
}

/**
 * One event of an invoice's story:
 *  - `order_sent` · the order was sent to the supplier
 *  - `goods_received` · the goods were received (`counted`: and counted)
 *  - `invoice_read` · the invoice came in and was read (`source`: photo, e-mail, …)
 *  - `checked` · it was checked against the order and the receipt (a match run); `gapsFound`
 *    counts the gaps that reached a person (not the ₪0 twin, not what the system closed itself)
 *  - `routed` · a gap reached a role (`role`, the role it first reached, and the rule's `reason`)
 *  - `passed_on` · a gap was passed on to the owner
 *  - `decided` · a person decided a gap (the role, in whose place, the reason)
 *  - `undone` · a decision or a pass-on was taken back by the person who made it
 */
export type HistoryEvent =
  | (HistoryEventBase & { kind: 'order_sent' })
  | (HistoryEventBase & { kind: 'goods_received'; counted: boolean })
  | (HistoryEventBase & { kind: 'invoice_read'; source: InvoiceSource })
  | (HistoryEventBase & { kind: 'checked'; gapsFound: number })
  | (HistoryEventBase & { kind: 'routed'; role: GapRole; reason: GapReason })
  | (HistoryEventBase & { kind: 'passed_on'; passedOn: PassedOn })
  | (HistoryEventBase & { kind: 'decided'; decision: DecisionRecord })
  | (HistoryEventBase & { kind: 'undone'; undid: 'decision' | 'pass_on'; role: GapRole | null });

export type HistoryEventKind = HistoryEvent['kind'];

/** `invoices.history`: newest first. */
export interface InvoiceHistory {
  events: HistoryEvent[];
  /** The invoice was matched more than once: the story of the earlier gap rows may be thinner. */
  rematched: boolean;
}

/** The periods `approvals.decided` takes, in the restaurant's own day (its `timezone`). */
export const DECIDED_PERIODS = ['today', 'yesterday', 'week'] as const;
export type DecidedPeriod = (typeof DECIDED_PERIODS)[number];

/**
 * One decided gap for the approvals desk's "הוחלט היום": the queue row's keys as of this
 * contract (main's, DS3-04's invoiceDate, unitPriceBilled, lineTotal and unitPriceExpected,
 * and INV-00's routing, since and claimBasis), with their types, so the desk draws the same
 * evidence in grey, plus the decision. A key a later pull request adds to the queue row is
 * added here as a contract addition; the desk types its grey evidence as the shared keys
 * (`DecidedEvidenceKey` in apps/web/lib/invoices/types.ts), never as the whole queue row. A decided row: `canAct` false; `claimable` and `claimAgorot` say what the
 * decision put in the credit request (`credit`, `duplicate_held`), else false and 0;
 * `passedOn` null; `reason` the rule that first routed it (as `invoices.history`).
 */
type DiscrepancyRow = typeof discrepancies.$inferSelect;

export interface DecidedRow {
  id: string;
  type: DiscrepancyRow['type'];
  severity: DiscrepancyRow['severity'];
  resolutionStatus: DiscrepancyRow['resolutionStatus'];
  /** The routing stored on the gap now (an escalated-then-decided gap reads 'owner'). */
  requiredRole: UserRole | null;
  deltaAmount: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  toleranceUsed: string | null;
  ruleId: string | null;
  productName: string | null;
  productNameEn: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  invoiceDueDate: Date | null;
  invoiceStatus: InvoiceRow['status'] | null;
  hasScan: boolean;
  createdAt: Date;
  matchRunId: string;
  invoiceId: string | null;
  invoiceLineId: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  qtyBilled: string | null;
  billedUnit: string | null;
  unitPriceBilled: string | null;
  lineTotal: string | null;
  qtyOrdered: string | null;
  orderedUnit: string | null;
  unitPriceExpected: string | null;
  qtyReceived: string | null;
  poId: string | null;
  poRef: string | null;
  poDate: Date | null;
  /** Stored with the retired word "הפרש": kept for the row model, never printed. */
  ruleName: string | null;
  message: string | null;
  claimable: boolean;
  claimAgorot: number;
  canAct: boolean;
  waitingOn: AwaitingRouting;
  reason: GapReason;
  passedOn: PassedOn | null;
  /** As on the queue row: the role it is routed to now (the manager's for no routing), and since when. */
  routing: GapRole;
  since: Date;
  /** The VAT basis of `claimAgorot` (and of the decision's amount). */
  claimBasis: VatBasis;
  decision: DecisionRecord;
}

/**
 * `approvals.decided`: every member's decisions of the period in this restaurant (`byYou` marks
 * the caller's), never the system's, newest first, with the head's totals from the server. A
 * decision whose gap a re-match replaced without carrying it (its severity changed or its ₪
 * grew) has no gap row left and is not listed. At most DECIDED_MAX_ROWS rows; `count` counts all.
 */
export interface DecidedList {
  rows: DecidedRow[];
  /** The decisions of the period (`rows.length` unless the read's cap cut it). */
  count: number;
  /** Σ the decisions' `amountAgorot` by VAT basis, integer agorot (the ₪ they were about). */
  amountAgorot: AgorotByBasis;
}

/**
 * Pure: the [from, to) instants of a period in the restaurant's zone (DST-safe, `lib/time`).
 * `today` turns at midnight there; `yesterday` is the day before; `week` runs from the Sunday
 * that starts the current Israeli week (Sunday to Saturday) to the end of today.
 */
export function periodBounds(period: DecidedPeriod, now: Date, timeZone: string): { from: Date; to: Date } {
  const start = startOfDayInTz(now, timeZone);
  const tomorrow = addCalendarDaysInTz(start, 1, timeZone);
  if (period === 'today') return { from: start, to: tomorrow };
  if (period === 'yesterday') return { from: addCalendarDaysInTz(start, -1, timeZone), to: start };
  const [y, m, d] = localDateKeyInTz(now, timeZone).split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return { from: addCalendarDaysInTz(start, -dow, timeZone), to: tomorrow };
}

// ───────────────────────────────────────────────────────────────────────────────
// Slice 3 · the story of one invoice, from what the product records.
// ───────────────────────────────────────────────────────────────────────────────

const KIND_RANK: Readonly<Record<HistoryEventKind, number>> = {
  order_sent: 0,
  goods_received: 1,
  invoice_read: 2,
  checked: 3,
  routed: 4,
  passed_on: 5,
  decided: 6,
  undone: 7,
};

const asGapRole = (v: unknown): GapRole | null =>
  typeof v === 'string' && (GAP_ROLES as readonly string[]).includes(v) ? (v as GapRole) : null;

type Json = Record<string, unknown>;

/**
 * Pure: a gap reached a person. Not the engine's ₪0 QTY_SHORT twin (the desk never shows it)
 * and not a gap the system closed by itself (accepted at insertion, with no decision time).
 */
export function reachedAPerson(g: { type: string; status: string; deltaAmount: string | null; resolvedAt: Date | null }): boolean {
  return !isZeroTwin(g.type, g.deltaAmount) && !(g.status === 'accepted' && g.resolvedAt == null);
}

/**
 * `invoices.history` for one of the caller's invoices, newest first; null when the invoice is
 * not the caller's (the router answers NOT_FOUND). Roles only: who did what is a role and a
 * "you" flag, compared server-side.
 *
 *  - the order's sending (`purchase_orders.sent_at`; who sent it is not recorded, so never "you"),
 *    the receipt (`goods_receipts.received_at`; counted when the receipt is closed) and the
 *    invoice's arrival (`invoices.created_at`, its `source`), for each current match run;
 *  - the check (`match_runs.run_at`) with the gaps that reached a person;
 *  - per such gap: where it was routed first and why (the proven reason, as in `holding`), every
 *    pass-on (a carried one has no time), every decision (an undone one from its audit row) and
 *    every undo (`discrepancy.reopened`).
 */
export async function loadInvoiceHistory(
  db: Database,
  session: { restaurantId: string; role: UserRole; userId: string },
  invoiceId: string,
): Promise<InvoiceHistory | null> {
  const rid = session.restaurantId;
  const me = session.userId;
  const [inv] = await db
    .select({ id: invoices.id, source: invoices.source, createdAt: invoices.createdAt, createdBy: invoices.createdBy, totalInclVat: invoices.totalInclVat })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, rid)))
    .limit(1);
  if (!inv) return null;

  const settings = await loadAreaSettings(db, rid);
  const tz = settings.timeZone;
  const runs = await db
    .select({
      id: matchRuns.id,
      runAt: matchRuns.runAt,
      poId: matchRuns.poId,
      grId: matchRuns.grId,
      runTotal: matchRuns.totalDiscrepancyAmount,
      poSentAt: purchaseOrders.sentAt,
      grReceivedAt: goodsReceipts.receivedAt,
      grReceivedBy: goodsReceipts.receivedBy,
      grClosed: sql<boolean>`${goodsReceipts.status} IN ('completed', 'partial')`,
    })
    .from(matchRuns)
    .leftJoin(purchaseOrders, and(eq(purchaseOrders.id, matchRuns.poId), eq(purchaseOrders.restaurantId, rid)))
    .leftJoin(goodsReceipts, and(eq(goodsReceipts.id, matchRuns.grId), eq(goodsReceipts.restaurantId, rid)))
    .where(and(eq(matchRuns.invoiceId, inv.id), eq(matchRuns.restaurantId, rid)))
    .orderBy(asc(matchRuns.runAt), asc(matchRuns.id));

  const gaps = runs.length
    ? (
        await db
          .select({
            id: discrepancies.id,
            matchRunId: discrepancies.matchRunId,
            type: discrepancies.type,
            severity: discrepancies.severity,
            status: discrepancies.resolutionStatus,
            routing: discrepancies.requiresRole,
            ruleId: discrepancies.ruleId,
            createdAt: discrepancies.createdAt,
            resolvedAt: discrepancies.resolvedAt,
            resolvedBy: discrepancies.resolvedBy,
            deltaAmount: discrepancies.deltaAmount,
            expectedValue: discrepancies.expectedValue,
            actualValue: discrepancies.actualValue,
            toleranceUsed: discrepancies.toleranceUsed,
          })
          .from(discrepancies)
          .where(and(eq(discrepancies.restaurantId, rid), inArray(discrepancies.matchRunId, runs.map((r) => r.id))))
          .orderBy(asc(discrepancies.createdAt), asc(discrepancies.id))
      )
        .map((g) => ({ ...g, type: String(g.type), severity: String(g.severity), status: String(g.status) }))
        .filter(reachedAPerson)
    : [];

  const audits = gaps.length
    ? await db
        .select({ id: auditLog.id, entityId: auditLog.entityId, at: auditLog.at, userId: auditLog.userId, action: auditLog.action, before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, rid),
            eq(auditLog.entityType, 'discrepancy'),
            inArray(auditLog.action, ['discrepancy.escalated', 'discrepancy.approved', 'discrepancy.rejected', 'discrepancy.reopened']),
            inArray(auditLog.entityId, gaps.map((g) => g.id)),
          ),
        )
        .orderBy(asc(auditLog.at), asc(auditLog.id))
    : [];

  // The role each recorder holds in this restaurant (memberships are readable within the tenant).
  const people = [...new Set([inv.createdBy, ...runs.map((r) => r.grReceivedBy)].filter((v): v is string => !!v))];
  const roleOf = new Map<string, UserRole>();
  if (people.length) {
    const ms = await db
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.restaurantId, rid), inArray(memberships.userId, people)));
    for (const m of ms) roleOf.set(m.userId, m.role as UserRole);
  }
  const memberRole = (userId: string | null): HistoryActor => (userId ? (roleOf.get(userId) ?? null) : null);

  // A re-match deletes the runs and writes new gap rows; each run writes one `invoice_matched`.
  const [matched] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.restaurantId, rid),
        eq(activityEvents.eventType, 'invoice_matched'),
        sql`${activityEvents.metadata} ->> 'invoiceId' = ${inv.id}`,
      ),
    );

  type Keyed = { event: HistoryEvent; sortAt: number };
  const out: Keyed[] = [];
  const push = (event: HistoryEvent, sortAt: Date) => out.push({ event, sortAt: sortAt.getTime() });

  const seenPo = new Set<string>();
  const seenGr = new Set<string>();
  for (const r of runs) {
    // Only an order that was sent: an imported order carries no send time (and no event).
    if (r.poId && r.poSentAt && !seenPo.has(r.poId)) {
      seenPo.add(r.poId);
      push({ kind: 'order_sent', at: r.poSentAt, gapId: null, by: null, byYou: false }, r.poSentAt);
    }
    if (r.grId && r.grReceivedAt && !seenGr.has(r.grId)) {
      seenGr.add(r.grId);
      push(
        {
          kind: 'goods_received',
          at: r.grReceivedAt,
          gapId: null,
          by: memberRole(r.grReceivedBy),
          byYou: r.grReceivedBy === me,
          counted: r.grClosed === true,
        },
        r.grReceivedAt,
      );
    }
  }
  // A typed invoice was entered by a person; every other source was read by the product.
  push(
    {
      kind: 'invoice_read',
      at: inv.createdAt,
      gapId: null,
      by: inv.source === 'manual' ? memberRole(inv.createdBy) : 'system',
      byYou: inv.source === 'manual' && inv.createdBy === me,
      source: inv.source,
    },
    inv.createdAt,
  );
  for (const r of runs) {
    push(
      { kind: 'checked', at: r.runAt, gapId: null, by: 'system', byYou: false, gapsFound: gaps.filter((g) => g.matchRunId === r.id).length },
      r.runAt,
    );
  }

  const runOf = new Map(runs.map((r) => [r.id, r]));
  let carriedSeen = false;
  for (const g of gaps) {
    const run = runOf.get(g.matchRunId);
    const trail = audits.filter((a) => a.entityId === g.id);
    const escalations = trail.filter((a) => a.action === 'discrepancy.escalated');
    const first = escalations[0];
    const firstBefore = (first?.before ?? null) as Json | null;
    const firstAfter = (first?.after ?? {}) as Json;
    const firstRole: GapRole = first
      ? firstBefore && 'requiresRole' in firstBefore
        ? gapRoleOf(firstBefore.requiresRole as string | null)
        : (asGapRole(firstAfter.fromRole) ?? gapRoleOf(g.routing))
      : gapRoleOf(g.routing);
    const reason = provenReason(
      {
        ruleId: g.ruleId,
        type: g.type,
        severity: g.severity,
        deltaAmount: g.deltaAmount,
        expectedValue: g.expectedValue,
        actualValue: g.actualValue,
        toleranceUsed: g.toleranceUsed,
        runTotal: run?.runTotal ?? null,
        invoiceTotal: inv.totalInclVat,
        runHasPo: run?.poId != null,
      },
      settings,
    );
    push({ kind: 'routed', at: g.createdAt, gapId: g.id, by: 'system', byYou: false, role: firstRole, reason }, g.createdAt);

    // The current decision's own audit row (the latest approved / rejected one, when it records
    // the same decision): the record equals `invoices.detail` and `lastDecision`.
    const decidedNow = isPersonDecision({ status: g.status, resolvedAt: g.resolvedAt });
    const decisionRows = trail.filter((a) => a.action === 'discrepancy.approved' || a.action === 'discrepancy.rejected');
    const lastDecisionRow = decisionRows[decisionRows.length - 1];
    const currentRow =
      decidedNow && lastDecisionRow && (lastDecisionRow.action === 'discrepancy.approved') === (g.status !== 'rejected')
        ? lastDecisionRow
        : undefined;
    const decided = { id: g.id, invoiceId: inv.id, type: g.type, deltaAmount: g.deltaAmount };

    for (const a of trail) {
      const before = (a.before ?? {}) as Json;
      const after = (a.after ?? {}) as Json;
      const auditOf = { at: a.at, userId: a.userId, action: a.action, before, after };
      if (a.action === 'discrepancy.escalated') {
        const fromRole = asGapRole(after.fromRole);
        if (fromRole === 'owner') continue; // the owner's own re-escalation passes nothing on
        const carried = after.carried === true;
        if (carried) carriedSeen = true;
        const passedOn: PassedOn = {
          byRole: fromRole,
          at: carried ? null : a.at,
          waitedDays: carried ? null : Math.max(0, daysBetweenIn(g.createdAt, a.at, tz)),
          carried,
        };
        // A carried pass-on has no time of its own: it is placed with the gap's row.
        push(
          { kind: 'passed_on', at: passedOn.at, gapId: g.id, by: passedOn.byRole, byYou: a.userId === me, passedOn },
          carried ? g.createdAt : a.at,
        );
      } else if (a.action === 'discrepancy.reopened') {
        push(
          {
            kind: 'undone',
            at: a.at,
            gapId: g.id,
            by: asGapRole(after.role),
            byYou: a.userId === me,
            undid: before.status === 'escalated' ? 'pass_on' : 'decision',
            role: asGapRole(after.role),
          },
          a.at,
        );
      } else if (a === currentRow) {
        const decision = decisionRecordOf(
          { ...decided, status: g.status, resolvedAt: g.resolvedAt!, resolvedBy: g.resolvedBy },
          auditOf,
          me,
        );
        push({ kind: 'decided', at: decision.at, gapId: g.id, by: decision.role, byYou: decision.byYou, decision }, decision.at);
      } else {
        // A decision that was undone later: its own audit row says what it was.
        const decision = decisionRecordOf(
          {
            ...decided,
            status: a.action === 'discrepancy.approved' ? 'accepted' : 'rejected',
            resolvedAt: a.at,
            resolvedBy: a.userId,
          },
          auditOf,
          me,
        );
        push({ kind: 'decided', at: decision.at, gapId: g.id, by: decision.role, byYou: decision.byYou, decision }, decision.at);
      }
    }
    // A decision with no audit row of its own (carried through a re-match, or seeded).
    if (decidedNow && !currentRow) {
      if (run && g.resolvedAt!.getTime() < run.runAt.getTime()) carriedSeen = true;
      const decision = decisionRecordOf({ ...decided, status: g.status, resolvedAt: g.resolvedAt!, resolvedBy: g.resolvedBy }, undefined, me);
      push({ kind: 'decided', at: decision.at, gapId: g.id, by: decision.role, byYou: decision.byYou, decision }, decision.at);
    }
  }

  out.sort(
    (a, b) =>
      b.sortAt - a.sortAt ||
      KIND_RANK[b.event.kind] - KIND_RANK[a.event.kind] ||
      (a.event.gapId ?? '').localeCompare(b.event.gapId ?? ''),
  );
  return { events: out.map((k) => k.event), rematched: (matched?.n ?? 0) > 1 || carriedSeen };
}

// ───────────────────────────────────────────────────────────────────────────────
// Slice 6 · `approvals.decided`: a person's decisions of a period, by the restaurant's day.
// ───────────────────────────────────────────────────────────────────────────────

/** At most this many rows a call (newest first); `count` still counts every decision of the period. */
export const DECIDED_MAX_ROWS = 1000;

/** The desk's own filters, as `approvals.myQueue` takes them. */
export interface DecidedFilters {
  types?: ReadonlyArray<DiscrepancyRow['type']>;
  severities?: ReadonlyArray<DiscrepancyRow['severity']>;
  supplierIds?: ReadonlyArray<string>;
  invoiceIds?: ReadonlyArray<string>;
}

/**
 * `approvals.decided`: every gap of the caller's restaurant a person decided in the period
 * (`resolved_at` inside `periodBounds`, on the restaurant's calendar), newest first, each with
 * every key of a queue row and the decision (`decisionsOf`: the role, in whose place, the
 * reason), plus the head's count and ₪. Not role-scoped: the desk shows "הוחלט היום" to every
 * role that reads it (`byYou` marks the caller's). An undone decision has no `resolved_at`, so
 * it leaves the list; what the system closed by itself never enters it; nor does the ₪0 twin.
 */
export async function loadDecided(
  db: Database,
  session: { restaurantId: string; userId: string },
  opts: { period: DecidedPeriod; filters?: DecidedFilters; now?: Date },
): Promise<DecidedList> {
  const rid = session.restaurantId;
  const f = opts.filters ?? {};
  const empty: DecidedList = { rows: [], count: 0, amountAgorot: { excl: 0, incl: 0, vat: 0 } };
  if (f.invoiceIds && f.invoiceIds.length === 0) return empty;
  const { timeZone } = await loadAreaSettings(db, rid);
  const { from, to } = periodBounds(opts.period, opts.now ?? new Date(), timeZone);
  const where = and(
    eq(discrepancies.restaurantId, rid),
    inArray(discrepancies.resolutionStatus, [...DECIDED_STATUSES]),
    isNotNull(discrepancies.resolvedAt),
    gte(discrepancies.resolvedAt, from),
    lt(discrepancies.resolvedAt, to),
    notZeroShortTwin(),
    f.types?.length ? inArray(discrepancies.type, [...f.types]) : undefined,
    f.severities?.length ? inArray(discrepancies.severity, [...f.severities]) : undefined,
    f.supplierIds?.length ? inArray(invoices.supplierId, [...f.supplierIds]) : undefined,
    f.invoiceIds?.length ? inArray(matchRuns.invoiceId, [...f.invoiceIds]) : undefined,
  );
  const rows = await db
    .select({
      id: discrepancies.id,
      type: discrepancies.type,
      severity: discrepancies.severity,
      resolutionStatus: discrepancies.resolutionStatus,
      requiredRole: discrepancies.requiresRole,
      deltaAmount: discrepancies.deltaAmount,
      expectedValue: discrepancies.expectedValue,
      actualValue: discrepancies.actualValue,
      toleranceUsed: discrepancies.toleranceUsed,
      ruleName: discrepancies.ruleName,
      ruleId: discrepancies.ruleId,
      productName: products.canonicalName,
      productNameEn: products.nameEn,
      supplierName: suppliers.name,
      supplierNameEn: suppliers.nameEn,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      invoiceDueDate: invoices.dueDate,
      invoiceStatus: invoices.status,
      hasScan: sql<boolean>`EXISTS (SELECT 1 FROM invoice_scans s WHERE s.invoice_id = ${invoices.id} AND s.restaurant_id = ${rid})`.mapWith(Boolean),
      message: discrepancies.resolutionNote,
      createdAt: discrepancies.createdAt,
      matchRunId: discrepancies.matchRunId,
      invoiceId: matchRuns.invoiceId,
      invoiceLineId: discrepancies.invoiceLineId,
      lineDescription: invoiceLines.rawDescription,
      lineDescriptionEn: invoiceLines.rawDescriptionEn,
      qtyBilled: invoiceLines.qtyBilled,
      billedUnit: invoiceLines.unit,
      unitPriceBilled: invoiceLines.unitPriceBilled,
      lineTotal: invoiceLines.lineTotal,
      qtyOrdered: poLines.qtyOrdered,
      orderedUnit: poLines.unit,
      unitPriceExpected: poLines.unitPriceExpected,
      qtyReceived: grLines.qtyReceived,
      poId: purchaseOrders.id,
      poRef: purchaseOrders.sourceRef,
      poDate: sql<Date | null>`COALESCE(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt})`.mapWith(
        (v: unknown) => (v == null ? null : new Date(String(v))),
      ),
      resolvedAt: discrepancies.resolvedAt,
      resolvedBy: discrepancies.resolvedBy,
    })
    .from(discrepancies)
    .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, rid)))
    .leftJoin(products, and(eq(products.id, discrepancies.productId), eq(products.restaurantId, rid)))
    .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
    .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
    // Child tables carry no restaurant_id: scoped through the parent invoice / PO (as myQueue).
    .leftJoin(invoiceLines, and(eq(invoiceLines.id, discrepancies.invoiceLineId), eq(invoiceLines.invoiceId, invoices.id)))
    .leftJoin(poLines, eq(poLines.id, discrepancies.poLineId))
    .leftJoin(purchaseOrders, and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, rid)))
    .leftJoin(grLines, eq(grLines.id, discrepancies.grLineId))
    .where(where)
    .orderBy(desc(discrepancies.resolvedAt), desc(discrepancies.id))
    .limit(DECIDED_MAX_ROWS);
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(discrepancies)
    .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, rid)))
    .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
    .where(where);

  const decided = rows
    .filter((r) => r.resolvedAt != null && r.invoiceId != null)
    .map((r) => ({
      id: r.id,
      invoiceId: r.invoiceId!,
      type: String(r.type),
      status: String(r.resolutionStatus),
      resolvedAt: r.resolvedAt!,
      resolvedBy: r.resolvedBy,
      deltaAmount: r.deltaAmount,
    }));
  const records = await decisionsOf(db, session, decided);
  // The rule that first routed each gap (proven numbers, as in the queue and the history).
  const facts = await gapFactsOf(
    db,
    rid,
    rows.map((r) => ({ ...r, type: String(r.type), severity: String(r.severity), resolutionStatus: String(r.resolutionStatus) })),
  );
  const out: DecidedRow[] = [];
  const amountAgorot = { excl: 0, incl: 0, vat: 0 };
  for (const { resolvedAt: _at, resolvedBy: _by, ...r } of rows) {
    const decision = records.get(r.id);
    if (!decision) continue;
    amountAgorot[decision.basis] += decision.amountAgorot;
    const claimed = (decision.result === 'credit' || decision.result === 'duplicate_held') && decision.amountAgorot > 0;
    // A PO line from another tenant is never joined (its PO join is tenant-scoped): no orphan facts.
    const po = r.poId ? r : { ...r, qtyOrdered: null, orderedUnit: null, unitPriceExpected: null, poRef: null, poDate: null };
    out.push({
      ...po,
      claimable: claimed,
      claimAgorot: claimed ? decision.amountAgorot : 0,
      canAct: false,
      waitingOn: (r.requiredRole ?? 'unrouted') as AwaitingRouting,
      reason: facts.reasonOf({ id: r.id, ruleId: r.ruleId, type: String(r.type) }),
      passedOn: null,
      routing: gapRoleOf(r.requiredRole),
      since: r.createdAt,
      claimBasis: gapBasisOf(String(r.type)),
      decision,
    });
  }
  return { rows: out, count: Math.max(counted?.n ?? 0, out.length), amountAgorot };
}
