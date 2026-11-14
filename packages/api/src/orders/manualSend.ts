import { TRPCError } from '@trpc/server';
import { and, eq, notificationsOutbox, purchaseOrders, sql, type Database } from '@restomatch/db';
import { normalizePhone } from '@restomatch/ingest';

/**
 * A supplier's typed address (deep-fix class 14): an order never goes out
 * through a raw outbox target. Interim for G-06's `Address`: when G-06 merges,
 * `supplierAddress()` becomes `addressOf(supplier, channel)` in one line.
 *
 * WhatsApp → E.164 digits (what the Cloud API takes); e-mail → trimmed, must
 * contain '@'. Anything else → null, and the caller refuses to send. There is
 * no `role:` form, so a supplier order can never fan out to staff.
 */
export type SupplierAddress = { channel: 'email'; to: string } | { channel: 'whatsapp'; to: string };

export function supplierAddress(
  supplier: { email: string | null; whatsapp: string | null } | null | undefined,
  channel: 'email' | 'whatsapp',
): SupplierAddress | null {
  if (!supplier) return null;
  if (channel === 'whatsapp') {
    const to = normalizePhone(supplier.whatsapp);
    return to ? { channel, to } : null;
  }
  const to = supplier.email?.trim() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ? { channel, to } : null;
}

/** Refuse once any goods receipt exists for the PO (W2-06 §5.9). Call with the PO row locked. */
export async function assertNoReceipt(db: Database, restaurantId: string, poId: string): Promise<void> {
  const rows = (await db.execute(
    sql`select 1 as x from goods_receipts g where g.po_id = ${poId} and g.restaurant_id = ${restaurantId} limit 1`,
  )) as unknown as Array<unknown>;
  if (rows.length > 0) {
    throw new TRPCError({ code: 'CONFLICT', message: 'ORDER_HAS_RECEIPT: לא ניתן לשלוח הזמנה שכבר התחילה עליה קבלת סחורה' });
  }
}

/** Row-lock a PO of this restaurant (the same lock receiving.startReceipt takes). */
export async function lockPo(db: Database, restaurantId: string, poId: string) {
  const rows = (await db.execute(
    sql`select status, sent_channel from purchase_orders where id = ${poId} and restaurant_id = ${restaurantId} for update`,
  )) as unknown as Array<{ status: string; sent_channel: string | null }>;
  return rows[0] ?? null;
}

/**
 * "שלחתי מהוואטסאפ שלי" (W2-06 §5.3, orders-09): the manager or chef already
 * sent the order from their own WhatsApp (the tap opened wa.me synchronously).
 * Record it: draft → sent, sentChannel 'whatsapp', NO outbox row — we did not
 * send anything, so nothing may be queued. Idempotent: a second call on a PO
 * already marked this way is a no-op that returns the same result.
 */
export async function markSentManually(
  db: Database,
  args: { restaurantId: string; poId: string },
): Promise<{ ok: true; status: 'sent'; sentChannel: 'whatsapp'; sentAt: string; replayed: boolean }> {
  const row = await lockPo(db, args.restaurantId, args.poId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
  if (row.status !== 'draft') {
    const [po] = await db
      .select({ sentAt: purchaseOrders.sentAt, sentChannel: purchaseOrders.sentChannel })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, args.poId))
      .limit(1);
    const queued = await db
      .select({ id: notificationsOutbox.id })
      .from(notificationsOutbox)
      .where(
        and(
          eq(notificationsOutbox.restaurantId, args.restaurantId),
          eq(notificationsOutbox.relatedEntityType, 'purchase_order'),
          eq(notificationsOutbox.relatedEntityId, args.poId),
        ),
      )
      .limit(1);
    if (row.status === 'sent' && po?.sentChannel === 'whatsapp' && po.sentAt && queued.length === 0) {
      return { ok: true, status: 'sent', sentChannel: 'whatsapp', sentAt: po.sentAt.toISOString(), replayed: true };
    }
    throw new TRPCError({ code: 'CONFLICT', message: 'רק טיוטה ניתנת לשליחה' });
  }
  await assertNoReceipt(db, args.restaurantId, args.poId);
  const lines = (await db.execute(
    sql`select count(*)::int as n from po_lines where po_id = ${args.poId}`,
  )) as unknown as Array<{ n: number }>;
  if (!lines[0] || Number(lines[0].n) === 0) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'אי אפשר לשלוח הזמנה בלי שורות' });
  }
  const sentAt = new Date();
  await db
    .update(purchaseOrders)
    .set({ status: 'sent', sentAt, sentChannel: 'whatsapp', updatedAt: sentAt })
    .where(and(eq(purchaseOrders.id, args.poId), eq(purchaseOrders.restaurantId, args.restaurantId)));
  return { ok: true, status: 'sent', sentChannel: 'whatsapp', sentAt: sentAt.toISOString(), replayed: false };
}
