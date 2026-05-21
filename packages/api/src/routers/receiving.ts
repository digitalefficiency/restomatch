import { z } from 'zod';
import { authedProcedure, router } from '../trpc';

export const receivingRouter = router({
  todayExpectations: authedProcedure.query(async () => {
    return [] as Array<{
      poId: string;
      supplierName: string;
      expectedAt: string;
      lineCount: number;
    }>;
  }),

  startReceipt: authedProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return { receiptId: input.poId, status: 'pending' as const };
    }),

  scanInvoice: authedProcedure
    .input(z.object({ receiptId: z.string().uuid(), imageUrl: z.string().url() }))
    .mutation(async () => {
      return { jobId: crypto.randomUUID() };
    }),
});
