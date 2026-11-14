import { z } from 'zod';
import {
  and,
  eq,
  invoices,
  products,
  purchaseOrders,
  recipes,
  sql,
  suppliers,
  type UserRole,
} from '@restomatch/db';
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

export type SearchKind = 'suppliers' | 'products' | 'invoices' | 'orders' | 'recipes';

/**
 * What each role may find (W3-04, owner decisions 31.10). Results carry no ₪,
 * but each one opens a page, so a role only finds what it can open:
 * the receiver finds no records (screens only); the chef finds orders and
 * recipes (the only screens where it sees ₪); the bookkeeper finds the
 * money records but not the kitchen ones; owner and manager find all.
 */
export const SEARCH_KINDS: Readonly<Record<UserRole, readonly SearchKind[]>> = {
  owner: ['suppliers', 'products', 'invoices', 'orders', 'recipes'],
  manager: ['suppliers', 'products', 'invoices', 'orders', 'recipes'],
  bookkeeper: ['suppliers', 'products', 'invoices'],
  chef: ['orders', 'recipes'],
  receiver: [],
};

const none = <T>(): Promise<T[]> => Promise.resolve([]);

export const searchRouter = router({
  global: memberProcedure
    .input(z.object({ q: z.string().trim().min(2).max(100) }))
    .query(async ({ ctx, input }) => {
      const q = input.q;
      const like = `%${q}%`;
      const rid = ctx.session.restaurantId;
      const kinds = new Set(SEARCH_KINDS[ctx.session.role] ?? []);

      const [supplierRows, productRows, invoiceRows, orderRows, recipeRows] = await Promise.all([
        !kinds.has('suppliers')
          ? none<{ id: string; name: string; nameEn: string | null }>()
          : ctx.db
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
        !kinds.has('products')
          ? none<{ id: string; canonicalName: string; nameEn: string | null }>()
          : ctx.db
              .select({
                id: products.id,
                canonicalName: products.canonicalName,
                nameEn: products.nameEn,
              })
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
        !kinds.has('invoices')
          ? none<{ id: string; invoiceNumber: string | null }>()
          : ctx.db
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
        // Purchase orders by supplier name or order reference (no ₪ returned).
        !kinds.has('orders')
          ? none<{
              id: string;
              supplierName: string;
              customerRef: string | null;
              status: string;
              expectedDeliveryAt: Date | null;
            }>()
          : ctx.db
              .select({
                id: purchaseOrders.id,
                supplierName: suppliers.name,
                customerRef: purchaseOrders.customerRef,
                status: purchaseOrders.status,
                expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
              })
              .from(purchaseOrders)
              .innerJoin(
                suppliers,
                // Supplier of the same restaurant only (purchase_orders.supplier_id is not tenant-composite).
                and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.restaurantId, rid)),
              )
              .where(
                and(
                  eq(purchaseOrders.restaurantId, rid),
                  sql`(${suppliers.name} ILIKE ${like} OR ${purchaseOrders.customerRef} ILIKE ${like} OR ${purchaseOrders.sourceRef} ILIKE ${like})`,
                ),
              )
              .orderBy(sql`${purchaseOrders.createdAt} DESC`)
              .limit(PER_KIND),
        // Recipes by name (he or en); menu price is not returned.
        !kinds.has('recipes')
          ? none<{ id: string; name: string; nameEn: string | null }>()
          : ctx.db
              .select({ id: recipes.id, name: recipes.name, nameEn: recipes.nameEn })
              .from(recipes)
              .where(
                and(
                  eq(recipes.restaurantId, rid),
                  sql`(${recipes.name} % ${q} OR ${recipes.name} ILIKE ${like} OR ${recipes.nameEn} ILIKE ${like})`,
                ),
              )
              .orderBy(sql`similarity(${recipes.name}, ${q}) DESC`)
              .limit(PER_KIND),
      ]);

      return {
        suppliers: supplierRows,
        products: productRows,
        invoices: invoiceRows,
        orders: orderRows,
        recipes: recipeRows,
      };
    }),
});
