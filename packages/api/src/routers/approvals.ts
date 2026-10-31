import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
  activityEvents,
  auditLog,
  desc,
  discrepancies,
  discrepancyType,
  eq,
  grLines,
  inArray,
  invoiceLines,
  isNull,
  invoices,
  lt,
  matchRuns,
  poLines,
  products,
  purchaseOrders,
  severity as severityEnum,
  sql,
  suppliers,
  users,
  type UserRole,
} from '@restomatch/db';
import { LEAK_FILTER, notZeroShortTwin, type LeakBreakdownInvoice } from '@restomatch/charts';
import { authedProcedure, financeProcedure, memberProcedure, router } from '../trpc';
import { canActOn, expandVisibleRoles } from '../lib/roles';
import { claimableLines, sumClaims, type VatBasis } from '../lib/claims';
import { formatIlsAgorot } from '../reports/money';
import { DECISION_COPY } from '../notifications/templates';
import { materializeClaims, NEVER_CLAIMABLE_TYPES } from '../recovery/service';
import { awaitingDecision, type AwaitingRouting } from '../approvals/awaiting';
import {
  bulkRefusals,
  DECIDE_MANY_MAX_ITEMS,
  quickApproveRefusal,
  type BulkRefusal,
} from '../approvals/bulkPolicy';
import { recipientsForRestaurant } from '../notifications/recipients';
import { enqueueNotification } from '../notifications/outbox';
import { stripTrailingSlashes } from '../lib/urls';
import type { Database } from '@restomatch/db';

const ResolutionEnum = z.enum(['accepted', 'rejected', 'escalated']);

/**
 * Who may decide a discrepancy at all. The approval engine routes
 * DUPLICATE_INVOICE to the bookkeeper (the person who would pay it twice), but
 * approve/reject/escalate used to be manager-only — so the bookkeeper got the
 * notification and could not act, and a manager could not even see the item
 * (role deadlock, W2). The bookkeeper may now act on bookkeeper-routed items
 * only; `ensureCanAct` still enforces the per-discrepancy `requires_role`.
 */
const DECIDER_ROLES: ReadonlyArray<UserRole> = ['owner', 'manager', 'bookkeeper'];
const deciderProcedure = memberProcedure.use(({ ctx, next }) => {
  if (!DECIDER_ROLES.includes(ctx.session.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Required role: ${DECIDER_ROLES.join('|')}, got: ${ctx.session.role}`,
    });
  }
  return next();
});

/** Receiver / chef: FORBIDDEN on every approvals read and write. */
function assertDecider(role: UserRole): void {
  if (!DECIDER_ROLES.includes(role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Required role: ${DECIDER_ROLES.join('|')}, got: ${role}` });
  }
}

/** Only these rows are still a decision; every write is conditioned on it (approvals-11). */
const OPEN_STATUSES = ['open', 'escalated'] as const;

/**
 * Undo window for `reopen`. The client shows a 10 s undo toast; the server
 * allows a little more so a tap at second 9.9 on a slow phone still lands.
 */
export const REOPEN_WINDOW_MS = 15_000;

/**
 * One-tap waive reasons (approvals-05). Stored as `reasonCode` in the audit
 * `after` so claims and the H6 learning loop can read them; the human text the
 * chip shows goes in `reason` as before.
 */
export const WAIVE_REASON_CODES = [
  'price_agreed',
  'promo_missing',
  'received_actual',
  'arrives_later',
  'credited_elsewhere',
  'not_duplicate',
  'negligible',
  'rule_wrong',
  'reviewed',
  'other',
] as const;

/**
 * The machine-readable CONFLICT a stale card gets: who decided, as what, when.
 * The message is JSON (prefixed) so the client can say "כבר הוחלט ע״י הבעלים ·
 * 14:02" without a new app error code. `name` is null when the decider's user
 * row is not readable on the tenant connection (RLS: users are self-only).
 */
export const DECIDED_CONFLICT_PREFIX = 'approvals.decided:';

/**
 * Is there ₪ to claim on this open row? The charts LEAK_FILTER (warn/block, not
 * PRICE_LOWER / UNORDERED_ARRIVAL) plus a non-zero ₪, minus MISSING_ON_INVOICE:
 * a line that was ordered but never billed has nothing to ask back. A row that
 * fails it is a check ("סמנו כנבדק"), never "דרוש ₪X" — the UI keys its verbs on
 * this, and queueSummary splits "להחלטה (₪)" from "לבדיקה (ללא ₪)".
 */
// ONE never-claimable set (owner decision 31.10), shared with the claims side.
const NEVER_CLAIMABLE = new Set<string>(NEVER_CLAIMABLE_TYPES);
export function isClaimableRow(r: { type: string; severity: string; deltaAmount: string | null }): boolean {
  return (
    (r.severity === 'warn' || r.severity === 'block') &&
    !NEVER_CLAIMABLE.has(r.type) &&
    Math.abs(Number(r.deltaAmount ?? 0)) > 0
  );
}
export interface DecidedConflict {
  status: string;
  role: string | null;
  name: string | null;
  at: string | null;
  self: boolean;
}

const ApprovalQueueItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  severity: z.string(),
  resolutionStatus: z.string(),
  requiredRole: z.string().nullable(),
  deltaAmount: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.date(),
  matchRunId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable(),
});
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItemSchema>;

/** View filters shared by myQueue and queueSummary (all optional, all enumerated). */
const QueueFilters = {
  types: z.array(z.enum(discrepancyType.enumValues)).max(12).optional(),
  severities: z.array(z.enum(severityEnum.enumValues)).max(3).optional(),
  supplierIds: z.array(z.string().uuid()).max(50).optional(),
  /** One invoice's rows (the notification landing: `?invoice=<id>`). Foreign ids match nothing. */
  invoiceIds: z.array(z.string().uuid()).max(50).optional(),
};
type QueueFilterInput = {
  types?: (typeof discrepancyType.enumValues)[number][];
  severities?: (typeof severityEnum.enumValues)[number][];
  supplierIds?: string[];
  invoiceIds?: string[];
};

function filterWhere(input: QueueFilterInput | undefined) {
  return [
    input?.types?.length ? inArray(discrepancies.type, input.types) : undefined,
    input?.severities?.length ? inArray(discrepancies.severity, input.severities) : undefined,
    input?.supplierIds?.length ? inArray(invoices.supplierId, input.supplierIds) : undefined,
    input?.invoiceIds?.length ? inArray(matchRuns.invoiceId, input.invoiceIds) : undefined,
  ];
}

