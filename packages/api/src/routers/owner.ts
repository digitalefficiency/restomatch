import {
  computeLeakBreakdown,
  computeLeakReport,
  computeLeakHero,
  computeLeaks,
  computeOwnerKpis,
  computeSupplierScorecards,
  type LeakBreakdownInvoice,
  type LeakHero,
  type LeakReport,
  type LeakRow,
  type OwnerKpis,
  type SupplierScorecard,
} from '@restomatch/charts';
import { z } from 'zod';
import { managerProcedure, memberProcedure, ownerProcedure, requireFeature, router } from '../trpc';

/** Deep analytics (leak detective, supplier scorecards) are a paid feature. */
const analyticsProcedure = ownerProcedure.use(requireFeature('advanced_analytics'));
const memberAnalyticsProcedure = memberProcedure.use(requireFeature('advanced_analytics'));

export const ownerRouter = router({
  // KPIs stay on the core plan — the dashboard headline numbers are table stakes.
  kpis: memberProcedure.query(async ({ ctx }): Promise<OwnerKpis> => {
    return computeOwnerKpis(ctx.db, ctx.session.restaurantId);
  }),

  // The leak hero ("₪X leaked this month, Y% of spend, Z caught before payment")
  // and its drill-down are core-plan, like the KPIs: they ARE the product.
  leakHero: memberProcedure
    .input(z.object({ monthOffset: z.number().int().min(-24).max(0).optional() }).optional())
    .query(async ({ ctx, input }): Promise<LeakHero> => {
      return computeLeakHero(ctx.db, ctx.session.restaurantId, { monthOffset: input?.monthOffset });
    }),

  leakBreakdown: memberProcedure
    .input(
      z
        .object({
          monthOffset: z.number().int().min(-24).max(0).optional(),
          limit: z.number().int().positive().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<LeakBreakdownInvoice[]> => {
      return computeLeakBreakdown(ctx.db, ctx.session.restaurantId, {
        monthOffset: input?.monthOffset,
        limit: input?.limit,
      });
    }),

  // Print-ready monthly leak report — owner/manager only (it lists supplier
  // spend and what the team waived). Core plan, like the hero it expands.
  leakReport: managerProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
    .query(async ({ ctx, input }): Promise<LeakReport> => {
      return computeLeakReport(ctx.db, ctx.session.restaurantId, input.month);
    }),

  leaks: analyticsProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).optional(),
          minDeltaPct: z.number().nonnegative().max(2).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<LeakRow[]> => {
      return computeLeaks(ctx.db, ctx.session.restaurantId, input ?? {});
    }),

  // NON-BREAKING pagination: still returns an array. Supplier scorecards have no
  // createdAt cursor, so we expose an optional `limit` and slice the (already
  // restaurant-scoped, name-ordered) result instead.
  suppliers: memberAnalyticsProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).optional() }).optional())
    .query(async ({ ctx, input }): Promise<SupplierScorecard[]> => {
      const cards = await computeSupplierScorecards(ctx.db, ctx.session.restaurantId);
      return input?.limit ? cards.slice(0, input.limit) : cards;
    }),
});
