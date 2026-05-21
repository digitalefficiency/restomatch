import {
  computeLeaks,
  computeOwnerKpis,
  computeSupplierScorecards,
  type LeakRow,
  type OwnerKpis,
  type SupplierScorecard,
} from '@restomatch/charts';
import { z } from 'zod';
import { memberProcedure, ownerProcedure, router } from '../trpc';

export const ownerRouter = router({
  kpis: memberProcedure.query(async ({ ctx }): Promise<OwnerKpis> => {
    return computeOwnerKpis(ctx.db, ctx.session.restaurantId);
  }),

  leaks: ownerProcedure
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

  suppliers: memberProcedure.query(async ({ ctx }): Promise<SupplierScorecard[]> => {
    return computeSupplierScorecards(ctx.db, ctx.session.restaurantId);
  }),
});
