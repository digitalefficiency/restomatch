import { and, eq, sql, type Database } from '@restomatch/db';
import {
  discrepancies,
  invoiceLines,
  invoices,
  poLines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  recipeItems,
  supplierCatalogItems,
  supplierContractPrices,
} from '@restomatch/db';
import type { MergeSide } from './mergePreview';

/** Order statuses whose lines can still change (a merge would repoint them). */
const CLOSED_PO = ['closed', 'cancelled'] as const;

/**
 * W3-10 · loads one side of a product merge for ONE restaurant (read-only).
 * Every query is restaurant-scoped on its own table; a product of another
 * restaurant loads as null.
 */
export async function loadMergeSide(db: Database, rid: string, productId: string): Promise<MergeSide | null> {
  const [p] = await db
    .select({ id: products.id, name: products.canonicalName, unit: products.defaultUnit })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.restaurantId, rid)))
    .limit(1);
  if (!p) return null;
  const [aliases, items, recipes, openLines, contracts] = await Promise.all([
    db
      .select({ raw: productAliases.supplierNameRaw })
      .from(productAliases)
      .innerJoin(products, and(eq(products.id, productAliases.productId), eq(products.restaurantId, rid)))
      .where(eq(productAliases.productId, productId)),
    db
      .select({ id: supplierCatalogItems.id, supplierId: supplierCatalogItems.supplierId, supplierSku: supplierCatalogItems.supplierSku })
      .from(supplierCatalogItems)
      .where(and(eq(supplierCatalogItems.restaurantId, rid), eq(supplierCatalogItems.productId, productId))),
    db
      .selectDistinct({ id: recipeItems.recipeId })
      .from(recipeItems)
      .where(and(eq(recipeItems.restaurantId, rid), eq(recipeItems.productId, productId))),
    db
      .select({ id: poLines.id })
      .from(poLines)
      .innerJoin(purchaseOrders, and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, rid)))
      .where(
        and(
          eq(poLines.productId, productId),
          sql`${purchaseOrders.status} not in (${sql.join(CLOSED_PO.map((s) => sql`${s}`), sql`, `)})`,
        ),
      ),
    db
      .select({ id: supplierContractPrices.id, supplierId: supplierContractPrices.supplierId })
      .from(supplierContractPrices)
      .where(and(eq(supplierContractPrices.restaurantId, rid), eq(supplierContractPrices.productId, productId))),
  ]);
  return {
    productId: p.id,
    name: p.name,
    baseUnit: p.unit ?? null,
    aliases: aliases.map((a) => a.raw),
    catalogItems: items,
    recipeIds: recipes.map((r) => r.id),
    openOrderLineIds: openLines.map((l) => l.id),
    contractIds: contracts,
  };
}

/**
 * The money evidence a merge would re-attribute (counts only, no ₪): invoice
 * lines, findings and price-history rows of `from`. Shown so the owner sees
 * that a merge moves leak history, which is why applying one needs sign-off.
 */
export async function loadMergeEvidence(db: Database, rid: string, productId: string) {
  const [[lines], [findings], [history]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoiceLines)
      .innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, rid)))
      .where(eq(invoiceLines.productId, productId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(discrepancies)
      .where(and(eq(discrepancies.restaurantId, rid), eq(discrepancies.productId, productId))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(priceHistory)
      .where(and(eq(priceHistory.restaurantId, rid), eq(priceHistory.productId, productId))),
  ]);
  return { invoiceLines: lines?.n ?? 0, findings: findings?.n ?? 0, priceHistory: history?.n ?? 0 };
}
