import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { releaseClaimsForRematch } from '../recovery/service';
import { and, desc, eq, goodsReceipts, invoices, matchRuns, purchaseOrders, restaurants, type Database } from '@restomatch/db';
import { recordAudit } from '../audit';
import { scanOwnerReceipt } from '../receiving/matchTriggers';
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
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        /**
         * The way out of a wrong pin (round 4): match against THIS order — one of
         * this restaurant's, from the invoice's own supplier. Strict, audited.
         */
        poId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<RunForInvoiceResult> => {
      const { restaurantId } = ctx.session;
      await assertInvoiceOwned(ctx.db, input.invoiceId, restaurantId);

      // A consolidated invoice (חשבונית ריכוז) has no PO of its own: a PO match would
      // only mark the whole invoice UNORDERED_ARRIVAL. It is cross-matched against
      // its delivery notes on the invoice page (read-only) instead.
      // Row-locked, and never while the invoice is being read again (a retake):
      // the same rule as the match job's persist step.
      const [kind] = await ctx.db
        .select({ ocrPayload: invoices.ocrPayload, source: invoices.source, status: invoices.status, supplierId: invoices.supplierId })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)))
        .limit(1)
        .for('no key update'); // not FOR UPDATE: a tracker sync's claim FK check (KEY SHARE) must pass, or it deadlocks on the recovery lock
      if (kind?.status === 'ocr_pending') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'החשבונית עדיין נקראת — נסו שוב בעוד דקה' });
      }
      if (readConsolidatedRaw(kind?.ocrPayload)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'A consolidated invoice is cross-matched against its delivery notes, not re-matched to a PO.',
        });
      }

      // S2 receipt hold — not while the invoice's receipt is still being counted:
      // every line would read "received 0" (the leak hero jumping by the whole
      // invoice). The receipt's submit matches it.
      // The scan's receipt: the stamp, else a photo held for ONE receipt.
      const scanGrId = scanOwnerReceipt(kind?.ocrPayload, kind?.source);
      let scanPoId: string | null = null;
      if (scanGrId) {
        const [gr] = await ctx.db
          .select({ status: goodsReceipts.status, poId: goodsReceipts.poId })
          .from(goodsReceipts)
          .where(and(eq(goodsReceipts.id, scanGrId), eq(goodsReceipts.restaurantId, restaurantId)))
          .limit(1);
        if (gr?.status === 'pending') {
          throw appError('PRECONDITION_FAILED', 'invoice.receiptOpen', 'הספירה עדיין פתוחה — ההתאמה תרוץ כשהקבלה תיסגר');
        }
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
      // A manager's explicit order (the way out of a wrong stamp: one driver,
      // two orders) — this tenant's, the invoice's supplier, else NOT_FOUND.
      let chosenPoId: string | null = null;
      if (input.poId) {
        const [po] = await ctx.db
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.id, input.poId),
              eq(purchaseOrders.restaurantId, restaurantId),
              eq(purchaseOrders.supplierId, kind?.supplierId ?? '00000000-0000-0000-0000-000000000000'),
            ),
          )
          .limit(1);
        if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'order not found' });
        chosenPoId = po.id;
      }
      // H: the order the receiver counted for this scan wins (as the worker's
      // job poId does) — never a same-day second order found by discovery.
      const strictPoId = chosenPoId ?? scanPoId;
      const built = await buildMatchInputForInvoice(ctx.db, restaurantId, input.invoiceId, {
        pinnedPoId: strictPoId ?? priorRun?.poId ?? null,
        strictPin: strictPoId != null,
      });
      if (chosenPoId && built?.poId !== chosenPoId) {
        // Outside the match window / cancelled: say so rather than match elsewhere.
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'אי אפשר להתאים את החשבונית להזמנה הזו (מחוץ לחלון ההתאמה או מבוטלת)' });
      }
      if (chosenPoId) {
        await recordAudit(ctx.db as Database, {
          restaurantId,
          userId: ctx.session.userId,
          action: 'match.po_pinned',
          entityType: 'invoice',
          entityId: input.invoiceId,
          before: { poId: priorRun?.poId ?? scanPoId ?? null },
          after: { poId: chosenPoId },
        });
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
