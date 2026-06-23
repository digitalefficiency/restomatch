import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, eq, invoiceLines, poLines, products } from '@restomatch/db';
import { managerProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';

/**
 * Canonical-product management. Products are otherwise created only by import /
 * OCR / mapping; this router is the in-app path to rename (canonicalName drives
 * the matcher + reports), recategorize, fix the unit/barcode, set the exclusive
 * owning supplier (products.supplier_id), or delete a junk product.
 */
export const productsRouter = router({
  /** Edit a product. Setting supplierId assigns the exclusive owning supplier
   *  (must be a same-tenant supplier — the FK alone does not enforce tenancy). */
  update: managerProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        patch: z
          .object({
            canonicalName: z.string().trim().min(1).max(200).optional(),
            category: z.string().trim().max(100).nullable().optional(),
            defaultUnit: z.string().trim().max(32).nullable().optional(),
            barcodeEan: z.string().trim().max(32).nullable().optional(),
            supplierId: z.string().uuid().nullable().optional(),
          })
          .strict()
          .refine((v) => Object.values(v).some((x) => x !== undefined), {
            message: 'אין שינויים לעדכן',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const p = input.patch;
      // Exclusivity owner must be a supplier in THIS restaurant.
      if (p.supplierId) {
        await assertSupplierOwned(ctx.db, p.supplierId, restaurantId);
      }
      const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
      if (p.canonicalName !== undefined) set.canonicalName = p.canonicalName;
      if (p.category !== undefined) set.category = p.category?.trim() || null;
      if (p.defaultUnit !== undefined) set.defaultUnit = p.defaultUnit?.trim() || null;
      if (p.barcodeEan !== undefined) set.barcodeEan = p.barcodeEan?.trim() || null;
      if (p.supplierId !== undefined) set.supplierId = p.supplierId;

      const [row] = await ctx.db
        .update(products)
        .set(set)
        .where(and(eq(products.id, input.productId), eq(products.restaurantId, restaurantId)))
        .returning({ id: products.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
      return { ok: true };
    }),

  /**
   * Delete a product. The FKs referencing products are ON DELETE set null
   * (po_lines/invoice_lines/gr_lines/discrepancies) or cascade (aliases/price
   * history), so a raw delete would SILENTLY strip product linkage from real
   * financial records. Guard it: block deletion while the product is still
   * referenced by any invoice or PO line (history must stay linked); the owner
   * should deactivate the catalog item instead.
   */
  delete: managerProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [owned] = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.restaurantId, restaurantId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });

      const [invRef] = await ctx.db
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .where(eq(invoiceLines.productId, input.productId))
        .limit(1);
      const [poRef] = await ctx.db
        .select({ id: poLines.id })
        .from(poLines)
        .where(eq(poLines.productId, input.productId))
        .limit(1);
      if (invRef || poRef) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'לא ניתן למחוק — המוצר מקושר לחשבוניות/הזמנות קיימות. השביתו אותו בקטלוג במקום למחוק.',
        });
      }

      await ctx.db
        .delete(products)
        .where(and(eq(products.id, input.productId), eq(products.restaurantId, restaurantId)));
      return { ok: true };
    }),
});