/** block → warn → info, then the invoice that is due first, then the biggest ₪ (approvals-14). */
const SEVERITY_RANK = sql`CASE ${discrepancies.severity} WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END`;

/**
 * The priority order as one all-ascending key (severity, due date — none last,
 * biggest ₪, newest, id), so "rows after X" is a row-value comparison. The
 * subquery recomputes X's key from the row itself, whatever its status now.
 */
const PRIORITY_KEY = sql`(${SEVERITY_RANK},
  COALESCE(EXTRACT(EPOCH FROM ${invoices.dueDate}), 'Infinity'::numeric),
  -ABS(COALESCE(${discrepancies.deltaAmount}, 0)),
  -EXTRACT(EPOCH FROM ${discrepancies.createdAt}),
  ${discrepancies.id})`;
function afterRow(restaurantId: string, afterId: string) {
  return sql`${PRIORITY_KEY} > (
    SELECT CASE d2.severity WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
      COALESCE(EXTRACT(EPOCH FROM i2.due_date), 'Infinity'::numeric),
      -ABS(COALESCE(d2.delta_amount, 0)),
      -EXTRACT(EPOCH FROM d2.created_at),
      d2.id
    FROM discrepancies d2
    JOIN match_runs m2 ON m2.id = d2.match_run_id AND m2.restaurant_id = ${restaurantId}
    LEFT JOIN invoices i2 ON i2.id = m2.invoice_id AND i2.restaurant_id = ${restaurantId}
    WHERE d2.id = ${afterId}::uuid AND d2.restaurant_id = ${restaurantId}
  )`;
}

