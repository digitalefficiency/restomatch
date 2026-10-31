import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
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
import { logActivity } from '../activity';
import { canActOn, expandVisibleRoles } from '../lib/roles';
import { claimableLines, sumClaims, type VatBasis } from '../lib/claims';
import { formatIlsAgorot } from '../reports/money';
import { DECISION_COPY } from '../notifications/templates';

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
const NEVER_CLAIMABLE = new Set(['PRICE_LOWER', 'UNORDERED_ARRIVAL', 'MISSING_ON_INVOICE']);
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
};
type QueueFilterInput = {
  types?: (typeof discrepancyType.enumValues)[number][];
  severities?: (typeof severityEnum.enumValues)[number][];
  supplierIds?: string[];
};

function filterWhere(input: QueueFilterInput | undefined) {
  return [
    input?.types?.length ? inArray(discrepancies.type, input.types) : undefined,
    input?.severities?.length ? inArray(discrepancies.severity, input.severities) : undefined,
    input?.supplierIds?.length ? inArray(invoices.supplierId, input.supplierIds) : undefined,
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
          ...QueueFilters,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const cursorDate = input?.cursor ? new Date(input.cursor) : null;
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
            inArray(discrepancies.requiresRole, roles),
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
      return rows.map((r) => ({
        ...(r.poId ? r : { ...r, qtyOrdered: null, orderedUnit: null, poRef: null, poDate: null }),
        claimable: isClaimableRow(r),
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
    const rid = ctx.session.restaurantId;
    const roles = expandVisibleRoles(ctx.session.role);
    const rows = await ctx.db
      .select({
        id: discrepancies.id,
        type: discrepancies.type,
        severity: discrepancies.severity,
        requiredRole: discrepancies.requiresRole,
        deltaAmount: discrepancies.deltaAmount,
        createdAt: discrepancies.createdAt,
        invoiceId: matchRuns.invoiceId,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
      .where(
        and(
          eq(discrepancies.restaurantId, rid),
          inArray(discrepancies.resolutionStatus, [...OPEN_STATUSES]),
          notZeroShortTwin(),
          ...filterWhere(input),
        ),
      );
    const mine = rows.filter((r) => r.requiredRole && roles.includes(r.requiredRole));
    const others = rows.filter((r) => !r.requiredRole || !roles.includes(r.requiredRole));

    // The ₪ and the split come from the same rows, so "להחלטה" count and ₪ always agree.
    const decide = mine.filter(isClaimableRow);
    const showOthers = DECIDER_ROLES.includes(ctx.session.role);
    const othersClaimable = showOthers ? others.filter(isClaimableRow) : [];
    // ONE query for both sets (lib/claims cap per invoice), then split by row id.
    const amounts = await claimsByRow(ctx.db, rid, [...decide, ...othersClaimable]);
    const { claimableIls, duplicateIls, vatIls } = basisTotals(decide, amounts);
    const oldest = mine.reduce<Date | null>((o, r) => (!o || r.createdAt < o ? r.createdAt : o), null);

    // Others lane: the same claims rule and the same before-VAT basis as the tile.
    const byRole = new Map<string, { count: number; agorot: number }>();
    if (showOthers) {
      for (const r of others) {
        const key = r.requiredRole ?? 'manager';
        const e = byRole.get(key) ?? { count: 0, agorot: 0 };
        e.count += 1;
        const a = amounts.get(r.id);
        if (a && a.basis === 'excl') e.agorot += Math.round(a.amount * 100);
        byRole.set(key, e);
      }
    }
    const othersTotal = [...byRole.values()].reduce((s, e) => s + e.agorot, 0);
    return {
      count: mine.length,
      blockers: mine.filter((r) => r.severity === 'block').length,
      oldestAt: oldest,
      claimableIls,
      duplicateIls,
      vatIls,
      toDecide: { count: decide.length, amountIls: claimableIls },
      toReview: { count: mine.length - decide.length },
      others: {
        count: showOthers ? others.length : 0,
        amountIls: othersTotal / 100,
        byRole: [...byRole.entries()].map(([role, e]) => ({ role, count: e.count, amountIls: e.agorot / 100 })),
      },
    };
  }),

  approve: deciderProcedure
    .input(z.object({ discrepancyId: z.string().uuid(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ensureCanAct(ctx, input.discrepancyId);
      const [updated] = await ctx.db
        .update(discrepancies)
        .set({
          resolutionStatus: 'accepted',
          resolvedBy: ctx.session.userId,
          resolvedAt: new Date(),
          resolutionNote: input.note ?? null,
        })
        .where(checkedRow(ctx.session.restaurantId, input.discrepancyId, before))
        .returning();
      if (!updated) throw await decidedConflict(ctx, input.discrepancyId);

      await ctx.db.insert(auditLog).values({
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'discrepancy.approved',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        before,
        after: { status: 'accepted', note: input.note ?? null, role: ctx.session.role },
      });
      await logActivity(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        eventType: 'discrepancy_approved',
        // An accepted duplicate is a hold on the copy, not a claim.
        title: updated.type === 'DUPLICATE_INVOICE' ? DECISION_COPY.he.duplicateHeld : DECISION_COPY.he.approved,
        detail: updated.deltaAmount
          ? formatIlsAgorot(Math.abs(Math.round(Number(updated.deltaAmount) * 100)), { maximumFractionDigits: 2 })
          : null,
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        actorId: ctx.session.userId,
        metadata: {
          discrepancyType: updated.type,
          savingsIls: updated.deltaAmount ? Number(updated.deltaAmount) : null,
          role: ctx.session.role,
        },
      });
      return updated;
    }),

  reject: deciderProcedure
    .input(
      z.object({
        discrepancyId: z.string().uuid(),
        reason: z.string().min(1).max(500),
        reasonCode: z.enum(WAIVE_REASON_CODES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ensureCanAct(ctx, input.discrepancyId);
      const [updated] = await ctx.db
        .update(discrepancies)
        .set({
          resolutionStatus: 'rejected',
          resolvedBy: ctx.session.userId,
          resolvedAt: new Date(),
          resolutionNote: input.reason,
        })
        .where(checkedRow(ctx.session.restaurantId, input.discrepancyId, before))
        .returning();
      if (!updated) throw await decidedConflict(ctx, input.discrepancyId);

      await ctx.db.insert(auditLog).values({
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'discrepancy.rejected',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        before,
        after: {
          status: 'rejected',
          reason: input.reason,
          reasonCode: input.reasonCode ?? null,
          role: ctx.session.role,
        },
      });
      await logActivity(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        eventType: 'discrepancy_rejected',
        // "סמנו כנבדק" is a check with nothing to claim, not a payment decision.
        title: input.reasonCode === 'reviewed' ? DECISION_COPY.he.reviewed : DECISION_COPY.he.rejected,
        detail: input.reason,
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        actorId: ctx.session.userId,
        metadata: {
          discrepancyType: updated.type,
          amountIls: updated.deltaAmount ? Number(updated.deltaAmount) : null,
          reason: input.reason,
          reasonCode: input.reasonCode ?? null,
          role: ctx.session.role,
        },
      });
      return updated;
    }),

  escalate: deciderProcedure
    .input(z.object({ discrepancyId: z.string().uuid(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ensureCanAct(ctx, input.discrepancyId);
      const [updated] = await ctx.db
        .update(discrepancies)
        .set({
          resolutionStatus: 'escalated',
          requiresRole: 'owner',
          resolutionNote: input.note ?? null,
        })
        .where(checkedRow(ctx.session.restaurantId, input.discrepancyId, before))
        .returning();
      if (!updated) throw await decidedConflict(ctx, input.discrepancyId);

      await ctx.db.insert(auditLog).values({
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'discrepancy.escalated',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        before,
        after: { status: 'escalated', note: input.note ?? null, fromRole: ctx.session.role },
      });
      return updated;
    }),

  /**
   * Undo (approvals-04): put a decision back in the queue. Only the person who
   * made it, only inside the undo window, and only while the row still holds
   * exactly that decision (nobody acted since). The prior status, routing and
   * note come from the decision's own audit `before`; a compensating
   * `discrepancy.reopened` audit row records the undo (audit is append-only), and
   * the decision's activity row is withdrawn so the feed never shows a claim
   * that no longer exists.
   */
  reopen: deciderProcedure
    .input(z.object({ discrepancyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const [row] = await ctx.db
        .select({
          id: discrepancies.id,
          resolutionStatus: discrepancies.resolutionStatus,
          resolvedBy: discrepancies.resolvedBy,
        })
        .from(discrepancies)
        .where(and(eq(discrepancies.id, input.discrepancyId), eq(discrepancies.restaurantId, rid)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });

      const since = new Date(Date.now() - REOPEN_WINDOW_MS);
      const [last] = await ctx.db
        .select({ id: auditLog.id, action: auditLog.action, userId: auditLog.userId, before: auditLog.before, at: auditLog.at })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, rid),
            eq(auditLog.entityType, 'discrepancy'),
            eq(auditLog.entityId, input.discrepancyId),
          ),
        )
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
      const [updated] = await ctx.db
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
            eq(discrepancies.id, input.discrepancyId),
            eq(discrepancies.restaurantId, rid),
            eq(discrepancies.resolutionStatus, decided),
          ),
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'CONFLICT', message: 'nothing to undo' });

      await ctx.db.insert(auditLog).values({
        restaurantId: rid,
        userId: ctx.session.userId,
        action: 'discrepancy.reopened',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        before: { status: decided, undoes: last.id },
        after: { status: priorStatus, requiresRole: updated.requiresRole, role: ctx.session.role },
      });
      // Withdraw the decision's own feed row (written moments ago by this user).
      await ctx.db.execute(sql`
        DELETE FROM activity_events
        WHERE restaurant_id = ${rid}
          AND entity_type = 'discrepancy' AND entity_id = ${input.discrepancyId}
          AND actor_id = ${ctx.session.userId}
          AND event_type IN ('discrepancy_approved', 'discrepancy_rejected')
          AND created_at >= ${since.toISOString()}::timestamptz
      `);
      return updated;
    }),

  /** Audit trail for a single discrepancy. */
  // A discrepancy's decision trail (amounts, notes, who waived what) — the same
  // roles that can decide (owner/manager/bookkeeper), not receiver/chef.
  history: financeProcedure
    .input(z.object({ discrepancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, ctx.session.restaurantId),
            eq(auditLog.entityType, 'discrepancy'),
            eq(auditLog.entityId, input.discrepancyId),
          ),
        )
        .orderBy(desc(auditLog.at));
    }),
});

