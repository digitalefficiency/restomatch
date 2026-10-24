import { z } from 'zod';
import { eq, restaurants } from '@restomatch/db';
import { financeProcedure, invoiceReaderProcedure, router } from '../trpc';
import { assertInvoiceOwned } from '../tenant';
import { featureEnabled } from '../lib/features';
import {
  consolidatedProposal,
  deliveryNoteCoverage,
  type ConsolidatedProposal,
  type DeliveryNoteCoverage,
} from '../match/consolidated';

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

  /** Each delivery note of a supplier in [from, to) and what covers it — for the supplier ledger (כרטסת). */
  coverage: invoiceReaderProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }): Promise<DeliveryNoteCoverage[]> => {
      const { restaurantId } = ctx.session;
      if (!(await enabled(ctx.db, restaurantId))) return [];
      return deliveryNoteCoverage(ctx.db, restaurantId, input.supplierId, new Date(input.from), new Date(input.to));
    }),
});
