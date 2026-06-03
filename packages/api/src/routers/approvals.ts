import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
  auditLog,
  desc,
  discrepancies,
  eq,
  inArray,
  matchRuns,
  type UserRole,
} from '@restomatch/db';
import { authedProcedure, managerProcedure, memberProcedure, router } from '../trpc';
import { logActivity } from '../activity';

const ResolutionEnum = z.enum(['accepted', 'rejected', 'escalated']);

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
    .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
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
          message: discrepancies.resolutionNote, // reuse field for now
          createdAt: discrepancies.createdAt,
          matchRunId: discrepancies.matchRunId,
        })
        .from(discrepancies)
        .where(
          and(
            eq(discrepancies.restaurantId, ctx.session.restaurantId),
            inArray(discrepancies.resolutionStatus, ['open', 'escalated']),
            inArray(discrepancies.requiresRole, roles),
          ),
        )
        .orderBy(desc(discrepancies.createdAt))
        .limit(limit);
      return rows;
    }),

  approve: managerProcedure
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
      });
      return updated;
    }),

  reject: managerProcedure
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
      });
      return updated;
    }),

  escalate: managerProcedure
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
  history: memberProcedure
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
  if (!row.requiredRole) return; // no required role → anyone can resolve
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
