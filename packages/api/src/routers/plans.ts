import { asc, eq, plans } from '@restomatch/db';
import { publicProcedure, router } from '../trpc';

/**
 * Public pricing catalog for the marketing landing page. Reads the canonical
 * `plans` table (active rows only), ordered by sortOrder. No tenant scope — this
 * is pre-customer marketing data; it exposes only public catalog columns.
 */
export const plansRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        key: plans.key,
        nameHe: plans.nameHe,
        priceAgorotMonthly: plans.priceAgorotMonthly,
        limits: plans.limits,
        features: plans.features,
      })
      .from(plans)
      .where(eq(plans.active, true))
      .orderBy(asc(plans.sortOrder));
  }),
});
