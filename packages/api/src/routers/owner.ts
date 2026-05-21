import type { OwnerKpis } from '@restomatch/charts';
import { emptyKpis } from '@restomatch/charts';
import { memberProcedure, ownerProcedure, router } from '../trpc';

export const ownerRouter = router({
  kpis: memberProcedure.query(async (): Promise<OwnerKpis> => {
    return emptyKpis();
  }),

  leaks: ownerProcedure.query(async () => {
    return [] as Array<unknown>;
  }),

  suppliers: memberProcedure.query(async () => {
    return [] as Array<unknown>;
  }),
});
