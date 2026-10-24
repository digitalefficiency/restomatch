import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { managerProcedure, memberProcedure, router } from '../trpc';
import { assertPoOwned } from '../tenant';
import { assertFeatureOn } from '../lib/featureGate';
import { createSupplierLink, supplierResponseDiff } from '../supplierConfirm/service';

/**
 * Restaurant side of the supplier confirmation portal (wave-1 `supplierConfirm`).
 * The supplier side is the public /s/[token] page + /api/supplier-confirm route
 * in apps/web (token-scoped, rate-limited); nothing here is public.
 */
export const supplierConfirmRouter = router({
  /** Mint a 72h magic link for a sent order. The raw token is returned ONCE. */
  createLink: managerProcedure
    .input(z.object({ poId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'supplierConfirm');
      await assertPoOwned(ctx.db, input.poId, rid);
      const link = await createSupplierLink(ctx.db, rid, input.poId, { userId: ctx.session.userId });
      if (!link) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'SUPPLIER_CONFIRM_NOT_SENT: ניתן לשלוח לספק רק הזמנה שנשלחה' });
      }
      return { path: `/s/${link.token}`, expiresAt: link.expiresAt };
    }),

  /** The supplier's answer for an order, as differences against the (unchanged) PO. */
  responses: memberProcedure
    .input(z.object({ poId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'supplierConfirm');
      await assertPoOwned(ctx.db, input.poId, rid);
      return supplierResponseDiff(ctx.db, rid, input.poId);
    }),
});
