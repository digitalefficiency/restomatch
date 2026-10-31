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
import { computeInvoiceLeak, notZeroShortTwin } from '@restomatch/charts';
import { authedProcedure, financeProcedure, memberProcedure, router } from '../trpc';
import { logActivity } from '../activity';
import { canActOn, expandVisibleRoles } from '../lib/roles';
import { claimableLines, sumClaims } from '../lib/claims';
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
            ...filterWhere(input),
          ),
        );
      const rows = cursorDate
        ? await base.orderBy(desc(discrepancies.createdAt)).limit(limit)
        : await base
            .orderBy(
              SEVERITY_RANK,
              sql`${invoices.dueDate} ASC NULLS LAST`,
              sql`ABS(${discrepancies.deltaAmount}) DESC NULLS LAST`,
              desc(discrepancies.createdAt),
              discrepancies.id,
            )
            .limit(limit)
            .offset(input?.offset ?? 0);
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
   *    restricted to the queue's own lines, 2 dp, before VAT (a duplicate's ₪ is
   *    incl. VAT and is reported apart as `duplicateIls`);
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
    const { claimableIls, duplicateIls } = await claimableOf(ctx.db, rid, decide);
    const oldest = mine.reduce<Date | null>((o, r) => (!o || r.createdAt < o ? r.createdAt : o), null);

    const showOthers = DECIDER_ROLES.includes(ctx.session.role);
    const byRole = new Map<string, { count: number; agorot: number }>();
    if (showOthers) {
      for (const r of others) {
        const key = r.requiredRole ?? 'manager';
        const e = byRole.get(key) ?? { count: 0, agorot: 0 };
        e.count += 1;
        if (isClaimableRow(r)) e.agorot += Math.abs(Math.round(Number(r.deltaAmount ?? 0) * 100));
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
        .where(openRow(ctx.session.restaurantId, input.discrepancyId))
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
        detail: updated.deltaAmount ? `₪${Math.abs(Number(updated.deltaAmount)).toFixed(2)}` : null,
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
        .where(openRow(ctx.session.restaurantId, input.discrepancyId))
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
        title: DECISION_COPY.he.rejected,
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
        .where(openRow(ctx.session.restaurantId, input.discrepancyId))
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

/** The row, in this tenant, still waiting for a decision — the only rows a decision may write. */
function openRow(restaurantId: string, discrepancyId: string) {
  return and(
    eq(discrepancies.id, discrepancyId),
    eq(discrepancies.restaurantId, restaurantId),
    inArray(discrepancies.resolutionStatus, [...OPEN_STATUSES]),
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
 * The claimable ₪ of the given queue rows, by the lib/claims rule (the same
 * per-invoice cap as the credit letters and the pay run), restricted to these
 * rows. Rows without an invoice have nothing to claim yet.
 */
async function claimableOf(
  db: import('@restomatch/db').Database,
  restaurantId: string,
  rows: ReadonlyArray<{ id: string; invoiceId: string | null }>,
): Promise<{ claimableIls: number; duplicateIls: number }> {
  const ids = new Set(rows.map((r) => r.id));
  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter((v): v is string => !!v))];
  const lines: Array<{ amount: number; type: string }> = [];
  for (const invoiceId of invoiceIds) {
    const inv = await computeInvoiceLeak(db, restaurantId, invoiceId);
    if (!inv) continue;
    for (const c of claimableLines(inv)) {
      if (ids.has(c.line.discrepancyId)) lines.push({ amount: c.amount, type: c.line.type });
    }
  }
  const isDup = (l: { type: string }) => l.type === 'DUPLICATE_INVOICE';
  return {
    claimableIls: sumClaims(lines.filter((l) => !isDup(l))),
    duplicateIls: sumClaims(lines.filter(isDup)),
  };
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
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on discrepancy requiring ${row.requiredRole}`,
    });
  }
  return before;
}

// keep import stable
void authedProcedure;
