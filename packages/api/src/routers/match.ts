import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { lockRecovery, releaseClaimsForRematch } from '../recovery/service';
import { and, desc, eq, goodsReceipts, invoiceLines, invoices, matchRuns, restaurants } from '@restomatch/db';
import { holdForReceipt, receiptStillOpen, scanOwnerReceipt } from '../receiving/matchTriggers';
import { appError } from '../errors';
import { runMatch, type MatchStatus } from '@restomatch/matching';
import { managerProcedure, router } from '../trpc';
import { assertInvoiceOwned } from '../tenant';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { readConsolidatedRaw } from '../match/consolidated';
import { loadPriorDecisions, persistMatchRun } from '../match/persist';
import { buildRules, resolveApprovalThresholds } from '../approvals/engine';

export interface RunForInvoiceResult {
  matchRunId: string | null;
  /** 'held': not matched now — waiting for its receipt's count (see `held`). */
  status: MatchStatus | 'held';
  totalDiscrepancyAmount: number;
  discrepancyCount: number;
  poMatched: boolean;
  /** Why it was held: its receipt is still being counted, or (a possible duplicate) it waits for review. */
  held?: 'receipt_open' | 'awaiting_review';
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
      // Row-locked, and never while the invoice is being read again (a retake):
      // the same rule as the match job's persist step.
      const [kind] = await ctx.db
        .select({ ocrPayload: invoices.ocrPayload, source: invoices.source, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)))
        .limit(1)
        .for('no key update'); // not FOR UPDATE: a tracker sync's claim FK check (KEY SHARE) must pass, or it deadlocks on the recovery lock
      if (kind?.status === 'ocr_pending') {
        throw appError('PRECONDITION_FAILED', 'invoice.beingRead', 'החשבונית עדיין נקראת — נסו שוב בעוד דקה');
      }
      if (readConsolidatedRaw(kind?.ocrPayload)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'A consolidated invoice is cross-matched against its delivery notes, not re-matched to a PO.',
        });
      }

      // Nothing to match: say so before any order / receipt check.
      const [anyLine] = await ctx.db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, input.invoiceId)).limit(1);
      if (!anyLine) {
        return { matchRunId: null, status: 'clean', totalDiscrepancyAmount: 0, discrepancyCount: 0, poMatched: false };
      }

      // S2 receipt hold — the scan's receipt (the stamp, else a photo held for
      // ONE receipt) is the order the receiver counted: the match is pinned to
      // it; whether it is still being counted is decided below, on the receipt
      // the match actually lands on.
      const scanGrId = scanOwnerReceipt(kind?.ocrPayload, kind?.source);
      let scanPoId: string | null = null;
      if (scanGrId) {
        const [gr] = await ctx.db
          .select({ poId: goodsReceipts.poId })
          .from(goodsReceipts)
          .where(and(eq(goodsReceipts.id, scanGrId), eq(goodsReceipts.restaurantId, restaurantId)))
          .limit(1);
        scanPoId = gr?.poId ?? null;
      }
      // end S2 receipt hold

      // A re-match checks against the PO the invoice was already matched to, even
      // once that PO is received/closed (discovery only looks at open POs).
      const [priorRun] = await ctx.db
        .select({ poId: matchRuns.poId })
        .from(matchRuns)
        .where(and(eq(matchRuns.invoiceId, input.invoiceId), eq(matchRuns.restaurantId, restaurantId)))
        .orderBy(desc(matchRuns.runAt))
        .limit(1);
      // H: the order the receiver counted for this scan wins (as the worker's
      // job poId does) — never a same-day second order found by discovery.
      // (A manager's own order pin is wave 2 — PR #216 body.)
      const built = await buildMatchInputForInvoice(ctx.db, restaurantId, input.invoiceId, {
        pinnedPoId: scanPoId ?? priorRun?.poId ?? null,
        strictPin: scanPoId != null,
      });
      // F3 / round 6: the receipt the match lands on (the scan's, or one found
      // by discovery for an unstamped emailed invoice) must not still be
      // counting — every line would read "received 0" (a whole-invoice leak).
      // Then the invoice is HELD for it (not refused): the receipt's submit
      // claims it and matches it once the count is in.
      // Lock order, everywhere: the invoice row (above) → recovery → gr-close
      // (a sibling invoice's edit takes recovery before gr-close too).
      const landedGrId = built?.grId ?? scanGrId;
      if (landedGrId) {
        await lockRecovery(ctx.db, restaurantId);
        if (await receiptStillOpen(ctx.db, restaurantId, landedGrId)) {
          // A run already stands on this receipt's earlier count (a receipt
          // reopened for a follow-up delivery): a hold would leave that stale
          // run's ₪ showing — refuse instead (as a hand edit does).
          const [counted] = await ctx.db
            .select({ id: matchRuns.id })
            .from(matchRuns)
            .where(and(eq(matchRuns.invoiceId, input.invoiceId), eq(matchRuns.restaurantId, restaurantId), eq(matchRuns.grId, landedGrId)))
            .limit(1);
          if (counted) {
            throw appError('PRECONDITION_FAILED', 'invoice.receiptOpen', 'הקבלה פתוחה לספירה — אפשר להריץ את ההתאמה אחרי שהספירה תיסגר');
          }
          // Its earlier run (none, or one with no receipt) is replaced by the
          // receipt's job: bare claims on it go now, and a claim in progress
          // refuses the Re-run visibly (invoice.claimInProgress) — the job would
          // otherwise fail on the claim's FK and leave the stale ₪ (round 7).
          await releaseClaimsForRematch(ctx.db, restaurantId, input.invoiceId);
          const held = await holdForReceipt(ctx.db, restaurantId, input.invoiceId, landedGrId);
          return { matchRunId: null, status: 'held', totalDiscrepancyAmount: 0, discrepancyCount: 0, poMatched: built?.poId != null, held };
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

      return {
        matchRunId: persisted.matchRunId,
        status: result.status,
        totalDiscrepancyAmount: result.totalDiscrepancyAmount,
        discrepancyCount: persisted.discrepancyCount,
        poMatched: built.poId != null,
      };
    }),
});
