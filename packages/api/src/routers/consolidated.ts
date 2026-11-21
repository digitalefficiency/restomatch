import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, restaurants } from '@restomatch/db';
import { financeProcedure, invoiceReaderProcedure, router } from '../trpc';
import { assertInvoiceOwned } from '../tenant';
import { featureEnabled } from '../lib/features';
import { seesNoMoney } from '../lib/staffMoney';
import {
  CONSOLIDATED_ITEM_REVIEWED,
  consolidatedProposal,
  deliveryNoteCoverage,
  type ConsolidatedProposal,
  type DeliveryNoteCoverage,
} from '../match/consolidated';
import { recordAudit } from '../audit';

/**
 * Consolidated invoice ↔ delivery notes cross-match (flag `consolidatedMatch`).
 * READ-ONLY: proposals only — nothing is written, the invoice stays pending and
 * no hero / report / letter / chain figure changes. The proposal (₪ deltas) is for
 * finance roles; coverage for invoice readers (not the chef, like the invoice page).
 */
async function enabled(db: Parameters<typeof consolidatedProposal>[0], restaurantId: string): Promise<boolean> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return featureEnabled(r?.settings, 'consolidatedMatch');
}

/** A delivery note as the coverage read returns it: no ₪ for staff roles (H-11). */
type DeliveryNoteCoverageView = Omit<DeliveryNoteCoverage, 'receivedValueIls'> & { receivedValueIls: number | null };

export const consolidatedRouter = router({
  /**
   * The cross-match proposal for one consolidated invoice; null when the flag is off
   * or it is not a ריכוז. Finance roles only (owner, manager, bookkeeper): it shows
   * ₪ differences, which a receiver does not see.
   */
  proposal: financeProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<ConsolidatedProposal | null> => {
      const { restaurantId } = ctx.session;
      await assertInvoiceOwned(ctx.db, input.invoiceId, restaurantId);
      if (!(await enabled(ctx.db, restaurantId))) return null;
      return consolidatedProposal(ctx.db, restaurantId, input.invoiceId);
    }),

  /**
   * G-04 Q5 (owner decision 11.11, Q5 (א)): mark one review item "נבדק". Finance roles
   * (owner, manager, bookkeeper). No schema: one append-only audit row
   * (`consolidated.item_reviewed`, entity = the invoice, after = { key, value }).
   * The item must stand on the live proposal with exactly that value — a stale
   * screen (the fact changed) gets CONFLICT, and a changed fact re-appears unreviewed.
   * Idempotent: a second mark of the same fact writes nothing. Never touches ₪.
   */
  markReviewed: financeProcedure
    .input(
      z
        .object({
          invoiceId: z.string().uuid(),
          key: z.string().min(1).max(200),
          value: z.string().min(1).max(200),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { restaurantId } = ctx.session;
      await assertInvoiceOwned(ctx.db, input.invoiceId, restaurantId);
      if (!(await enabled(ctx.db, restaurantId))) throw new TRPCError({ code: 'NOT_FOUND', message: 'consolidated proposal not found' });
      const proposal = await consolidatedProposal(ctx.db, restaurantId, input.invoiceId);
      const item = proposal?.reviewItems?.find((r) => r.key === input.key);
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'review item not found' });
      if (item.value !== input.value) throw new TRPCError({ code: 'CONFLICT', message: 'REVIEW_ITEM_CHANGED' });
      if (item.reviewed) return { ok: true as const, alreadyReviewed: true };
      await recordAudit(ctx.db, {
        restaurantId,
        userId: ctx.session.userId,
        action: CONSOLIDATED_ITEM_REVIEWED,
        entityType: 'invoice',
        entityId: input.invoiceId,
        after: { key: item.key, value: item.value, flag: item.flag, noteNumber: item.noteNumber, amountIls: item.amountIls },
      });
      return { ok: true as const, alreadyReviewed: false };
    }),

  /** Each delivery note of a supplier in [from, to) and what covers it — for the supplier ledger (כרטסת). */
  coverage: invoiceReaderProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }): Promise<DeliveryNoteCoverageView[]> => {
      const { restaurantId } = ctx.session;
      if (!(await enabled(ctx.db, restaurantId))) return [];
      const notes = await deliveryNoteCoverage(ctx.db, restaurantId, input.supplierId, new Date(input.from), new Date(input.to));
      // H-11 strip (slice c): the receiver (an invoice reader) gets the notes and
      // their state, never the received ₪.
      return seesNoMoney(ctx.session.role) ? notes.map((n) => ({ ...n, receivedValueIls: null })) : notes;
    }),
});