export const approvalsRouter = router({
  /**
   * Items waiting for my role to decide.
   * - Owner sees all items where requires_role IN (owner, manager, bookkeeper).
   * - Manager sees items where requires_role = manager.
   * - Bookkeeper sees items requiring bookkeeper.
   *
   * Default order is priority (severity → invoice due date → ₪), paged by
   * `offset` (the number of rows the client still holds — decided rows have
   * left the server set too). The legacy `cursor` keeps the createdAt-desc
   * keyset order for older callers (the mobile app).
   */
  myQueue: memberProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).default(50),
          // NON-BREAKING: ISO cursor → only rows strictly older than it, newest
          // first. Return shape stays an array.
          cursor: z.string().datetime().optional(),
          offset: z.number().int().min(0).max(10_000).optional(),
          // Keyset paging in the priority order: rows strictly after this row's
          // sort key. Robust to rows decided elsewhere (an offset would skip).
          afterId: z.string().uuid().optional(),
          /**
           * `mine` (default): the rows I decide. `all`: every open row a decider
           * role may read (the bookkeeper reads everything, decides only
           * bookkeeper-routed rows; an escalator keeps seeing what it handed on).
           * Each row says `canAct` and `waitingOn` either way (additive output).
           */
          scope: z.enum(['mine', 'all']).optional(),
          ...QueueFilters,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const cursorDate = input?.cursor ? new Date(input.cursor) : null;
      const scope = input?.scope ?? 'mine';
      // Receiver / chef never read the decision queue (no purchase ₪ for them).
      assertDecider(ctx.session.role);
      const roles = expandVisibleRoles(ctx.session.role);
      const rid = ctx.session.restaurantId;
      const base = ctx.db
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
          // Stable rule id → the UI translates the routing reason (ruleName is
          // stored in Hebrew with thresholds baked in).
          ruleId: discrepancies.ruleId,
          productName: products.canonicalName,
          productNameEn: products.nameEn,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDueDate: invoices.dueDate,
          // Decision 19: the effect line names the channel by invoice state
          // (unpaid → offset at payment, paid → credit claim).
          invoiceStatus: invoices.status,
          // The evidence pane shows /scans/<invoiceId>/file when a scan exists.
          hasScan: sql<boolean>`EXISTS (SELECT 1 FROM invoice_scans s WHERE s.invoice_id = ${invoices.id} AND s.restaurant_id = ${rid})`.mapWith(Boolean),
          message: discrepancies.resolutionNote, // reuse field for now
          createdAt: discrepancies.createdAt,
          matchRunId: discrepancies.matchRunId,
          // Invoice behind this discrepancy → deep-link to the OCR correction screen.
          invoiceId: matchRuns.invoiceId,
          // Why-line facts (approvals-06): what was billed, against which order.
          invoiceLineId: discrepancies.invoiceLineId,
          // The line's own text: the card's name when the line has no catalog product.
          lineDescription: invoiceLines.rawDescription,
          lineDescriptionEn: invoiceLines.rawDescriptionEn,
          qtyBilled: invoiceLines.qtyBilled,
          billedUnit: invoiceLines.unit,
          qtyOrdered: poLines.qtyOrdered,
          orderedUnit: poLines.unit,
          qtyReceived: grLines.qtyReceived,
          poId: purchaseOrders.id,
          poRef: purchaseOrders.sourceRef,
          poDate: sql<Date | null>`COALESCE(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt})`.mapWith(
            (v: unknown) => (v == null ? null : new Date(String(v))),
          ),
        })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .leftJoin(products, and(eq(products.id, discrepancies.productId), eq(products.restaurantId, rid)))
        .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
        .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
        // Child tables carry no restaurant_id: scope them through the parent invoice / PO.
        .leftJoin(
          invoiceLines,
          and(eq(invoiceLines.id, discrepancies.invoiceLineId), eq(invoiceLines.invoiceId, invoices.id)),
        )
        .leftJoin(poLines, eq(poLines.id, discrepancies.poLineId))
        .leftJoin(
          purchaseOrders,
          and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, rid)),
        )
        .leftJoin(grLines, eq(grLines.id, discrepancies.grLineId))
        .where(
          and(
            eq(discrepancies.restaurantId, rid),
            inArray(discrepancies.resolutionStatus, [...OPEN_STATUSES]),
            notZeroShortTwin(),
            scope === 'mine' ? inArray(discrepancies.requiresRole, roles) : undefined,
            cursorDate ? lt(discrepancies.createdAt, cursorDate) : undefined,
            !cursorDate && input?.afterId ? afterRow(rid, input.afterId) : undefined,
            ...filterWhere(input),
          ),
        );
      const rows = cursorDate
        ? await base.orderBy(desc(discrepancies.createdAt)).limit(limit)
        : await base
            .orderBy(PRIORITY_KEY)
            .limit(limit)
            .offset(input?.afterId ? 0 : (input?.offset ?? 0));
      // A PO line from another tenant can never be joined in (its PO join is
      // tenant-scoped); drop its orphan facts rather than show them.
      // The claimable ₪ per row (lib/claims rule, per-invoice cap): the group
      // header, the BatchBar Σ and `seenClaimAgorot` on approve all read it.
      const claims = await claimsByRow(ctx.db, rid, rows.filter(isClaimableRow));
      return rows.map((r) => ({
        ...(r.poId ? r : { ...r, qtyOrdered: null, orderedUnit: null, poRef: null, poDate: null }),
        claimable: isClaimableRow(r),
        claimAgorot: isClaimableRow(r) ? Math.round((claims.get(r.id)?.amount ?? 0) * 100) : 0,
        canAct: canActOn(ctx.session.role, r.requiredRole),
        /** Who decides it: its routed role, or 'unrouted' (owner / manager). */
        waitingOn: (r.requiredRole ?? 'unrouted') as AwaitingRouting,
      }));
    }),

  /**
   * Server totals for the queue tiles (approvals-08): independent of paging, so
   * they stay right with > 50 items, after "טען עוד" and after a decision.
   *
   *  • count / blockers / oldest — over the viewer's own queue under the filters;
   *  • claimableIls — the lib/claims rule (the credit letters' per-invoice cap),
   *    restricted to the queue's own claimable lines, 2 dp, ONE basis: before
   *    VAT. A duplicate's ₪ (incl. VAT) is `duplicateIls`; a VAT mismatch (a VAT
   *    amount) is `vatIls` — never added to the before-VAT figure;
   *  • toDecide / toReview — the viewer's rows split by isClaimableRow:
   *    "להחלטה (₪)" carries the claimable ₪, "לבדיקה (ללא ₪)" is a count only
   *    (W1-05 reads toDecide for the manager's ₪ awaiting);
   *  • others — finance roles only: open decisions waiting for OTHER roles
   *    (functional-flows-07), so an empty queue never says "all handled" while
   *    the owner still has items.
   *
   * Known limit until W2-13: these counts read the open discrepancy rows of
   * every match run of an invoice. After a re-match, rows of the superseded run
   * that were never decided still count (here and in the others lane), and the
   * decider named on a CONFLICT is read back from audit_log, which carries no
   * match-run id. W2-13 scopes both to the invoice's latest run.
   */
  queueSummary: memberProcedure.input(z.object(QueueFilters).optional()).query(async ({ ctx, input }) => {
    // ONE definition (G-12a): the same rows and ₪ as home, the nav badge and the
    // digest e-mail. This procedure only maps `awaitingDecision` to its shape.
    const session = { restaurantId: ctx.session.restaurantId, role: ctx.session.role };
    const filters = {
      types: input?.types,
      severities: input?.severities,
      supplierIds: input?.supplierIds,
      invoiceIds: input?.invoiceIds,
    };
    const showOthers = DECIDER_ROLES.includes(ctx.session.role);
    const [mine, all] = await Promise.all([
      awaitingDecision(ctx.db, { session }, { scope: 'mine', filters }),
      showOthers ? awaitingDecision(ctx.db, { session }, { scope: 'all', filters }) : null,
    ]);
    const claimableIls = mine.ils?.excl ?? 0;
    // Others lane: the routings I do not decide (incl. unrouted), before-VAT ₪
    // like the tile. A lane is exactly one stored routing, so mine ∪ others = all.
    const lanes = (all?.byRole ?? []).filter(
      (l) => l.role === 'unrouted' || !canActOn(ctx.session.role, l.role),
    );
    const laneAgorot = (l: (typeof lanes)[number]) => Math.round((l.ils?.excl ?? 0) * 100);
    return {
      count: mine.count,
      blockers: mine.blockers,
      oldestAt: mine.oldestAt,
      claimableIls,
      duplicateIls: mine.ils?.incl ?? 0,
      vatIls: mine.ils?.vat ?? 0,
      toDecide: { count: mine.toDecide.count, amountIls: claimableIls },
      toReview: { count: mine.reviewOnly.count },
      others: {
        count: lanes.reduce((n, l) => n + l.count, 0),
        amountIls: lanes.reduce((n, l) => n + laneAgorot(l), 0) / 100,
        byRole: lanes.map((l) => ({ role: l.role as string, count: l.count, amountIls: laneAgorot(l) / 100 })),
      },
    };
  }),

  /**
   * Approve one row: the decision, its audit row, the claim (W2-10a
   * `materializeClaims`, created_by = the decider) and the activity row in ONE
   * transaction. `channel: 'quick'` is the one-tap path (H-05 wires the button):
   * refused for a blocking row or claimable ₪ > ₪500. `seenClaimAgorot` = the ₪
   * the decider saw; if the claimable ₪ moved since, CONFLICT (nothing written).
   */
  approve: deciderProcedure
    .input(
      z.object({
        discrepancyId: z.string().uuid(),
        note: z.string().max(500).optional(),
        channel: z.enum(['desk', 'quick']).optional(),
        expectedStatus: z.enum(OPEN_STATUSES).optional(),
        seenClaimAgorot: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTx(ctx, async (tx) => {
        const row = await loadDecisionRows(tx, ctx, [input.discrepancyId]).then((m) => m.get(input.discrepancyId)!);
        if (input.channel === 'quick') {
          const why = quickApproveRefusal(row);
          if (why) {
            throw new TRPCError({ code: 'FORBIDDEN', message: QUICK_REFUSED_PREFIX + JSON.stringify({ reason: why }) });
          }
        }
        const { updated } = await decide(tx, ctx, row, {
          decision: 'accepted',
          note: input.note ?? null,
          expectedStatus: input.expectedStatus,
          seenClaimAgorot: input.seenClaimAgorot,
          channel: input.channel ?? 'desk',
        });
        return updated;
      }),
    ),

  reject: deciderProcedure
    .input(
      z.object({
        discrepancyId: z.string().uuid(),
        reason: z.string().min(1).max(500),
        reasonCode: z.enum(WAIVE_REASON_CODES).optional(),
        expectedStatus: z.enum(OPEN_STATUSES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTx(ctx, async (tx) => {
        const row = await loadDecisionRows(tx, ctx, [input.discrepancyId]).then((m) => m.get(input.discrepancyId)!);
        const { updated } = await decide(tx, ctx, row, {
          decision: 'rejected',
          reason: input.reason,
          reasonCode: input.reasonCode ?? null,
          expectedStatus: input.expectedStatus,
          channel: 'desk',
        });
        return updated;
      }),
    ),

  /**
   * Bulk decide (exec-desktop-08), all-or-nothing in ONE transaction. The
   * SERVER refuses (FORBIDDEN, nothing written) any blocking row and any
   * invoice whose selected claimable ₪ > ₪200 (`BULK_APPROVE_CAP_AGOROT`);
   * a stale `expectedStatus` on any item → CONFLICT with per-item detail and
   * no write. One audit row per item. A replay of the same
   * `clientMutationId` returns the first result and writes nothing.
   */
  decideMany: deciderProcedure
    .input(
      z
        .object({
          items: z
            .array(z.object({ discrepancyId: z.string().uuid(), expectedStatus: z.enum(OPEN_STATUSES) }))
            .min(1)
            .max(DECIDE_MANY_MAX_ITEMS),
          decision: z.enum(['accepted', 'rejected']),
          reasonCode: z.enum(WAIVE_REASON_CODES).optional(),
          reason: z.string().min(1).max(500).optional(),
          clientMutationId: z.string().min(8).max(64),
        })
        .refine((v) => v.decision === 'accepted' || !!v.reason || !!v.reasonCode, {
          message: 'a bulk waive needs a reason',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const replay = await replayOf(ctx, input.clientMutationId);
      if (replay) return replay;
      return inTx(ctx, async (tx) => {
        const ids = [...new Set(input.items.map((i) => i.discrepancyId))];
        const rows = await loadDecisionRows(tx, ctx, ids);
        const refusals = bulkRefusals([...rows.values()].map((r) => ({ ...r, discrepancyId: r.id })));
        if (refusals.size > 0) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              BULK_REFUSED_PREFIX +
              JSON.stringify([...refusals].map(([discrepancyId, reason]) => ({ discrepancyId, reason }))),
          });
        }
        const stale = input.items.filter((i) => rows.get(i.discrepancyId)!.status !== i.expectedStatus);
        if (stale.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              BATCH_CONFLICT_PREFIX +
              JSON.stringify(stale.map((i) => ({ discrepancyId: i.discrepancyId, status: rows.get(i.discrepancyId)!.status }))),
          });
        }
        const reason = input.decision === 'rejected' ? (input.reason ?? input.reasonCode ?? null) : null;
        const decided: Array<{ discrepancyId: string; amountAgorot: number }> = [];
        for (const item of input.items) {
          const row = rows.get(item.discrepancyId)!;
          await decide(tx, ctx, row, {
            decision: input.decision,
            reason,
            reasonCode: input.reasonCode ?? null,
            expectedStatus: item.expectedStatus,
            channel: 'bulk',
            clientMutationId: input.clientMutationId,
          });
          decided.push({ discrepancyId: row.id, amountAgorot: row.claimAgorot });
        }
        return {
          decided,
          totalAgorot: decided.reduce((n, d) => n + d.amountAgorot, 0),
          replayed: false as boolean,
        };
      });
    }),

  /**
   * Hand a row to the owner (functional-flows-03, deep-fix class 14): the
   * routing moves to the owner with its provenance (`fromRole`, `escalatedBy`
   * in the audit), the activity timeline gets a row, and every owner gets a
   * notification with the ₪ and the supplier — queued in the outbox, so the
   * dispatcher's quiet hours apply (never sent in-process). The escalator
   * keeps seeing it via `myQueue({scope:'all'})` (`waitingOn: 'owner'`).
   */
  escalate: deciderProcedure
    .input(
      z.object({
        discrepancyId: z.string().uuid(),
        note: z.string().max(500).optional(),
        expectedStatus: z.enum(OPEN_STATUSES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTx(ctx, async (tx) => {
        const row = await loadDecisionRows(tx, ctx, [input.discrepancyId]).then((m) => m.get(input.discrepancyId)!);
        const { updated, auditId } = await decide(tx, ctx, row, {
          decision: 'escalated',
          note: input.note ?? null,
          expectedStatus: input.expectedStatus,
          channel: 'desk',
        });
        await notifyOwnersOfEscalation(tx, ctx, row, input.note ?? null, auditId);
        return updated;
      }),
    ),

  /**
   * Undo (approvals-04): put a decision back in the queue. Only the person who
   * made it, only inside the undo window, and only while the row still holds
   * exactly that decision (nobody acted since). The prior status, routing and
   * note come from the decision's own audit `before`; a compensating
   * `discrepancy.reopened` audit row records the undo (audit is append-only),
   * the decision's activity row is withdrawn, and the claim the decision
   * created is written off in the same transaction (`materializeClaims`).
   */
  reopen: deciderProcedure
    .input(z.object({ discrepancyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => inTx(ctx, (tx) => reopenOne(tx, ctx, input.discrepancyId))),

  /** Undo a bulk decision: every item or none (one foreign / stale id → nothing changes). */
  reopenMany: deciderProcedure
    .input(z.object({ discrepancyIds: z.array(z.string().uuid()).min(1).max(DECIDE_MANY_MAX_ITEMS) }))
    .mutation(async ({ ctx, input }) =>
      inTx(ctx, async (tx) => {
        const out = [];
        for (const id of new Set(input.discrepancyIds)) out.push(await reopenOne(tx, ctx, id));
        return { reopened: out.map((r) => r.id) };
      }),
    ),

  /**
   * A discrepancy's decision trail, newest first (who, role, when, decision,
   * note) — the same roles that can decide (owner/manager/bookkeeper), not
   * receiver/chef. `limit` for the card's "היסטוריה" disclosure (last 3).
   */
  history: financeProcedure
    .input(z.object({ discrepancyId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const q = ctx.db
        .select({
          id: auditLog.id,
          restaurantId: auditLog.restaurantId,
          userId: auditLog.userId,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          before: auditLog.before,
          after: auditLog.after,
          at: auditLog.at,
          // null when the tenant connection cannot read that user (RLS: users are self-only).
          actorName: users.name,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(
          and(
            eq(auditLog.restaurantId, ctx.session.restaurantId),
            eq(auditLog.entityType, 'discrepancy'),
            eq(auditLog.entityId, input.discrepancyId),
          ),
        )
        .orderBy(desc(auditLog.at), desc(auditLog.id));
      return input.limit ? q.limit(input.limit) : q;
    }),
});

const DECIDED_BY_ACTION: Record<string, string> = {
  'discrepancy.approved': 'accepted',
  'discrepancy.rejected': 'rejected',
  'discrepancy.escalated': 'escalated',
};

/** CONFLICT: the claimable ₪ moved since the decider looked (`{seenAgorot, nowAgorot}`). */
export const AMOUNT_CHANGED_PREFIX = 'approvals.amountChanged:';
/** FORBIDDEN from `decideMany`: `[{discrepancyId, reason: 'block'|'over_cap'}]`. */
export const BULK_REFUSED_PREFIX = 'approvals.bulkRefused:';
/** CONFLICT from `decideMany`: the stale items, `[{discrepancyId, status}]`. */
export const BATCH_CONFLICT_PREFIX = 'approvals.batchConflict:';
/** FORBIDDEN from `approve({channel:'quick'})`: `{reason: 'block'|'over_cap'}`. */
export const QUICK_REFUSED_PREFIX = 'approvals.quickRefused:';
export type { BulkRefusal };

type Decision = 'accepted' | 'rejected' | 'escalated';

/** A row as a decision sees it: state, routing, money and the facts a notification names. */
interface DecisionRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  requiresRole: UserRole | null;
  note: string | null;
  deltaAmount: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  /** The row's claimable ₪ now (lib/claims rule, per-invoice cap), integer agorot; 0 = nothing to claim. */
  claimAgorot: number;
}

/** Every write of a decision runs in ONE transaction (a savepoint when the caller already holds one). */
function inTx<T>(ctx: Ctx, fn: (tx: Database) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (raw) => fn(raw as unknown as Database));
}

/** A side effect that must never roll the decision back (G-05: effects run in savepoints). */
async function inSavepoint(tx: Database, what: string, fn: (sp: Database) => Promise<void>): Promise<void> {
  try {
    await tx.transaction(async (raw) => fn(raw as unknown as Database));
  } catch (err) {
    console.error(`[approvals] ${what} failed (decision kept)`, err);
  }
}

/**
 * Load the rows to decide, in this tenant, and check the caller may act on
 * each (`ensureCanAct` rules). Any id that is not this tenant's → NOT_FOUND
 * (a batch with one foreign id changes nothing).
 */
async function loadDecisionRows(tx: Database, ctx: Ctx, ids: readonly string[]): Promise<Map<string, DecisionRow>> {
  const rid = ctx.session.restaurantId;
  const found = await tx
    .select({
      id: discrepancies.id,
      type: discrepancies.type,
      severity: discrepancies.severity,
      status: discrepancies.resolutionStatus,
      requiresRole: discrepancies.requiresRole,
      note: discrepancies.resolutionNote,
      deltaAmount: discrepancies.deltaAmount,
      invoiceId: matchRuns.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      supplierName: suppliers.name,
    })
    .from(discrepancies)
    .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, rid)))
    .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
    .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
    .where(and(eq(discrepancies.restaurantId, rid), inArray(discrepancies.id, [...ids])));
  if (found.length !== new Set(ids).size) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });
  const tctx = { ...ctx, db: tx };
  for (const r of found) await assertCanAct(tctx, r);
  const amounts = await claimsByRow(tx, rid, found);
  return new Map(
    found.map((r) => {
      const a = amounts.get(r.id);
      return [r.id, { ...r, claimAgorot: a && isClaimableRow(r) ? Math.round(a.amount * 100) : 0 }];
    }),
  );
}

