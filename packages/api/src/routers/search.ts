import { z } from 'zod';
import { and, eq, invoices, products, sql, suppliers } from '@restomatch/db';
import { memberProcedure, router } from '../trpc';

/**
 * Global fuzzy search (Phase 5) across suppliers, products and invoices for the
 * caller's restaurant. Backed by the pg_trgm GIN indexes from migration 0008
 * (suppliers.name, products.canonical_name, invoices.invoice_number). Ranking
 * uses similarity() so transposed/typo'd queries still surface; an ILIKE
 * substring fallback catches short exact-substring hits trigram ranks low.
 * Always restaurant-scoped via ctx.session.restaurantId. English names
 * (`name_en`, migration 0028) are matched by substring and returned so the UI
 * can show them in the English locale.
 */
const PER_KIND = 5;

export const searchRouter = router({
  global: memberProcedure
    .input(z.object({ q: z.string().trim().min(2).max(100) }))
    .query(async ({ ctx, input }) => {
      const q = input.q;
      const like = `%${q}%`;
      const rid = ctx.session.restaurantId;

      const [supplierRows, productRows, invoiceRows] = await Promise.all([
        ctx.db
          .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn })
          .from(suppliers)
          .where(
            and(
              eq(suppliers.restaurantId, rid),
              sql`(${suppliers.name} % ${q} OR ${suppliers.name} ILIKE ${like} OR ${suppliers.nameEn} ILIKE ${like})`,
            ),
          )
          .orderBy(
            sql`greatest(similarity(${suppliers.name}, ${q}), similarity(coalesce(${suppliers.nameEn}, ''), ${q})) DESC`,
          )
          .limit(PER_KIND),
        ctx.db
          .select({ id: products.id, canonicalName: products.canonicalName, nameEn: products.nameEn })
          .from(products)
          .where(
            and(
              eq(products.restaurantId, rid),
              sql`(${products.canonicalName} % ${q} OR ${products.canonicalName} ILIKE ${like} OR ${products.nameEn} ILIKE ${like})`,
            ),
          )
          .orderBy(
            sql`greatest(similarity(${products.canonicalName}, ${q}), similarity(coalesce(${products.nameEn}, ''), ${q})) DESC`,
          )
          .limit(PER_KIND),
        ctx.db
          .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
          .from(invoices)
          .where(
            and(
              eq(invoices.restaurantId, rid),
              sql`${invoices.invoiceNumber} IS NOT NULL`,
              sql`(${invoices.invoiceNumber} % ${q} OR ${invoices.invoiceNumber} ILIKE ${like})`,
            ),
          )
          .orderBy(sql`similarity(${invoices.invoiceNumber}, ${q}) DESC`)
          .limit(PER_KIND),
      ]);

      return {
        suppliers: supplierRows,
        products: productRows,
        invoices: invoiceRows,
      };
    }),
});
