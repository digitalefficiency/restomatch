import {
  and,
  auditLog,
  creditNotes,
  eq,
  inArray,
  invoiceLines,
  invoices,
  matchRuns,
  priceHistory,
  sql,
  type Database,
} from '@restomatch/db';
import { invoiceClosedReason, OPEN_STATUSES } from './intake';
import type { DocumentFailureReason } from './types';

/* ──────────────────────────────────────────────────────────────────────────
 * The re-OCR and retire edges: INTERIM until G-05's invoice machine lands.
 *
 * Callers run these ONLY for restaurants with the multi-page switch on
 * (`settings.features.multiPage`, see ingest/grouping.ts). They are the only two
 * call sites to swap:
 *   reopenForOcr  → G-05 transition `reocr`  (parsed|matched, no decision, no claim → ocr_pending)
 *   retireInvoice → G-05 transition `retire` (needs an invoice_status value: human-PR via H-03/G-03)
 * ────────────────────────────────────────────────────────────────────────── */

/** The audit action of a retired page invoice (G-05 can add it to the AuditAction union). */
export const PAGE_ABSORBED_ACTION = 'document.page_absorbed';
/** Page 1 re-opened for a composed re-OCR (its single-page print is kept on the row). */
export const PAGES_RECOMPOSED_ACTION = 'document.pages_recomposed';
/** Every re-open for OCR: their count is the generation in the OCR dedupe key. */
export const REOPENED_FOR_OCR_ACTION = 'document.reopened_for_ocr';

/**
 * How many times this invoice was re-opened for OCR (entity-scoped audit
 * lookup). The OCR dedupe key carries it, so an invoice that returns to an
 * object it had before (split, then attach back) still gets a fresh job.
 */
export async function reopenGeneration(tx: Database, restaurantId: string, invoiceId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    select count(*)::int as n from ${auditLog}
    where entity_type = 'invoice' and entity_id = ${invoiceId}
      and restaurant_id = ${restaurantId} and action = ${REOPENED_FOR_OCR_ACTION}`)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Re-open an OPEN, unreferenced invoice for OCR (→ `ocr_pending`). The caller
 * checked `retireBlocker` under row locks. Its match runs are undecided; they
 * are reset here, because a
 * re-OCR replaces invoice_lines and a plain match job skips an invoice that
 * already has a run, which would leave stale gaps (a false leak).
 */
export async function reopenForOcr(tx: Database, restaurantId: string, invoiceId: string): Promise<boolean> {
  const moved = await tx
    .update(invoices)
    .set({ status: 'ocr_pending', updatedAt: new Date() })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: invoices.id });
  if (moved.length === 0) return false;
  await tx.insert(auditLog).values({
    restaurantId,
    userId: null,
    action: REOPENED_FOR_OCR_ACTION,
    entityType: 'invoice',
    entityId: invoiceId,
  });
  await tx.delete(matchRuns).where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
  // The re-OCR rewrites every line and the totals. Clear them now, so a failed
  // re-OCR leaves NO lines (nothing to match, no ₪ computed from a stale
  // single-page read) instead of page 1's old lines without the absorbed pages.
  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  await tx
    .update(invoices)
    .set({ totalExclVat: null, vatAmount: null, totalInclVat: null, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)));
  return true;
}

/**
 * Why a page invoice may NOT be retired (null = it may). Anything that points
 * at it refuses: not open (approved/paid/disputed), a claim, a decided פער, a
 * credit note, a goods-receipt link (a match run on a receipt, or a receiving
 * scan's stamp) or price history.
 */
export async function retireBlocker(
  tx: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<DocumentFailureReason | 'not_found' | null> {
  const closed = await invoiceClosedReason(tx, restaurantId, invoiceId);
  if (closed) return closed;
  const [note] = await tx
    .select({ id: creditNotes.id })
    .from(creditNotes)
    .where(and(eq(creditNotes.restaurantId, restaurantId), eq(creditNotes.invoiceId, invoiceId)))
    .limit(1);
  if (note) return 'has_claim';
  const [grRun] = await tx
    .select({ id: matchRuns.id })
    .from(matchRuns)
    .where(and(eq(matchRuns.restaurantId, restaurantId), eq(matchRuns.invoiceId, invoiceId), sql`${matchRuns.grId} is not null`))
    .limit(1);
  if (grRun) return 'linked';
  const [stamped] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        eq(invoices.id, invoiceId),
        sql`(${invoices.ocrPayload} -> 'raw' ->> 'scanGrId') is not null`,
      ),
    )
    .limit(1);
  if (stamped) return 'linked';
  const [price] = await tx
    .select({ id: priceHistory.id })
    .from(priceHistory)
    .where(and(eq(priceHistory.restaurantId, restaurantId), eq(priceHistory.sourceInvoiceId, invoiceId)))
    .limit(1);
  if (price) return 'linked';
  return null;
}

/**
 * Retire an absorbed page invoice. INTERIM: invoice_status has no retired
 * value, so the open, unreferenced row is removed. It refuses (deletes
 * nothing) when `retireBlocker` names a reason; it NEVER deletes the stored
 * scan (the page's object stays, now listed under the surviving invoice); and
 * it writes an audit row (who, which page invoice, absorbed into which invoice).
 */
export async function retireInvoice(
  tx: Database,
  args: { restaurantId: string; invoiceId: string; absorbedInto: string | null; userId: string | null; print?: unknown },
): Promise<{ ok: true } | { ok: false; reason: DocumentFailureReason | 'not_found' }> {
  const { restaurantId, invoiceId } = args;
  const blocker = await retireBlocker(tx, restaurantId, invoiceId);
  if (blocker) return { ok: false, reason: blocker };
  const [before] = await tx
    .select({
      status: invoices.status,
      supplierId: invoices.supplierId,
      invoiceNumber: invoices.invoiceNumber,
      rawImageUrl: invoices.rawImageUrl,
      source: invoices.source,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!before) return { ok: false, reason: 'not_found' };
  // Undecided runs only (the blocker refused decided ones and receipt runs).
  await tx.delete(matchRuns).where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
  const gone = await tx
    .delete(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: invoices.id });
  if (gone.length === 0) return { ok: false, reason: 'approved_or_paid' };
  await tx.insert(auditLog).values({
    restaurantId,
    userId: args.userId,
    action: PAGE_ABSORBED_ACTION,
    entityType: 'invoice',
    entityId: invoiceId,
    before: { ...before, ...(args.print ? { print: args.print } : {}) } as never,
    after: { absorbedInto: args.absorbedInto } as never,
  });
  return { ok: true };
}