const AUDIT_ACTION: Record<Decision, string> = {
  accepted: 'discrepancy.approved',
  rejected: 'discrepancy.rejected',
  escalated: 'discrepancy.escalated',
};

/**
 * THE decision (deep-fix classes 6 + 7). One call site to swap for G-05's
 * `transition(tx, discrepancyMachine, …)` (from open|escalated, expectedStatus):
 *  1. stale `expectedStatus` or a moved claimable ₪ → CONFLICT, nothing written;
 *  2. the wave-1 CAS update (`checkedRow`) — a concurrent decision → CONFLICT;
 *  3. the audit row records the decision and the ₪ the decider saw
 *     (`after.decision`, `after.amountAgorot` — G-03's column takes it later);
 *  4. the claim, in this transaction, under the decider's name (W2-10a). An
 *     accepted DUPLICATE_INVOICE is held from payment AND claimed (incl. VAT);
 *  5. the activity row (metadata v2, no baked ₪ string), in a savepoint.
 * TODO(G-05): emit('discrepancy.<decision>') once the events kernel is on this base.
 */
async function decide(
  tx: Database,
  ctx: Ctx,
  row: DecisionRow,
  opts: {
    decision: Decision;
    note?: string | null;
    reason?: string | null;
    reasonCode?: string | null;
    expectedStatus?: string;
    seenClaimAgorot?: number;
    channel: 'desk' | 'quick' | 'bulk';
    clientMutationId?: string;
  },
): Promise<{ updated: typeof discrepancies.$inferSelect; auditId: string }> {
  const rid = ctx.session.restaurantId;
  const tctx = { ...ctx, db: tx };
  if (opts.expectedStatus && row.status !== opts.expectedStatus) throw await decidedConflict(tctx, row.id);
  if (opts.seenClaimAgorot !== undefined && opts.seenClaimAgorot !== row.claimAgorot) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: AMOUNT_CHANGED_PREFIX + JSON.stringify({ seenAgorot: opts.seenClaimAgorot, nowAgorot: row.claimAgorot }),
    });
  }
  const now = new Date();
  const set =
    opts.decision === 'escalated'
      ? { resolutionStatus: 'escalated' as const, requiresRole: 'owner' as const, resolutionNote: opts.note ?? null }
      : {
          resolutionStatus: opts.decision,
          resolvedBy: ctx.session.userId,
          resolvedAt: now,
          resolutionNote: opts.decision === 'accepted' ? (opts.note ?? null) : (opts.reason ?? null),
        };
  const [updated] = await tx
    .update(discrepancies)
    .set(set)
    .where(checkedRow(rid, row.id, { status: row.status, requiresRole: row.requiresRole }))
    .returning();
  if (!updated) throw await decidedConflict(tctx, row.id);

  const before = { status: row.status, requiresRole: row.requiresRole, note: row.note };
  const common = {
    decision: opts.decision,
    amountAgorot: row.claimAgorot,
    channel: opts.channel,
    ...(opts.clientMutationId ? { clientMutationId: opts.clientMutationId } : {}),
  };
  const after =
    opts.decision === 'accepted'
      ? { status: 'accepted', note: opts.note ?? null, role: ctx.session.role, ...common }
      : opts.decision === 'rejected'
        ? { status: 'rejected', reason: opts.reason ?? null, reasonCode: opts.reasonCode ?? null, role: ctx.session.role, ...common }
        : { status: 'escalated', note: opts.note ?? null, fromRole: ctx.session.role, escalatedBy: ctx.session.userId, ...common };
  const [audit] = await tx
    .insert(auditLog)
    .values({
      restaurantId: rid,
      userId: ctx.session.userId,
      action: AUDIT_ACTION[opts.decision],
      entityType: 'discrepancy',
      entityId: row.id,
      before,
      after,
    })
    .returning({ id: auditLog.id });

  // An accepted duplicate is BOTH held from payment (pay run, "duplicateHeld"
  // wording) AND claimed (the supplier is asked to cancel it, incl. VAT) —
  // the letters and syncClaims already count it (orchestrator, 31.10).
  const heldDuplicate = opts.decision === 'accepted' && row.type === 'DUPLICATE_INVOICE';
  if (opts.decision !== 'escalated') {
    await materializeClaims(tx, { restaurantId: rid, discrepancyIds: [row.id], actorId: ctx.session.userId });
  }

  const metadata = {
    v: 2,
    decision: opts.decision,
    amountAgorot: row.claimAgorot,
    supplierName: row.supplierName,
    /** |Δ| of the gap itself (may exceed the claimable ₪ after the invoice cap). */
    deltaAgorot: Math.abs(Math.round(Number(row.deltaAmount ?? 0) * 100)),
    invoiceId: row.invoiceId,
    discrepancyType: row.type,
    role: ctx.session.role,
    channel: opts.channel,
    ...(opts.decision === 'rejected' ? { reason: opts.reason ?? null, reasonCode: opts.reasonCode ?? null } : {}),
  };
  if (opts.decision === 'escalated') {
    await logEscalationActivity(tx, ctx, row, metadata);
  } else {
    await inSavepoint(tx, 'activity', async (sp) => {
      await sp.insert(activityEvents).values({
        restaurantId: rid,
        eventType: opts.decision === 'accepted' ? 'discrepancy_approved' : 'discrepancy_rejected',
        title:
          opts.decision === 'accepted'
            ? heldDuplicate
              ? DECISION_COPY.he.duplicateHeld
              : DECISION_COPY.he.approved
            : opts.reasonCode === 'reviewed'
              ? DECISION_COPY.he.reviewed
              : DECISION_COPY.he.rejected,
        // ₪ lives in metadata (amountAgorot); W2-13's feed formats it. The
        // waive reason is the only free text here.
        detail: opts.decision === 'rejected' ? (opts.reason ?? null) : null,
        entityType: 'discrepancy',
        entityId: row.id,
        actorId: ctx.session.userId,
        metadata,
      });
    });
  }
  return { updated, auditId: audit!.id };
}

