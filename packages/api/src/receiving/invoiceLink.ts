import { and, auditLog, desc, eq, goodsReceipts, sql, type Database } from '@restomatch/db';

/**
 * W2-05 interim · which invoice a receipt read, durably on the server (no
 * schema change until G-03): an audit row `goods_receipt.invoice_registered`
 * on the receipt, stamped with the receipt's open/close cycle (`version` =
 * its `updatedAt`). `resumeState` reads it, so a reload or a second phone
 * resumes the SAME invoice — no re-shoot, no second OCR job. Written inside
 * registerInvoice's transaction; one row per (receipt, invoice, cycle).
 */
export const INVOICE_LINK_ACTION = 'goods_receipt.invoice_registered';

type Tx = Pick<Database, 'select' | 'insert'>;

export async function linkInvoiceToReceipt(
  tx: Tx,
  link: { restaurantId: string; userId: string; grId: string; invoiceId: string },
): Promise<void> {
  const [gr] = await tx
    .select({ updatedAt: goodsReceipts.updatedAt })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, link.grId), eq(goodsReceipts.restaurantId, link.restaurantId)))
    .limit(1);
  if (!gr) return;
  const version = gr.updatedAt.toISOString();
  const [already] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.restaurantId, link.restaurantId),
        eq(auditLog.action, INVOICE_LINK_ACTION),
        eq(auditLog.entityId, link.grId),
        sql`${auditLog.after}->>'invoiceId' = ${link.invoiceId}`,
        sql`${auditLog.after}->>'version' = ${version}`,
      ),
    )
    .limit(1);
  if (already) return;
  await tx.insert(auditLog).values({
    restaurantId: link.restaurantId,
    userId: link.userId,
    action: INVOICE_LINK_ACTION,
    entityType: 'goods_receipt',
    entityId: link.grId,
    after: { invoiceId: link.invoiceId, version },
  });
}

/** The latest invoice registered for this receipt in its current open/close cycle. */
export async function linkedInvoiceId(
  db: Pick<Database, 'select'>,
  q: { restaurantId: string; grId: string; version: string },
): Promise<string | null> {
  const [row] = await db
    .select({ invoiceId: sql<string>`${auditLog.after}->>'invoiceId'` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.restaurantId, q.restaurantId),
        eq(auditLog.action, INVOICE_LINK_ACTION),
        eq(auditLog.entityId, q.grId),
        sql`${auditLog.after}->>'version' = ${q.version}`,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(1);
  return row?.invoiceId ?? null;
}
