import {
  and,
  discrepancies,
  eq,
  invoiceScans,
  invoices,
  matchRuns,
  recoveryClaims,
  sql,
  type Database,
} from '@restomatch/db';
import type { DocumentFailureReason } from './types';

/**
 * INTERIM until G-05 merges: the ONE place this package creates an invoice
 * (G-05's invoice machine `initial: ['ocr_pending']`). The swap to G-05's
 * `createInvoice` is this function's body — no other status literal exists
 * in this package outside the interim re-OCR edge below.
 */
export async function createIntakeInvoice(
  tx: Database,
  args: {
    restaurantId: string;
    supplierId: string | null;
    rawImageUrl: string;
    source: 'whatsapp' | 'email' | 'photo';
    createdBy: string | null;
  },
): Promise<string> {
  const [row] = await tx
    .insert(invoices)
    .values({
      restaurantId: args.restaurantId,
      supplierId: args.supplierId,
      rawImageUrl: args.rawImageUrl,
      status: 'ocr_pending',
      source: args.source,
      createdBy: args.createdBy,
    })
    .returning({ id: invoices.id });
  if (!row) throw new Error('failed to register invoice');
  return row.id;
}

/** Point an invoice at its (re)composed object. Never touches the status. */
export async function setInvoiceImage(tx: Database, restaurantId: string, invoiceId: string, rawImageUrl: string): Promise<void> {
  await tx
    .update(invoices)
    .set({ rawImageUrl, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)));
}

/**
 * The invoice ↔ object mapping row (keyed by the invoice UUID — the row that
 * failed for `scan-…` ids), with `page_count`. One row per invoice.
 */
export async function upsertInvoiceScan(
  tx: Database,
  args: { restaurantId: string; invoiceId: string; storagePath: string; mimeType: string; pageCount: number | null },
): Promise<void> {
  const [existing] = await tx
    .select({ id: invoiceScans.id })
    .from(invoiceScans)
    .where(and(eq(invoiceScans.invoiceId, args.invoiceId), eq(invoiceScans.restaurantId, args.restaurantId)))
    .limit(1);
  if (existing) {
    await tx
      .update(invoiceScans)
      .set({ storagePath: args.storagePath, mimeType: args.mimeType, pageCount: args.pageCount })
      .where(eq(invoiceScans.id, existing.id));
    return;
  }
  await tx.insert(invoiceScans).values({
    invoiceId: args.invoiceId,
    restaurantId: args.restaurantId,
    storagePath: args.storagePath,
    mimeType: args.mimeType,
    pageCount: args.pageCount,
  });
}

/** Statuses an invoice may hold and still gain or lose pages. */
export const OPEN_STATUSES = ['ocr_pending', 'parsed', 'matched'] as const;

/**
 * Why an invoice may NOT be recomposed (null = open): approved/paid/disputed,
 * a decided פער (a re-OCR replaces invoice_lines and would orphan it) or a
 * credit claim.
 */
export async function invoiceClosedReason(
  tx: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<DocumentFailureReason | 'not_found' | null> {
  const [inv] = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv) return 'not_found';
  if (!(OPEN_STATUSES as readonly string[]).includes(inv.status)) return 'approved_or_paid';
  const [claim] = await tx
    .select({ id: recoveryClaims.id })
    .from(recoveryClaims)
    .where(and(eq(recoveryClaims.restaurantId, restaurantId), eq(recoveryClaims.invoiceId, invoiceId)))
    .limit(1);
  if (claim) return 'has_claim';
  const [decided] = await tx
    .select({ id: discrepancies.id })
    .from(discrepancies)
    .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, restaurantId)))
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        eq(matchRuns.invoiceId, invoiceId),
        sql`(${discrepancies.resolutionStatus} <> 'open' or ${discrepancies.resolvedAt} is not null or ${discrepancies.resolvedBy} is not null)`,
      ),
    )
    .limit(1);
  if (decided) return 'decided';
  return null;
}
