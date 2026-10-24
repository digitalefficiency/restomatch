import { eq, poLines, purchaseOrders, restaurants, sql, suppliers, type Database } from '@restomatch/db';
import { applyOrderDocumentExtensions, buildOrderDocument } from './build';
import { isFeatureOn } from '../../lib/featureGate';
import type { ContractPriceResolver, OrderDocument, OrderDocumentExtension, OrderDocumentSettings } from './types';

const DEFAULT_TZ = 'Asia/Jerusalem';

/**
 * Where contract prices come from (S11's contracts/orderPrices.ts
 * `contractPricesForOrder`, registered at integration). Null = no contracts
 * module: no line is ever called "agreed".
 */
export const orderDocumentContractPrices: { resolve: ContractPriceResolver | null } = { resolve: null };

/** The PO price IS the contract price, to the agora — only then may the document call it agreed. */
export function isContractPrice(poUnitPrice: string | null, contractPrice: number | undefined): boolean {
  if (poUnitPrice === null || contractPrice === undefined) return false;
  return Math.round(Number(poUnitPrice) * 100) === Math.round(contractPrice * 100);
}

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
  opts: {
    mode: 'send' | 'preview';
    userId: string | null;
    placedAt?: Date;
    extensions?: readonly OrderDocumentExtension[];
  },
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
      productId: poLines.productId,
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

  // "Agreed" only where the PO price is the contract price in force on the order date
  // (flag `contracts` on and a contracts module registered); otherwise no line claims it.
  const placedAt = opts.placedAt ?? po.sentAt ?? new Date();
  let contractByKey = new Map<string, number>();
  const resolve = orderDocumentContractPrices.resolve;
  if (resolve && (await isFeatureOn(db, restaurantId, 'contracts'))) {
    const items = lines.flatMap((l) => (l.productId ? [{ productId: l.productId, unit: l.unit }] : []));
    if (items.length > 0) contractByKey = await resolve(db, restaurantId, po.supplierId, items, placedAt);
  }
  const supplierName = supplier?.name ?? 'ספק';
  const doc = buildOrderDocument({
    restaurantName: restaurant?.name ?? '',
    supplierName,
    poId,
    placedAt,
    expectedDeliveryAt: po.expectedDeliveryAt,
    timezone: restaurant?.timezone ?? DEFAULT_TZ,
    notes: po.notes,
    showPrices: orderDocumentSettingsOf(restaurant?.settings).showPrices,
    lines: lines.map((l) => ({
      ...l,
      contractPrice: l.productId != null && isContractPrice(l.unitPriceExpected, contractByKey.get(`${l.productId}|${l.unit}`)),
    })),
  });
  const withExtras = await applyOrderDocumentExtensions(doc, opts.extensions ?? [], {
    db,
    restaurantId,
    poId,
    userId: opts.userId,
    mode: opts.mode,
  });
  return {
    doc: withExtras,
    supplier: { name: supplierName, email: supplier?.email ?? null, whatsapp: supplier?.whatsapp ?? null },
  };
}

/** `order-1A2B3C4D.pdf` — ASCII so every mail client keeps the name. */
export function orderPdfFilename(doc: Pick<OrderDocument, 'orderRef'>): string {
  return `order-${doc.orderRef}.pdf`;
}