/**
 * INTERIM(G-05): = `logDomainEvent(tx, {kind: 'discrepancy.escalated', …})`.
 * The `'event'` activity kind ships with G-03; until it is deployed no row is
 * written (the audit row is the trail). Never rolls the decision back.
 */
async function logEscalationActivity(
  tx: Database,
  ctx: Ctx,
  row: DecisionRow,
  metadata: Record<string, unknown>,
): Promise<void> {
  const res = await tx.execute(sql`
    SELECT 1 AS ok FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'activity_event_type' AND e.enumlabel = 'event'`);
  const list = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  if (list.length === 0) return;
  await inSavepoint(tx, 'escalation activity', async (sp) => {
    await sp.insert(activityEvents).values({
      restaurantId: ctx.session.restaurantId,
      eventType: 'event' as never,
      title: DECISION_COPY.he.escalated,
      detail: null,
      entityType: 'discrepancy',
      entityId: row.id,
      actorId: ctx.session.userId,
      metadata: { ...metadata, kind: 'discrepancy.escalated' },
    });
  });
}

/** Public app base URL for deep links (no trailing slash). */
function appBaseUrl(): string {
  return stripTrailingSlashes(process.env.APP_BASE_URL ?? process.env.APP_URL ?? process.env.AUTH_URL ?? 'https://app.restomatch.co.il');
}

