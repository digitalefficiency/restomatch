import {
  computeLeaks,
  computeOwnerKpis,
  computeSupplierScorecards,
  type LeakRow,
  type OwnerKpis,
  type SupplierScorecard,
} from '@restomatch/charts';
import { z } from 'zod';
import { memberProcedure, ownerProcedure, requireFeature, router } from '../trpc';

/** Deep analytics (leak detective, supplier scorecards) are a paid feature. */
const analyticsProcedure = ownerProcedure.use(requireFeature('advanced_analytics'));
const memberAnalyticsProcedure = memberProcedure.use(requireFeature('advanced_analytics'));

export const ownerRouter = router({
  // KPIs stay on the core plan — the dashboard headline numbers are table stakes.
  kpis: memberProcedure.query(async ({ ctx }): Promise<OwnerKpis> => {
    return computeOwnerKpis(ctx.db, ctx.session.restaurantId);
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

  suppliers: memberAnalyticsProcedure.query(async ({ ctx }): Promise<SupplierScorecard[]> => {
    return computeSupplierScorecards(ctx.db, ctx.session.restaurantId);
  }),
});
