import type { OwnerKpis } from '@restomatch/charts';
import { emptyKpis } from '@restomatch/charts';
import { authedProcedure, ownerProcedure, router } from '../trpc.js';

export const ownerRouter = router({
  kpis: authedProcedure.query(async (): Promise<OwnerKpis> => {
    return emptyKpis();
  }),

  leaks: ownerProcedure.query(async () => {
    return [] as Array<unknown>;
  }),

  suppliers: authedProcedure.query(async () => {
    return [] as Array<unknown>;
  }),
});
