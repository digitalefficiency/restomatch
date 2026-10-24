import { eq, poLines, purchaseOrders, restaurants, sql, suppliers, type Database } from '@restomatch/db';
import { buildOrderDocument } from './build';
import type { OrderDocument, OrderDocumentExtension, OrderDocumentSettings } from './types';

const DEFAULT_TZ = 'Asia/Jerusalem';

/** Per-restaurant order-document settings (restaurants.settings.orderDocument). Default: show prices. */
export function orderDocumentSettingsOf(settings: unknown): Required<OrderDocumentSettings> {
  const s = (settings as { orderDocument?: OrderDocumentSettings } | null | undefined)?.orderDocument;
  return { showPrices: s?.showPrices !== false };
}

export interface LoadedOrderDocument {
  doc: OrderDocument;
  supplier: { name: string; email: string | null; whatsapp: string | null };
}

/**
 * Build the supplier-facing document for a PO. The caller has already checked
 * the PO belongs to `restaurantId`. The SKU falls back to the supplier's
 * catalog number for the line's product when the PO line has none.
 */
export async function loadOrderDocument(
  db: Database,
  restaurantId: string,
  poId: string,
  opts: { placedAt?: Date; extensions?: OrderDocumentExtension[] } = {},
): Promise<LoadedOrderDocument | null> {
  const [po] = await db
    .select({
      supplierId: purchaseOrders.supplierId,
      expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
      sentAt: purchaseOrders.sentAt,
      notes: purchaseOrders.notes,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  if (!po) return null;
  const [[supplier], [restaurant]] = await Promise.all([
    db
      .select({ name: suppliers.name, email: suppliers.contactEmail, whatsapp: suppliers.contactWhatsapp })
      .from(suppliers)
      .where(eq(suppliers.id, po.supplierId))
      .limit(1),
    db
      .select({ name: restaurants.name, timezone: restaurants.timezone, settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1),
  ]);
  const lines = await db
    .select({
      rawDescription: poLines.rawDescription,
      supplierSku: sql<string | null>`coalesce(${poLines.supplierSku}, (
        select sci.supplier_sku from supplier_catalog_items sci
        where sci.restaurant_id = ${restaurantId}
          and sci.supplier_id = ${po.supplierId}
          and sci.product_id = po_lines.product_id
          and sci.active and sci.supplier_sku is not null
        order by sci.updated_at desc limit 1))`,
      qtyOrdered: poLines.qtyOrdered,
      unit: poLines.unit,
      unitPriceExpected: poLines.unitPriceExpected,
    })
    .from(poLines)
    .where(eq(poLines.poId, poId));

  const supplierName = supplier?.name ?? 'ספק';
  const doc = buildOrderDocument({
    restaurantName: restaurant?.name ?? '',
    supplierName,
    poId,
    placedAt: opts.placedAt ?? po.sentAt ?? new Date(),
    expectedDeliveryAt: po.expectedDeliveryAt,
    timezone: restaurant?.timezone ?? DEFAULT_TZ,
    notes: po.notes,
    showPrices: orderDocumentSettingsOf(restaurant?.settings).showPrices,
    lines,
    extensions: opts.extensions,
  });
  return {
    doc,
    supplier: { name: supplierName, email: supplier?.email ?? null, whatsapp: supplier?.whatsapp ?? null },
  };
}

/** `order-1A2B3C4D.pdf` — ASCII so every mail client keeps the name. */
export function orderPdfFilename(doc: Pick<OrderDocument, 'orderRef'>): string {
  return `order-${doc.orderRef}.pdf`;
}
