import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { releaseClaimsForRematch } from '../recovery/service';
import { and, desc, eq, invoices, matchRuns, restaurants } from '@restomatch/db';
import { runMatch, type MatchStatus } from '@restomatch/matching';
import { can, router } from '../trpc';
import { invoiceStateOf } from '../invoices/state';
import { assertInvoiceOwned } from '../tenant';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { readConsolidatedRaw } from '../match/consolidated';
import { loadPriorDecisions, persistMatchRun } from '../match/persist';
import { buildRules, resolveApprovalThresholds } from '../approvals/engine';

export interface RunForInvoiceResult {
  matchRunId: string | null;
  status: MatchStatus;
  totalDiscrepancyAmount: number;
  discrepancyCount: number;
  poMatched: boolean;
  /**
   * The invoice's gap (G-05 `leakIls`, the register's and hero's figure) before
   * and after this run, integer agorot — the cockpit's "₪ לפני → אחרי" (W2-02).
   */
  before: number;
  after: number;
}

const agorotOf = (ils: number | undefined) => Math.round((ils ?? 0) * 100);

/**
 * On-demand 3-way match for an invoice — the interactive counterpart to the
 * background match-invoice worker. Lets a manager (re-)run the PO↔invoice
 * cross-check from the dashboard after fixing product matches, and works
 * without Redis (runs inline in the member tx). Re-running replaces any prior
 * match run for the invoice (cascade-deletes its discrepancies), so it is safe
 * to invoke repeatedly; human decisions (approve / reject / escalate) carry over
 * to the findings that still exist.
 */
export const matchRouter = router({
  // W2-02: the bookkeeper corrects OCR and re-matches — capability, not a role list.
  runForInvoice: can('invoice.correct')
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<RunForInvoiceResult> => {
      const { restaurantId } = ctx.session;
      await assertInvoiceOwned(ctx.db, input.invoiceId, restaurantId);

      // A consolidated invoice (חשבונית ריכוז) has no PO of its own: a PO match would
      // only mark the whole invoice UNORDERED_ARRIVAL. It is cross-matched against
      // its delivery notes on the invoice page (read-only) instead.
      const [kind] = await ctx.db
        .select({ ocrPayload: invoices.ocrPayload })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)))
        .limit(1);
      if (readConsolidatedRaw(kind?.ocrPayload)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'A consolidated invoice is cross-matched against its delivery notes, not re-matched to a PO.',
        });
      }

      // A re-match checks against the PO the invoice was already matched to, even
      // once that PO is received/closed (discovery only looks at open POs).
      const [priorRun] = await ctx.db
        .select({ poId: matchRuns.poId })
        .from(matchRuns)
        .where(and(eq(matchRuns.invoiceId, input.invoiceId), eq(matchRuns.restaurantId, restaurantId)))
        .orderBy(desc(matchRuns.runAt))
        .limit(1);
      const before = agorotOf((await invoiceStateOf(ctx.db, restaurantId, input.invoiceId))?.leakIls);
      const built = await buildMatchInputForInvoice(ctx.db, restaurantId, input.invoiceId, {
        pinnedPoId: priorRun?.poId ?? null,
      });
      if (!built) {
        return {
          matchRunId: null,
          status: 'clean',
          totalDiscrepancyAmount: 0,
          discrepancyCount: 0,
          poMatched: false,
          before,
          after: before,
        };
      }

      // Re-match: drop any prior run for this invoice (discrepancies cascade).
      // Claims on those discrepancies are money history: release bare ones,
      // refuse while any is in progress (₪-back tracker, wave 1) — before any work.
      await releaseClaimsForRematch(ctx.db, restaurantId, input.invoiceId);
      // Keep the people's decisions, re-applied below to findings that still
      // exist (a rejected "not a duplicate" must not come back open).
      const priorDecisions = await loadPriorDecisions(ctx.db, restaurantId, input.invoiceId);
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
        priorDecisions,
      );

      return {
        matchRunId: persisted.matchRunId,
        status: result.status,
        totalDiscrepancyAmount: result.totalDiscrepancyAmount,
        discrepancyCount: persisted.discrepancyCount,
        poMatched: built.poId != null,
        before,
        after: agorotOf((await invoiceStateOf(ctx.db, restaurantId, input.invoiceId))?.leakIls),
      };
    }),
});
