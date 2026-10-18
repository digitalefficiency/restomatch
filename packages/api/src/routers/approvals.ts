import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
  auditLog,
  desc,
  discrepancies,
  discrepancyType,
  eq,
  inArray,
  invoices,
  lt,
  matchRuns,
  products,
  severity as severityEnum,
  suppliers,
  type UserRole,
} from '@restomatch/db';
import { authedProcedure, financeProcedure, memberProcedure, router } from '../trpc';
import { logActivity } from '../activity';
import { notZeroShortTwin } from '@restomatch/charts';

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

export const approvalsRouter = router({
  /**
   * Items waiting for my role to decide.
   * - Owner sees all items where requires_role IN (owner, manager, bookkeeper).
   * - Manager sees items where requires_role = manager.
   * - Bookkeeper sees items requiring bookkeeper.
   */
  myQueue: memberProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).default(50),
          // NON-BREAKING: ISO cursor → only rows strictly older than it. Return
          // shape stays an array (desc by createdAt).
          cursor: z.string().datetime().optional(),
          // View filters (dashboard view controls). All optional, all enumerated.
          types: z.array(z.enum(discrepancyType.enumValues)).max(12).optional(),
          severities: z.array(z.enum(severityEnum.enumValues)).max(3).optional(),
          supplierIds: z.array(z.string().uuid()).max(50).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const cursorDate = input?.cursor ? new Date(input.cursor) : null;
      const roles = expandVisibleRoles(ctx.session.role);
      const rows = await ctx.db
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
          message: discrepancies.resolutionNote, // reuse field for now
          createdAt: discrepancies.createdAt,
          matchRunId: discrepancies.matchRunId,
          // Invoice behind this discrepancy → deep-link to the OCR correction screen.
          invoiceId: matchRuns.invoiceId,
        })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .leftJoin(
          products,
          and(eq(products.id, discrepancies.productId), eq(products.restaurantId, ctx.session.restaurantId)),
        )
        .leftJoin(
          invoices,
          and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, ctx.session.restaurantId)),
        )
        .leftJoin(
          suppliers,
          and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, ctx.session.restaurantId)),
        )
        .where(
          and(
            eq(discrepancies.restaurantId, ctx.session.restaurantId),
            inArray(discrepancies.resolutionStatus, ['open', 'escalated']),
            notZeroShortTwin(),
            inArray(discrepancies.requiresRole, roles),
            cursorDate ? lt(discrepancies.createdAt, cursorDate) : undefined,
            input?.types?.length ? inArray(discrepancies.type, input.types) : undefined,
            input?.severities?.length ? inArray(discrepancies.severity, input.severities) : undefined,
            input?.supplierIds?.length ? inArray(invoices.supplierId, input.supplierIds) : undefined,
          ),
        )
        .orderBy(desc(discrepancies.createdAt))
        .limit(limit);
      return rows;
    }),

  approve: deciderProcedure
    .input(z.object({ discrepancyId: z.string().uuid(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureCanAct(ctx, input.discrepancyId);
      const [updated] = await ctx.db
        .update(discrepancies)
        .set({
          resolutionStatus: 'accepted',
          resolvedBy: ctx.session.userId,
          resolvedAt: new Date(),
          resolutionNote: input.note ?? null,
        })
        .where(
          and(
            eq(discrepancies.id, input.discrepancyId),
            eq(discrepancies.restaurantId, ctx.session.restaurantId),
          ),
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });

      await ctx.db.insert(auditLog).values({
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'discrepancy.approved',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        after: { note: input.note ?? null, role: ctx.session.role },
      });
      await logActivity(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        eventType: 'discrepancy_approved',
        title: 'חריגה אושרה',
        detail: updated.deltaAmount
          ? `חיסכון ₪${Number(updated.deltaAmount).toLocaleString('he-IL')}`
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureCanAct(ctx, input.discrepancyId);
      const [updated] = await ctx.db
        .update(discrepancies)
        .set({
          resolutionStatus: 'rejected',
          resolvedBy: ctx.session.userId,
          resolvedAt: new Date(),
          resolutionNote: input.reason,
        })
        .where(
          and(
            eq(discrepancies.id, input.discrepancyId),
            eq(discrepancies.restaurantId, ctx.session.restaurantId),
          ),
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });

      await ctx.db.insert(auditLog).values({
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'discrepancy.rejected',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        after: { reason: input.reason, role: ctx.session.role },
      });
      await logActivity(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        eventType: 'discrepancy_rejected',
        title: 'חריגה נדחתה',
        detail: input.reason,
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        actorId: ctx.session.userId,
        metadata: {
          discrepancyType: updated.type,
          amountIls: updated.deltaAmount ? Number(updated.deltaAmount) : null,
          reason: input.reason,
          role: ctx.session.role,
        },
      });
      return updated;
    }),

  escalate: deciderProcedure
    .input(z.object({ discrepancyId: z.string().uuid(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureCanAct(ctx, input.discrepancyId);
      const [updated] = await ctx.db
        .update(discrepancies)
        .set({
          resolutionStatus: 'escalated',
          requiresRole: 'owner',
          resolutionNote: input.note ?? null,
        })
        .where(
          and(
            eq(discrepancies.id, input.discrepancyId),
            eq(discrepancies.restaurantId, ctx.session.restaurantId),
          ),
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });

      await ctx.db.insert(auditLog).values({
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'discrepancy.escalated',
        entityType: 'discrepancy',
        entityId: input.discrepancyId,
        after: { note: input.note ?? null, fromRole: ctx.session.role },
      });
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

function expandVisibleRoles(role: UserRole): UserRole[] {
  // Owner sees everyone's queue; manager sees manager+; bookkeeper sees bookkeeper.
  switch (role) {
    case 'owner':
      return ['owner', 'manager', 'bookkeeper'];
    case 'manager':
      return ['manager'];
    case 'bookkeeper':
      return ['bookkeeper'];
    default:
      return [role];
  }
}

async function ensureCanAct(
  ctx: { db: Parameters<typeof eq>[0] extends never ? never : import('@restomatch/db').Database; session: { restaurantId: string; role: UserRole } },
  discrepancyId: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ requiredRole: discrepancies.requiresRole })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.id, discrepancyId),
        eq(discrepancies.restaurantId, ctx.session.restaurantId),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });
  // No required role → owner/manager may resolve (not a bookkeeper, whose
  // authority is limited to bookkeeper-routed items).
  if (!row.requiredRole) {
    if (ctx.session.role === 'owner' || ctx.session.role === 'manager') return;
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on an unrouted discrepancy`,
    });
  }
  const allowed = expandVisibleRoles(ctx.session.role);
  if (!allowed.includes(row.requiredRole)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `role ${ctx.session.role} cannot act on discrepancy requiring ${row.requiredRole}`,
    });
  }
}

// keep import stable
void authedProcedure;
