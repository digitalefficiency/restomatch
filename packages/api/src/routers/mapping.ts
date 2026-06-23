import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  eq,
  inArray,
  invoiceLines,
  invoices,
  isNull,
  poLines,
  products,
  purchaseOrders,
  sql,
  suppliers,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
import { recordConfirmedMatch } from '@restomatch/catalog';
import { managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';

export interface UnmappedSku {
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  sampleDescription: string;
  /** How many po_lines + invoice_lines carry this SKU unmapped. */
  occurrences: number;
}

/**
 * The catalog mapping queue + confirm flow. Imported orders / OCR'd invoices
 * leave lines with a supplier SKU (מק״ט) but no productId when the SKU isn't yet
 * linked. This router surfaces those lines, lets a manager link them to a
 * product (existing or new), learns the alias so FUTURE lines auto-resolve, and
 * backfills the already-imported lines in place. Never auto-links — the human
 * confirms — and is strictly restaurant-scoped.
 */
export const mappingRouter = router({
  /** Distinct unmapped (supplier, SKU) pairs across PO + invoice lines. */
  unmapped: memberProcedure
    .input(z.object({ supplierId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }): Promise<UnmappedSku[]> => {
      const rid = ctx.session.restaurantId;
      const supplierFilter = input?.supplierId;

      const poRows = await ctx.db
        .select({
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          supplierSku: poLines.supplierSku,
          rawDescription: poLines.rawDescription,
        })
        .from(poLines)
        .innerJoin(
          purchaseOrders,
          and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, rid)),
        )
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(
          and(
            isNull(poLines.productId),
            sql`${poLines.supplierSku} is not null`,
            supplierFilter ? eq(purchaseOrders.supplierId, supplierFilter) : undefined,
          ),
        );

      const invRows = await ctx.db
        .select({
          supplierId: invoices.supplierId,
          supplierName: suppliers.name,
          supplierSku: invoiceLines.supplierSku,
          rawDescription: invoiceLines.rawDescription,
        })
        .from(invoiceLines)
        .innerJoin(
          invoices,
          and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, rid)),
        )
        .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
        .where(
          and(
            isNull(invoiceLines.productId),
            sql`${invoiceLines.supplierSku} is not null`,
            supplierFilter ? eq(invoices.supplierId, supplierFilter) : undefined,
          ),
        );

      const byKey = new Map<string, UnmappedSku>();
      for (const r of [...poRows, ...invRows]) {
        if (!r.supplierId || !r.supplierSku) continue;
        const key = `${r.supplierId}::${r.supplierSku}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.occurrences += 1;
          if (!existing.sampleDescription && r.rawDescription) {
            existing.sampleDescription = r.rawDescription;
          }
        } else {
          byKey.set(key, {
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            supplierSku: r.supplierSku,
            sampleDescription: r.rawDescription ?? '',
            occurrences: 1,
          });
        }
      }
      return [...byKey.values()].sort((a, b) => b.occurrences - a.occurrences);
    }),

  /** Product picker: fuzzy/ILIKE search over the restaurant's products. */
  searchProducts: memberProcedure
    .input(z.object({ q: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(25).default(10) }))
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const like = `%${input.q}%`;
      return ctx.db
        .select({ id: products.id, canonicalName: products.canonicalName })
        .from(products)
        .where(
          and(
            eq(products.restaurantId, rid),
            sql`(${products.canonicalName} % ${input.q} OR ${products.canonicalName} ILIKE ${like})`,
          ),
        )
        .orderBy(sql`similarity(${products.canonicalName}, ${input.q}) DESC`)
        .limit(input.limit);
    }),

  /**
   * Link a (supplier, SKU) to a product — existing or freshly created — then
   * learn the alias and backfill every already-imported PO/invoice line that
   * carries this SKU unmapped. Idempotent: re-confirming just re-applies.
   */
  confirm: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          supplierSku: z.string().trim().min(1).max(64),
          rawName: z.string().trim().min(1).max(400),
          productId: z.string().uuid().optional(),
          newProductName: z.string().trim().min(1).max(200).optional(),
        })
        .refine((v) => !!v.productId || !!v.newProductName, {
          message: 'provide a productId or a newProductName',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, rid);

      // Resolve the target product (verify ownership / create new).
      let productId: string;
      let createdProduct = false;
      if (input.productId) {
        const [owned] = await ctx.db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, input.productId), eq(products.restaurantId, rid)))
          .limit(1);
        if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
        productId = owned.id;
      } else {
        const [created] = await ctx.db
          .insert(products)
          // Stamp the exclusivity owner (input.supplierId is already asserted
          // same-tenant above) so OCR/mapping-created products don't accumulate
          // NULL-owner rows that leave exclusivity inert + un-backfillable.
          .values({ restaurantId: rid, canonicalName: input.newProductName!, supplierId: input.supplierId })
          .returning({ id: products.id });
        if (!created) throw new Error('failed to create product');
        productId = created.id;
        createdProduct = true;
      }

      // Learn the alias (name + SKU) so future imports/OCR auto-resolve.
      await recordConfirmedMatch(ctx.db, {
        productId,
        rawName: input.rawName,
        supplierId: input.supplierId,
        supplierSku: input.supplierSku,
        confidence: 1,
      });

      // Backfill already-imported lines, scoped to this restaurant + supplier.
      const poIds = ctx.db
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.restaurantId, rid), eq(purchaseOrders.supplierId, input.supplierId)));
      const updatedPo = await ctx.db
        .update(poLines)
        .set({ productId })
        .where(
          and(
            isNull(poLines.productId),
            eq(poLines.supplierSku, input.supplierSku),
            inArray(poLines.poId, poIds),
          ),
        )
        .returning({ id: poLines.id });

      const invIds = ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.restaurantId, rid), eq(invoices.supplierId, input.supplierId)));
      const updatedInv = await ctx.db
        .update(invoiceLines)
        .set({ productId })
        .where(
          and(
            isNull(invoiceLines.productId),
            eq(invoiceLines.supplierSku, input.supplierSku),
            inArray(invoiceLines.invoiceId, invIds),
          ),
        )
        .returning({ id: invoiceLines.id });

      // Link the priced catalog row too, when one exists for this SKU.
      await ctx.db
        .update(supplierCatalogItems)
        .set({ productId, updatedAt: new Date() })
        .where(
          and(
            eq(supplierCatalogItems.restaurantId, rid),
            eq(supplierCatalogItems.supplierId, input.supplierId),
            eq(supplierCatalogItems.supplierSku, input.supplierSku),
            isNull(supplierCatalogItems.productId),
          ),
        );

      return {
        productId,
        createdProduct,
        poLinesUpdated: updatedPo.length,
        invoiceLinesUpdated: updatedInv.length,
      };
    }),
});
