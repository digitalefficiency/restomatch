import { and, desc, eq, invoices, sql, suppliers } from '@restomatch/db';
import { financeProcedure, router } from '../trpc';

/**
 * Invoice register, cockpit and intake (wave 2, W2-02).
 *
 * Registered empty in wave 1 (W1-04) so later packages add procedures here
 * without editing `index.ts`. Every procedure added needs a COVERAGE entry
 * and a cross-tenant attack test (DoD-8).
 *
 * PILOT (train B): `needsLines` — the invoices waiting for a person to complete
 * their lines, so an owner can find an unread photo invoice without a link.
 * W2-02's full register (#217) supersedes it at integration.
 */

export type NeedsLinesReason = 'ocr_failed' | 'no_lines';

export interface NeedsLinesRow {
  id: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceDate: Date | null;
  invoiceNumber: string | null;
  reason: NeedsLinesReason;
}

export const invoicesRouter = router({
  /**
   * This restaurant's invoices that need lines from a person: the read failed
   * (`ocr_payload.raw.ocrFailed`), or a scanned invoice (photo / e-mail /
   * WhatsApp — the ones OCR reads) came out with 0 lines. A typed or
   * platform-imported invoice was never "read", so 0 lines there is not this list. Not
   * while OCR is still reading, not paid, never a חשבונית מרכזת (cross-matched
   * against its delivery notes, not itemised). Owner, manager, bookkeeper only.
   */
  needsLines: financeProcedure.query(async ({ ctx }): Promise<{ count: number; rows: NeedsLinesRow[] }> => {
    const rid = ctx.session.restaurantId;
    const failed = sql<boolean>`COALESCE((${invoices.ocrPayload} -> 'raw' ->> 'ocrFailed') = 'true', false)`;
    const noLines = sql<boolean>`NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = ${invoices.id})`;
    const consolidated = sql<boolean>`COALESCE((${invoices.ocrPayload} -> 'raw' ->> 'kind') = 'consolidated', false)`;
    const rows = await ctx.db
      .select({
        id: invoices.id,
        supplierName: suppliers.name,
        supplierNameEn: suppliers.nameEn,
        invoiceDate: invoices.invoiceDate,
        invoiceNumber: invoices.invoiceNumber,
        failed,
      })
      .from(invoices)
      .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
      .where(
        and(
          eq(invoices.restaurantId, rid),
          sql`${invoices.status} <> 'paid'`,
          sql`NOT ${consolidated}`,
          sql`(${failed} OR (${invoices.status} <> 'ocr_pending' AND ${invoices.source} IN ('photo', 'email', 'whatsapp') AND ${noLines}))`,
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(200);
    const out = rows.map(({ failed: f, ...r }) => ({ ...r, reason: (f ? 'ocr_failed' : 'no_lines') as NeedsLinesReason }));
    return { count: out.length, rows: out };
  }),
});
