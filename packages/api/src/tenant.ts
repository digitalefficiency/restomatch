import { TRPCError } from '@trpc/server';
import {
  and,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoices,
  poLines,
  purchaseOrders,
  supplierCatalogItems,
  suppliers,
  type Database,
} from '@restomatch/db';

/**
 * Tenant-ownership guards.
 *
 * Every tRPC procedure that receives an entity id from the client MUST verify
 * the entity belongs to the caller's restaurant before reading or writing it.
 * Child tables without their own restaurant_id (gr_lines, po_lines,
 * invoice_lines) are scoped through their parent.
 *
 * All guards throw NOT_FOUND (not FORBIDDEN) for foreign rows so responses do
 * not reveal whether an id exists in another tenant.
 */

const notFound = (entity: string): TRPCError =>
  new TRPCError({ code: 'NOT_FOUND', message: `${entity} not found` });

export async function assertGrOwned(
  db: Database,
  grId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw notFound('goods receipt');
}

export async function assertGrLineOwned(
  db: Database,
  grLineId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: grLines.id })
    .from(grLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, grLines.grId))
    .where(and(eq(grLines.id, grLineId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw notFound('GR line');
}

export async function assertPoOwned(
  db: Database,
  poId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw notFound('purchase order');
}

export async function assertPoLineOwned(
  db: Database,
  poLineId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: poLines.id })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(and(eq(poLines.id, poLineId), eq(purchaseOrders.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw notFound('PO line');
}

export async function assertInvoiceOwned(
  db: Database,
  invoiceId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw notFound('invoice');
}

export async function assertSupplierOwned(
  db: Database,
  supplierId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw notFound('supplier');
}

export async function assertCatalogItemOwned(
  db: Database,
  catalogItemId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: supplierCatalogItems.id })
    .from(supplierCatalogItems)
    .where(
      and(
        eq(supplierCatalogItems.id, catalogItemId),
        eq(supplierCatalogItems.restaurantId, restaurantId),
      ),
    )
    .limit(1);
  if (!row) throw notFound('catalog item');
}

export async function assertDiscrepancyOwned(
  db: Database,
  discrepancyId: string,
  restaurantId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: discrepancies.id })
    .from(discrepancies)
    .where(
      and(eq(discrepancies.id, discrepancyId), eq(discrepancies.restaurantId, restaurantId)),
    )
    .limit(1);
  if (!row) throw notFound('discrepancy');
}