/** The branch-aware deep link every approvals notification carries (ia-nav-09). */
export function approvalsGoLink(restaurantId: string, invoiceId: string | null, base = appBaseUrl()): string {
  const to = invoiceId ? `/dashboard/approvals?invoice=${invoiceId}` : '/dashboard/approvals';
  return `${base}/dashboard/go?r=${encodeURIComponent(restaurantId)}&to=${encodeURIComponent(to)}`;
}

/**
 * One outbox row per owner, to a concrete address (never a `role:` target),
 * with the ₪ and the supplier. The dispatcher applies the quiet hours; nothing
 * is sent in-process. INTERIM(G-06): swap the loop for
 * `notify(tx, { audience: { roles: ['owner'] }, event: 'discrepancy.escalated', … })`.
 * TODO(W2-13): the copy moves to an `escalatedToOwnerEmail` template.
 */
async function notifyOwnersOfEscalation(
  tx: Database,
  ctx: Ctx,
  row: DecisionRow,
  note: string | null,
  auditId: string,
): Promise<void> {
  await inSavepoint(tx, 'escalation notification', async (sp) => {
    // The owners' addresses live in `users`, which the tenant (RLS) connection
    // reads self-only — a manager would find no owner at all. Read them on the
    // owner connection (as dsr.ts does), filtered to THIS session's restaurant
    // only; the outbox insert itself stays on the tenant transaction.
    // INTERIM(G-06): notify() resolves the audience.
    const owners = await recipientsForRestaurant(ctx.adminDb ?? sp, ctx.session.restaurantId, ['owner']);
    const link = approvalsGoLink(ctx.session.restaurantId, row.invoiceId);
    const supplier = row.supplierName ?? 'ספק';
    const amount = row.claimAgorot > 0 ? formatIlsAgorot(row.claimAgorot, { maximumFractionDigits: 2 }) : null;
    const subject = `${DECISION_COPY.he.escalated}: פער ${supplier}${amount ? ` · ${amount}` : ''}`;
    const body = [
      `${DECISION_COPY.he.escalated} — ${supplier}${row.invoiceNumber ? ` · ${row.invoiceNumber}` : ''}`,
      amount ? `סכום לדרישת זיכוי: ${amount}` : 'פער לבדיקה (ללא ₪)',
      note ? `הערה: ${note}` : null,
      `לפתיחת הפער: ${link}`,
    ]
      .filter(Boolean)
      .join('\n');
    for (const o of owners) {
      if (o.userId === ctx.session.userId) continue;
      await enqueueNotification(sp, {
        restaurantId: ctx.session.restaurantId,
        channel: 'email',
        target: o.email,
        subject,
        body,
        payload: { kind: 'discrepancy.escalated', discrepancyId: row.id, invoiceId: row.invoiceId, amountAgorot: row.claimAgorot, supplierName: row.supplierName, link },
        relatedEntityType: 'discrepancy',
        relatedEntityId: row.id,
        dedupeKey: `approvals.escalated:${auditId}:${o.userId}`,
      });
    }
  });
}

