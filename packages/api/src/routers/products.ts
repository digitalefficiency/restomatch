import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  invoiceLines,
  isNull,
  or,
  poLines,
  products,
  inventoryCountLines,
  recipeItems,
  sql,
  suppliers,
} from '@restomatch/db';
import { managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';

/**
 * Canonical-product management. Products are otherwise created only by import /
 * OCR / mapping; this router is the in-app path to rename (canonicalName drives
 * the matcher + reports), set the English display name (name_en), recategorize, fix the unit/barcode, set the exclusive
 * owning supplier (products.supplier_id), or delete a junk product.
 */
/** Max rows one bulk English-name save may touch (one screen of the grid). */
const MAX_BULK = 200;

export const productsRouter = router({
  /**
   * Products for the bulk English-names grid: Hebrew name, current name_en,
   * category and exclusive supplier. `missingOnly` narrows to products without
   * an English name; `search` matches Hebrew or English. Restaurant-scoped.
   */
  list: memberProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(100).optional(),
          missingOnly: z.boolean().optional(),
          limit: z.number().int().min(1).max(MAX_BULK).default(100),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const conds = [eq(products.restaurantId, rid)];
      if (input?.missingOnly) {
        conds.push(or(isNull(products.nameEn), sql`btrim(${products.nameEn}) = ''`)!);
      }
      if (input?.search) {
        const like = `%${input.search}%`;
        conds.push(sql`(${products.canonicalName} ILIKE ${like} OR ${products.nameEn} ILIKE ${like})`);
      }
      const where = and(...conds);
      const [rows, [total]] = await Promise.all([
        ctx.db
          .select({
            id: products.id,
            canonicalName: products.canonicalName,
            nameEn: products.nameEn,
            category: products.category,
            defaultUnit: products.defaultUnit,
            supplierName: suppliers.name,
            supplierNameEn: suppliers.nameEn,
          })
          .from(products)
          .leftJoin(
            suppliers,
            and(eq(suppliers.id, products.supplierId), eq(suppliers.restaurantId, rid)),
          )
          .where(where)
          .orderBy(asc(products.canonicalName))
          .limit(input?.limit ?? 100)
          .offset(input?.offset ?? 0),
        ctx.db.select({ n: count() }).from(products).where(where),
      ]);
      return { rows, total: total?.n ?? 0 };
    }),

  /**
   * Bulk-set English display names (the "English names" grid). All-or-nothing:
   * every productId must belong to the caller's restaurant, otherwise NOT_FOUND
   * and nothing is written (the procedure runs in the member transaction).
   * Empty/blank → clears the name. Returns how many rows changed.
   */
  setNamesEn: managerProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              productId: z.string().uuid(),
              nameEn: z.string().trim().max(200).nullable(),
            }),
          )
          .min(1)
          .max(MAX_BULK)
          .refine((xs) => new Set(xs.map((x) => x.productId)).size === xs.length, {
            message: 'duplicate productId',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const ids = input.items.map((i) => i.productId);
      const owned = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.restaurantId, rid), inArray(products.id, ids)));
      if (owned.length !== ids.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
      }
      const now = new Date();
      for (const item of input.items) {
        await ctx.db
          .update(products)
          .set({ nameEn: item.nameEn?.trim() || null, updatedAt: now })
          .where(and(eq(products.id, item.productId), eq(products.restaurantId, rid)));
      }
      return { updated: input.items.length };
    }),

  /** Edit a product. Setting supplierId assigns the exclusive owning supplier
   *  (must be a same-tenant supplier — the FK alone does not enforce tenancy). */
  update: managerProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        patch: z
          .object({
            canonicalName: z.string().trim().min(1).max(200).optional(),
            /** English display name ("Receiver in English", 0028). Empty/null clears it. */
            nameEn: z.string().trim().max(200).nullable().optional(),
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
      if (p.nameEn !== undefined) set.nameEn = p.nameEn?.trim() || null;
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
      // recipe_items → products is ON DELETE RESTRICT (0057): a product a recipe
      // uses gets the same friendly CONFLICT instead of a raw FK error.
      const [recipeRef] = await ctx.db
        .select({ id: recipeItems.id })
        .from(recipeItems)
        .where(and(eq(recipeItems.productId, input.productId), eq(recipeItems.restaurantId, restaurantId)))
        .limit(1);
      if (recipeRef) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'לא ניתן למחוק — המוצר משמש במתכון. הסירו אותו מהמתכון קודם.',
        });
      }
      // inventory_count_lines → products is RESTRICT too (0070): a counted product
      // is part of a stock value — the same friendly CONFLICT.
      const [countRef] = await ctx.db
        .select({ id: inventoryCountLines.id })
        .from(inventoryCountLines)
        .where(and(eq(inventoryCountLines.productId, input.productId), eq(inventoryCountLines.restaurantId, restaurantId)))
        .limit(1);
      if (countRef) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'לא ניתן למחוק — המוצר מופיע בספירת מלאי. השביתו אותו בקטלוג במקום למחוק.',
        });
      }
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
