import { z } from 'zod';
import { and, eq, matchRuns, restaurants } from '@restomatch/db';
import { runMatch, type MatchStatus } from '@restomatch/matching';
import { managerProcedure, router } from '../trpc';
import { assertInvoiceOwned } from '../tenant';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { persistMatchRun } from '../match/persist';
import { buildRules, resolveApprovalThresholds } from '../approvals/engine';

export interface RunForInvoiceResult {
  matchRunId: string | null;
  status: MatchStatus;
  totalDiscrepancyAmount: number;
  discrepancyCount: number;
  poMatched: boolean;
}

/**
 * On-demand 3-way match for an invoice — the interactive counterpart to the
 * background match-invoice worker. Lets a manager (re-)run the PO↔invoice
 * cross-check from the dashboard after fixing product matches, and works
 * without Redis (runs inline in the member tx). Re-running replaces any prior
 * match run for the invoice (cascade-deletes its discrepancies), so it is safe
 * to invoke repeatedly.
 */
export const matchRouter = router({
  runForInvoice: managerProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<RunForInvoiceResult> => {
      const { restaurantId } = ctx.session;
      await assertInvoiceOwned(ctx.db, input.invoiceId, restaurantId);

      const built = await buildMatchInputForInvoice(ctx.db, restaurantId, input.invoiceId);
      if (!built) {
        return {
          matchRunId: null,
          status: 'clean',
          totalDiscrepancyAmount: 0,
          discrepancyCount: 0,
          poMatched: false,
        };
      }

      // Re-match: drop any prior run for this invoice (discrepancies cascade).
      await ctx.db
        .delete(matchRuns)
        .where(and(eq(matchRuns.invoiceId, input.invoiceId), eq(matchRuns.restaurantId, restaurantId)));

      const [restaurant] = await ctx.db
        .select({ settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      const rules = buildRules(resolveApprovalThresholds(restaurant?.settings?.approvalThresholds));

      const result = runMatch(built.input);
      const persisted = await persistMatchRun(
        ctx.db,
        { restaurantId, invoiceId: input.invoiceId, poId: built.poId, grId: built.grId },
        built.input,
        result,
        rules,
      );

      return {
        matchRunId: persisted.matchRunId,
        status: result.status,
        totalDiscrepancyAmount: result.totalDiscrepancyAmount,
        discrepancyCount: persisted.discrepancyCount,
        poMatched: built.poId != null,
      };
    }),
});