/**
 * INTERIM(G-05): = the idempotency-keys replay. A `decideMany` already applied
 * under this `clientMutationId` (by this user) returns its result again.
 */
async function replayOf(ctx: Ctx, clientMutationId: string) {
  const rows = await ctx.db
    .select({ entityId: auditLog.entityId, after: auditLog.after })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.restaurantId, ctx.session.restaurantId),
        eq(auditLog.userId, ctx.session.userId),
        eq(auditLog.entityType, 'discrepancy'),
        inArray(auditLog.action, ['discrepancy.approved', 'discrepancy.rejected']),
        sql`${auditLog.after}->>'clientMutationId' = ${clientMutationId}`,
      ),
    );
  if (rows.length === 0) return null;
  const decided = rows.map((r) => ({
    discrepancyId: String(r.entityId),
    amountAgorot: Number((r.after as { amountAgorot?: number } | null)?.amountAgorot ?? 0),
  }));
  return { decided, totalAgorot: decided.reduce((n, d) => n + d.amountAgorot, 0), replayed: true as boolean };
}

/** Undo one decision (see `reopen`); runs inside the caller's transaction. */
async function reopenOne(tx: Database, ctx: Ctx, discrepancyId: string) {
  const rid = ctx.session.restaurantId;
  const [row] = await tx
    .select({ id: discrepancies.id, resolutionStatus: discrepancies.resolutionStatus })
    .from(discrepancies)
    .where(and(eq(discrepancies.id, discrepancyId), eq(discrepancies.restaurantId, rid)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });

  const since = new Date(Date.now() - REOPEN_WINDOW_MS);
  const [last] = await tx
    .select({ id: auditLog.id, action: auditLog.action, userId: auditLog.userId, before: auditLog.before, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, rid), eq(auditLog.entityType, 'discrepancy'), eq(auditLog.entityId, discrepancyId)))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  const decided = last ? DECIDED_BY_ACTION[last.action] : undefined;
  if (!last || !decided || decided !== row.resolutionStatus) {
    throw new TRPCError({ code: 'CONFLICT', message: 'nothing to undo' });
  }
  if (last.userId !== ctx.session.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'only the person who decided can undo it' });
  }
  if (last.at < since) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'the undo window has passed' });
  }
  const prior = (last.before ?? {}) as { status?: string; requiresRole?: UserRole | null; note?: string | null };
  const priorStatus = prior.status === 'escalated' ? 'escalated' : 'open';
  const [updated] = await tx
    .update(discrepancies)
    .set({
      resolutionStatus: priorStatus,
      // Escalation re-routed the row to the owner; undo restores the routing.
      ...(prior.requiresRole !== undefined ? { requiresRole: prior.requiresRole } : {}),
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: prior.note ?? null,
    })
    .where(
      and(
        eq(discrepancies.id, discrepancyId),
        eq(discrepancies.restaurantId, rid),
        eq(discrepancies.resolutionStatus, decided as (typeof OPEN_STATUSES)[number] | 'accepted' | 'rejected'),
      ),
    )
    .returning();
  if (!updated) throw new TRPCError({ code: 'CONFLICT', message: 'nothing to undo' });

  await tx.insert(auditLog).values({
    restaurantId: rid,
    userId: ctx.session.userId,
    action: 'discrepancy.reopened',
    entityType: 'discrepancy',
    entityId: discrepancyId,
    before: { status: decided, undoes: last.id },
    after: { status: priorStatus, requiresRole: updated.requiresRole, role: ctx.session.role },
  });
  // The decision's claim goes with it (written off while no money moved).
  await materializeClaims(tx, { restaurantId: rid, discrepancyIds: [discrepancyId], actorId: ctx.session.userId });
  // Withdraw the decision's own feed row (written moments ago by this user).
  await tx.execute(sql`
    DELETE FROM activity_events
    WHERE restaurant_id = ${rid}
      AND entity_type = 'discrepancy' AND entity_id = ${discrepancyId}
      AND actor_id = ${ctx.session.userId}
      AND event_type IN ('discrepancy_approved', 'discrepancy_rejected')
      AND created_at >= ${since.toISOString()}::timestamptz
  `);
  return updated;
}

/**
 * The row, in this tenant, still waiting for a decision AND still in exactly
 * the state the role check saw: same status, same routing. A concurrent
 * escalation (or any decision) between the check and the write makes the
 * UPDATE match nothing, so the caller gets CONFLICT instead of overriding it.
 */
function checkedRow(
  restaurantId: string,
  discrepancyId: string,
  before: { status: string; requiresRole: UserRole | null },
) {
  return and(
    eq(discrepancies.id, discrepancyId),
    eq(discrepancies.restaurantId, restaurantId),
    inArray(discrepancies.resolutionStatus, [...OPEN_STATUSES]),
    eq(discrepancies.resolutionStatus, before.status as (typeof OPEN_STATUSES)[number]),
    before.requiresRole === null
      ? isNull(discrepancies.requiresRole)
      : eq(discrepancies.requiresRole, before.requiresRole),
  );
}

type Ctx = { db: Database; adminDb?: Database; session: { restaurantId: string; userId: string; role: UserRole } };

