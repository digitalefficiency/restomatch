import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { releaseClaimsForRematch } from '../recovery/service';
import { and, desc, eq, invoices, matchRuns, restaurants, sql } from '@restomatch/db';
import { runMatch, type MatchStatus } from '@restomatch/matching';
import { managerProcedure, router } from '../trpc';
import { assertInvoiceOwned } from '../tenant';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { readConsolidatedRaw } from '../match/consolidated';
import { appError } from '../errors';
import { invoiceQuestionCount, orderQuestionCount } from '../catalog/linkQuestions';
import { loadPriorDecisions, persistMatchRun } from '../match/persist';
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
 * to invoke repeatedly; human decisions (approve / reject / escalate) carry over
 * to the findings that still exist.
 */
export const matchRouter = router({
  runForInvoice: managerProcedure
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

      // G-08 hold: an unlinked line is an open "זה אותו מוצר?" question — the engine
      // pairs only by product / SKU and would report a false MISSING + UNORDERED pair.
      const open = await invoiceQuestionCount(ctx.db, restaurantId, input.invoiceId);
      if (open > 0) {
        throw appError('PRECONDITION_FAILED', 'invoice.unlinkedLines', 'Invoice lines are not linked to a product yet.', {
          count: open,
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
      const built = await buildMatchInputForInvoice(ctx.db, restaurantId, input.invoiceId, {
        pinnedPoId: priorRun?.poId ?? null,
      });
      // G-08 hold (round 3 HIGH): a FIRST match against an order that still has
      // name-only questions would report a false MISSING + UNORDERED pair — the
      // same rule as the match-invoice job's M-4 hold (shared helper).
      if (built && built.poId && !priorRun) {
        const orderOpen = await orderQuestionCount(ctx.db, restaurantId, built.poId);
        if (orderOpen > 0) {
          throw appError('PRECONDITION_FAILED', 'order.unlinkedLines', 'Order lines are not linked to a product yet.', {
            count: orderOpen,
          });
        }
      }
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
      // G-08 hold: a matched invoice no longer waits for an order — drop a stale marker.
      await ctx.db.execute(sql`
        update invoices set ocr_payload = ocr_payload - 'heldPoId'
         where id = ${input.invoiceId}::uuid and restaurant_id = ${restaurantId} and ocr_payload ? 'heldPoId'
      `);

      return {
        matchRunId: persisted.matchRunId,
        status: result.status,
        totalDiscrepancyAmount: result.totalDiscrepancyAmount,
        discrepancyCount: persisted.discrepancyCount,
        poMatched: built.poId != null,
      };
    }),
});