const DECIDED_BY_ACTION: Record<string, string> = {
  'discrepancy.approved': 'accepted',
  'discrepancy.rejected': 'rejected',
  'discrepancy.escalated': 'escalated',
};

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

type Ctx = { db: import('@restomatch/db').Database; session: { restaurantId: string; userId: string; role: UserRole } };

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
 * Role check for a decision; returns the row's prior state (the audit `before`
 * that `reopen` restores).
 */
async function ensureCanAct(
  ctx: Ctx,
  discrepancyId: string,
): Promise<{ status: string; requiresRole: UserRole | null; note: string | null }> {
  const [row] = await ctx.db
    .select({
      requiredRole: discrepancies.requiresRole,
      status: discrepancies.resolutionStatus,
      note: discrepancies.resolutionNote,
    })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.id, discrepancyId),
        eq(discrepancies.restaurantId, ctx.session.restaurantId),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });
  const before = { status: row.status, requiresRole: row.requiredRole, note: row.note };
  // No required role → owner/manager may resolve (not a bookkeeper, whose
  // authority is limited to bookkeeper-routed items).
  if (!row.requiredRole) {
    if (canActOn(ctx.session.role, null)) return before;
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on an unrouted discrepancy`,
    });
  }
  if (!canActOn(ctx.session.role, row.requiredRole)) {
    // A colleague escalated this card away from my role: it is already decided
    // for me, not a permission problem.
    if (row.status === 'escalated') throw await decidedConflict(ctx, discrepancyId);
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on discrepancy requiring ${row.requiredRole}`,
    });
  }
  return before;
}

// keep import stable
void authedProcedure;