/**
 * The CONFLICT for a decision that lost the race (or came from a stale card):
 * the row exists but is no longer open. Names the decider from the latest
 * audit row; the user's name only when the tenant connection can read it.
 */
async function decidedConflict(ctx: Ctx, discrepancyId: string): Promise<TRPCError> {
  const [d] = await ctx.db
    .select({ status: discrepancies.resolutionStatus, resolvedAt: discrepancies.resolvedAt })
    .from(discrepancies)
    .where(and(eq(discrepancies.id, discrepancyId), eq(discrepancies.restaurantId, ctx.session.restaurantId)))
    .limit(1);
  if (!d) return new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });
  const [a] = await ctx.db
    .select({ userId: auditLog.userId, after: auditLog.after, at: auditLog.at, name: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(
      and(
        eq(auditLog.restaurantId, ctx.session.restaurantId),
        eq(auditLog.entityType, 'discrepancy'),
        eq(auditLog.entityId, discrepancyId),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  const after = (a?.after ?? {}) as { role?: string; fromRole?: string };
  const payload: DecidedConflict = {
    status: d.status,
    role: after.role ?? after.fromRole ?? null,
    name: a?.name ?? null,
    at: (a?.at ?? d.resolvedAt)?.toISOString() ?? null,
    self: a?.userId === ctx.session.userId,
  };
  return new TRPCError({ code: 'CONFLICT', message: DECIDED_CONFLICT_PREFIX + JSON.stringify(payload) });
}

/**
 * The claimable ₪ of each given queue row, by the lib/claims rule (the same
 * per-invoice cap as the credit letters and the pay run). ONE query loads every
 * discrepancy line of the rows' invoices with the charts LEAK_FILTER flag —
 * the same inputs computeInvoiceLeak reads per invoice (cap = LEAST(Σ leak
 * lines, invoice total); a paid invoice or one still waiting for its PO link
 * claims nothing) — and claimableLines applies the cap. Rows without an invoice
 * have nothing to claim yet.
 */
async function claimsByRow(
  db: import('@restomatch/db').Database,
  restaurantId: string,
  rows: ReadonlyArray<{ id: string; invoiceId: string | null }>,
): Promise<Map<string, { amount: number; basis: VatBasis }>> {
  const out = new Map<string, { amount: number; basis: VatBasis }>();
  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter((v): v is string => !!v))];
  if (invoiceIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT mr.invoice_id, i.status, COALESCE(i.total_incl_vat, 0) AS total,
      d.id, d.type, d.severity, d.resolution_status, d.delta_amount, (${LEAK_FILTER}) AS counts
    FROM discrepancies d
    JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
    JOIN invoices i ON i.id = mr.invoice_id AND i.restaurant_id = ${restaurantId}
    WHERE d.restaurant_id = ${restaurantId}
      AND mr.invoice_id IN (${sql.join(invoiceIds.map((id) => sql`${id}::uuid`), sql`, `)})
    ORDER BY ABS(d.delta_amount) DESC, d.id
  `);
  type Row = Record<string, unknown>;
  const list: Row[] = Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []);
  const byInvoice = new Map<string, LeakBreakdownInvoice>();
  const rawLeak = new Map<string, number>();
  for (const r of list) {
    const key = String(r.invoice_id);
    let inv = byInvoice.get(key);
    if (!inv) {
      inv = {
        invoiceId: key,
        invoiceNumber: null,
        invoiceDate: null,
        status: String(r.status),
        supplierName: null,
        supplierNameEn: null,
        totalInclVat: Number(r.total),
        leakIls: 0,
        pendingLink: false,
        lines: [],
      };
      byInvoice.set(key, inv);
    }
    const delta = Number(r.delta_amount ?? 0);
    const counts = Boolean(r.counts);
    if (counts) rawLeak.set(key, (rawLeak.get(key) ?? 0) + Math.abs(Math.round(delta * 100)));
    if (r.type === 'UNORDERED_ARRIVAL' && (r.resolution_status === 'open' || r.resolution_status === 'escalated')) {
      inv.pendingLink = true;
    }
    inv.lines.push({
      discrepancyId: String(r.id),
      type: String(r.type),
      severity: String(r.severity),
      resolutionStatus: String(r.resolution_status),
      deltaAmount: delta,
      expected: null,
      actual: null,
      countsAsLeak: counts,
      productName: null,
      productNameEn: null,
      lineDescription: null,
      lineDescriptionEn: null,
      poLineId: null,
      invoiceLineId: null,
      productId: null,
    });
  }
  const wanted = new Set(rows.map((r) => r.id));
  for (const inv of byInvoice.values()) {
    inv.leakIls = Math.min((rawLeak.get(inv.invoiceId) ?? 0) / 100, inv.totalInclVat);
    for (const c of claimableLines(inv)) {
      if (wanted.has(c.line.discrepancyId)) out.set(c.line.discrepancyId, { amount: c.amount, basis: c.basis });
    }
  }
  return out;
}

/** Σ per VAT basis, never mixed: before VAT, duplicates (incl. VAT), VAT amounts. */
function basisTotals(
  rows: ReadonlyArray<{ id: string }>,
  amounts: Map<string, { amount: number; basis: VatBasis }>,
): { claimableIls: number; duplicateIls: number; vatIls: number } {
  const of = (basis: VatBasis) =>
    sumClaims(rows.map((r) => amounts.get(r.id)).filter((a): a is { amount: number; basis: VatBasis } => a?.basis === basis));
  return { claimableIls: of('excl'), duplicateIls: of('incl'), vatIls: of('vat') };
}

/**
 * Role check for a decision. No required role → owner/manager (not a
 * bookkeeper, whose authority is limited to bookkeeper-routed items). A row a
 * colleague escalated away from my role is "already decided" (CONFLICT).
 */
async function assertCanAct(
  ctx: Ctx,
  row: { id: string; status: string; requiresRole: UserRole | null },
): Promise<void> {
  if (!row.requiresRole) {
    if (canActOn(ctx.session.role, null)) return;
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on an unrouted discrepancy`,
    });
  }
  if (!canActOn(ctx.session.role, row.requiresRole)) {
    if (row.status === 'escalated') throw await decidedConflict(ctx, row.id);
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on discrepancy requiring ${row.requiresRole}`,
    });
  }
}

// keep import stable
void authedProcedure;
