import { RECOVERY_STATUSES } from '@restomatch/db';
import { z } from 'zod';
import { assertFeatureOn, isFeatureOn } from '../lib/featureGate';
import {
  claimHistory,
  computeRecoverySummary,
  creditLineSuggestions,
  listClaims,
  lockClaims,
  MAX_CLAIMS,
  recordCreditNote,
  returnedInMonth,
  summarize,
  syncClaims,
  transitionClaim,
} from '../recovery/service';
import { financeProcedure, memberProcedure } from '../trpc';
import { router } from '../trpc';

/**
 * "₪ back" tracker (flag `recovery`). Money is integer agorot end to end; the
 * web formats with formatIls() at display. Every procedure runs under RLS
 * (member transaction) and filters by ctx.session.restaurantId; client ids are
 * verified to belong to the restaurant before any write (service.ts).
 */
const flagged = <T extends typeof financeProcedure | typeof memberProcedure>(p: T) =>
  p.use(async ({ ctx, next }) => {
    await assertFeatureOn(ctx.db, ctx.session.restaurantId, 'recovery');
    return next();
  }) as T;

const recoveryProcedure = flagged(financeProcedure);
const status = z.enum(RECOVERY_STATUSES);
const monthOffset = z.number().int().min(-24).max(0).optional();

export const recoveryRouter = router({
  /** Which of this area's flags are on for the caller's restaurant (nav / hero / routes). Never gated. */
  flags: memberProcedure.query(async ({ ctx }) => {
    const [recovery, monthlyReport, monthlyDigestPreview, leakProof] = await Promise.all([
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'recovery'),
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyReport'),
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyDigestPreview'),
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'leakProof'),
    ]);
    return { recovery, monthlyReport, monthlyDigestPreview, leakProof };
  }),

  /** Totals, ageing, per-supplier recovery rate + this month's returned ₪. Materialises new claims first. */
  summary: recoveryProcedure.query(async ({ ctx }) => {
    await syncClaims(ctx.db, ctx.session.restaurantId, ctx.session.userId);
    const now = new Date();
    const [claims, returned] = await Promise.all([
      listClaims(ctx.db, ctx.session.restaurantId, { now, limit: null }),
      returnedInMonth(ctx.db, ctx.session.restaurantId, { now }),
    ]);
    return { summary: summarize(claims), returnedThisMonth: returned };
  }),

  /** One page of claims; `limit` (default 200, at most MAX_CLAIMS) lets a screen that sums them ask for all. */
  list: recoveryProcedure
    .input(
      z
        .object({
          status: status.optional(),
          supplierId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(MAX_CLAIMS).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      await syncClaims(ctx.db, ctx.session.restaurantId, ctx.session.userId);
      return listClaims(ctx.db, ctx.session.restaurantId, {
        status: input?.status,
        supplierId: input?.supplierId,
        limit: input?.limit,
      });
    }),

  history: recoveryProcedure
    .input(z.object({ claimId: z.string().uuid() }))
    .query(({ ctx, input }) => claimHistory(ctx.db, ctx.session.restaurantId, input.claimId)),

  /** Move one or more claims (letter sent, acknowledged, disputed, written off, recovered, re-open). */
  transition: recoveryProcedure
    .input(
      z.object({
        claimIds: z.array(z.string().uuid()).min(1).max(200),
        to: status.exclude(['credited']),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const out = [];
      const ids = await lockClaims(ctx.db, ctx.session.restaurantId, input.claimIds);
      for (const claimId of ids) {
        out.push(
          await transitionClaim(ctx.db, ctx.session.restaurantId, {
            claimId,
            to: input.to,
            note: input.note ?? null,
            actorId: ctx.session.userId,
          }),
        );
      }
      return out;
    }),

  /** Credit note — manual (supplier, number, amount, date) or matched to a later invoice's credit line. */
  recordCreditNote: recoveryProcedure
    .input(
      z
        .object({
          claimIds: z.array(z.string().uuid()).min(1).max(200),
          supplierId: z.string().uuid().optional(),
          number: z.string().trim().max(64).optional(),
          amountAgorot: z.number().int().positive().max(100_000_000_00).optional(),
          issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          invoiceLineId: z.string().uuid().optional(),
          note: z.string().trim().max(500).optional(),
          /** One per form submission (client crypto.randomUUID()): a double submit records once. */
          idempotencyKey: z.string().uuid().optional(),
        })
        .refine((v) => v.invoiceLineId || (v.supplierId && v.amountAgorot && v.issuedOn), {
          message: 'manual credit notes need supplier, amount and date',
        }),
    )
    .mutation(({ ctx, input }) =>
      recordCreditNote(ctx.db, ctx.session.restaurantId, { ...input, actorId: ctx.session.userId }),
    ),

  creditLineSuggestions: recoveryProcedure
    .input(z.object({ supplierId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) => creditLineSuggestions(ctx.db, ctx.session.restaurantId, input ?? {})),

  /** Hero tile: "₪ actually returned this month" — aggregate only, any member (like the hero). */
  returnedThisMonth: flagged(memberProcedure)
    .input(z.object({ monthOffset }).optional())
    .query(({ ctx, input }) => returnedInMonth(ctx.db, ctx.session.restaurantId, { monthOffset: input?.monthOffset })),
});

export { computeRecoverySummary };
