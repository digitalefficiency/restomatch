/**
 * The DEFAULT supplier order message (flag `orderPricesOut` off): the email /
 * WhatsApp body a supplier receives. With `orderPricesOut` on, S5's
 * orders/document/ builds the priced email/WhatsApp/PDF instead; placeOrder
 * picks that one when the flag is on and this one otherwise.
 *
 * Pure: (loaded PO + restaurant + contact) → { subject, body }. The caller
 * loads the rows; placeOrder enqueues exactly this text and
 * orders.documentPreview shows exactly this text before sending.
 */

export interface SupplierMessageInput {
  /** Short reference the supplier can quote back (PO id prefix), when the PO exists. */
  poRef?: string | null;
  supplierName: string;
  restaurant: { name: string; businessId?: string | null };
  /** The manager placing the order — the supplier's contact for this delivery. */
  contact?: { name?: string | null; phone?: string | null; email?: string | null } | null;
  expectedDeliveryAt: Date | null;
  lines: Array<{ name: string | null; qtyOrdered: string | number; unit: string }>;
  tz: string;
}

/** "15.000" → "15", "2.500" → "2.5", "1250" → "1,250" (he-IL grouping). */
export function formatOrderQty(qty: string | number): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return String(qty);
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 3 }).format(n);
}

export function renderSupplierMessage(d: SupplierMessageInput): { subject: string; body: string } {
  const subject = `הזמנה חדשה — ${d.restaurant.name}`;
  const from = d.restaurant.businessId
    ? `מאת: ${d.restaurant.name} (ח.פ. ${d.restaurant.businessId})`
    : `מאת: ${d.restaurant.name}`;
  const contactParts = [d.contact?.name, d.contact?.phone, d.contact?.email].filter(
    (x): x is string => !!x && x.trim().length > 0,
  );
  const delivery = d.expectedDeliveryAt
    ? `אספקה מבוקשת: ${d.expectedDeliveryAt.toLocaleDateString('he-IL', {
        timeZone: d.tz,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`
    : 'אספקה מבוקשת: לתיאום מול המסעדה';
  const items = d.lines.map((l) => `• ${l.name?.trim() || 'פריט'} — ${formatOrderQty(l.qtyOrdered)} ${l.unit}`);
  const body = [
    `הזמנה לספק ${d.supplierName}`,
    from,
    contactParts.length > 0 ? `איש קשר: ${contactParts.join(' · ')}` : null,
    d.poRef ? `מס׳ הזמנה: ${d.poRef}` : null,
    delivery,
    '',
    ...items,
    '',
    `סה״כ ${d.lines.length} פריטים`,
  ]
    .filter((x): x is string => x !== null)
    .join('\n');
  return { subject, body };
}

/** The reference printed on the document: first 8 hex of the PO id, upper-case. */
export function poRefOf(poId: string): string {
  return poId.replace(/-/g, '').slice(0, 8).toUpperCase();
}
