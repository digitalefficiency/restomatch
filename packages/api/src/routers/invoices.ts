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

export type NeedsLinesReason = 'ocr_failed' | 'no_lines' | 'held';

/**
 * Codes that never make an invoice "waiting for you" on their own:
 * - link codes belong to G-08's "ממתינות לשיוך" question flow (#200);
 * - 'consolidated' is S13's MARKER on every חשבונית מרכזת, not an action — a
 *   consolidated invoice is listed only with an actionable code next to it.
 * Dropped from a mixed hold's reasons too. Mirrored in SQL by `actionableHold`.
 */
export const NON_ACTION_HOLD_CODES: readonly string[] = ['unlinked', 'unlinkedPo', 'consolidated'];
const NON_ACTION = new Set(NON_ACTION_HOLD_CODES);

/**
 * The non-link review reasons S13's pipeline wrote on a held invoice
 * (`ocr_payload.raw.reviewReasons`). Read loosely: strings, or objects with a
 * `code`; anything else is ignored. Deduplicated, order kept.
 */
export function holdReasonsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const code = typeof r === 'string' ? r : r && typeof r === 'object' && typeof (r as { code?: unknown }).code === 'string' ? (r as { code: string }).code : null;
    if (code && !NON_ACTION.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export interface NeedsLinesRow {
  id: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceDate: Date | null;
  invoiceNumber: string | null;
  /** For the "supplier details" link on supplier_id_mismatch (an id, never ₪). */
  supplierId: string | null;
  reason: NeedsLinesReason;
  /** The actionable review reason codes (S13 #224), e.g. supplier_id_mismatch, doc_kind_receipt — on any row (extra chips). */
  reviewReasons: string[];
}

export const invoicesRouter = router({
  /**
   * This restaurant's invoices that need lines from a person: the read failed
   * (`ocr_payload.raw.ocrFailed`), or a scanned invoice (photo / e-mail /
   * WhatsApp — the ones OCR reads) came out with 0 lines. A typed or
   * platform-imported invoice was never "read", so 0 lines there is not this list. Not
   * while OCR is still reading, not paid, never a חשבונית מרכזת (cross-matched
   * against its delivery notes, not itemised). Owner, manager, bookkeeper only.
   *
   * Also every HELD invoice (status `parsed` with ≥1 actionable `reviewReasons`
   * code — S13 #224), so no invoice sits held without the owner knowing why.
   * A failed read is listed only while it still has no lines (a person may have
   * typed them, #216). Precedence: ocr_failed > no_lines > held; the actionable
   * reasons ride along on every row as extra chips. The whole filter runs in SQL
   * (before LIMIT), so link-only / marker-only holds never crowd the page. No ₪.
   */
  needsLines: financeProcedure.query(async ({ ctx }): Promise<{ count: number; rows: NeedsLinesRow[] }> => {
    const rid = ctx.session.restaurantId;
    const failed = sql<boolean>`COALESCE((${invoices.ocrPayload} -> 'raw' ->> 'ocrFailed') = 'true', false)`;
    const noLines = sql<boolean>`NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = ${invoices.id})`;
    const consolidated = sql<boolean>`COALESCE((${invoices.ocrPayload} -> 'raw' ->> 'kind') = 'consolidated', false)`;
    const scannedNoLines = sql<boolean>`(NOT ${consolidated} AND ${invoices.status} <> 'ocr_pending' AND ${invoices.source} IN ('photo', 'email', 'whatsapp') AND ${noLines})`;
    // ≥1 actionable review code (strings or {code: string}, non-empty — as holdReasonsOf); link codes and the 'consolidated' marker don't count.
    const reasonsJson = sql`${invoices.ocrPayload} -> 'raw' -> 'reviewReasons'`;
    const actionableHold = sql<boolean>`(CASE WHEN jsonb_typeof(${reasonsJson}) = 'array' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${reasonsJson}) e
      WHERE (CASE
          WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}'
          WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'code') = 'string' THEN e ->> 'code'
        END) NOT IN (${sql.join(NON_ACTION_HOLD_CODES.map((c) => sql`${c}`), sql`, `)})
    ) ELSE false END)`;
    const rows = await ctx.db
      .select({
        id: invoices.id,
        supplierName: suppliers.name,
        supplierNameEn: suppliers.nameEn,
        invoiceDate: invoices.invoiceDate,
        invoiceNumber: invoices.invoiceNumber,
        supplierId: invoices.supplierId,
        failed,
        lineless: sql<boolean>`(${noLines})`,
        reviewReasons: sql<unknown>`${invoices.ocrPayload} -> 'raw' -> 'reviewReasons'`,
        unreadLines: sql<boolean>`(${scannedNoLines})`,
        parsed: sql<boolean>`(${invoices.status} = 'parsed')`,
      })
      .from(invoices)
      .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
      .where(
        and(
          eq(invoices.restaurantId, rid),
          sql`${invoices.status} <> 'paid'`,
          sql`(
            (${failed} AND ${noLines})
            OR ${scannedNoLines}
            OR (${invoices.status} = 'parsed' AND ${actionableHold})
          )`,
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(200);
    const out: NeedsLinesRow[] = [];
    for (const { failed: f, lineless, reviewReasons: rr, unreadLines, parsed, ...r } of rows) {
      const reasons = parsed ? holdReasonsOf(rr) : [];
      if (f && lineless) out.push({ ...r, reason: 'ocr_failed', reviewReasons: reasons });
      else if (unreadLines) out.push({ ...r, reason: 'no_lines', reviewReasons: reasons });
      else if (reasons.length > 0) out.push({ ...r, reason: 'held', reviewReasons: reasons });
    }
    return { count: out.length, rows: out };
  }),
});
