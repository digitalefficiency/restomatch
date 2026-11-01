import { TRPCError } from '@trpc/server';
import { and, auditLog, discrepancies, eq, ingestDocuments, invoices, matchRuns, ne, sql, type Database } from '@restomatch/db';
import { enqueueMatchInvoice } from '@restomatch/queue';
import { DocumentError, documentNotFound } from './errors';
import { PAGES_RECOMPOSED_ACTION, retireInvoice } from './reocr';
import { PAGE_FLAGS, type PageFlag } from './settle';

/**
 * G-09 · the inbox's recourse for a flagged page (owner/manager).
 *
 *  - `separate` — "זו חשבונית נפרדת": the page is its own invoice. Its flag is
 *    replaced by `page_separate` (a permanent chain break: it never joins a
 *    document again), an audit row keeps the old flag, and its match is enqueued.
 *  - `delete_duplicate` — "מחק כפילות": only for `page_duplicate`. The copy's
 *    invoice is retired behind every refusal guard (claim, decision, approval,
 *    credit note, goods receipt, price history); the scan object is kept.
 */
export type PageFlagAction = 'separate' | 'delete_duplicate';

/** Set after a person decided a flagged page is its own invoice. Not a question any more. */
export const PAGE_SEPARATE = 'page_separate';
export const PAGE_SEPARATED_ACTION = 'document.page_separated';

export interface ResolveDeps {
  enqueueMatch?: (job: { restaurantId: string; invoiceId: string }) => Promise<unknown>;
}

export async function resolvePageFlag(
  db: Database,
  args: { restaurantId: string; documentId: string; action: PageFlagAction; userId: string | null },
  deps: ResolveDeps = {},
): Promise<{ invoiceId: string | null; action: PageFlagAction }> {
  const { restaurantId, documentId, action } = args;
  const out = await db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    const [doc] = await tx
      .select({ id: ingestDocuments.id, error: ingestDocuments.error, invoiceId: ingestDocuments.invoiceId })
      .from(ingestDocuments)
      .where(and(eq(ingestDocuments.id, documentId), eq(ingestDocuments.restaurantId, restaurantId)))
      .limit(1)
      .for('update');
    if (!doc || !doc.invoiceId) throw documentNotFound();
    const flag = doc.error as PageFlag | null;
    if (!flag || !(PAGE_FLAGS as readonly string[]).includes(flag)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'not_flagged' });
    }
    const invoiceId = doc.invoiceId;
    // The same locks settle/attach take: no decision, claim or credit note can
    // land on this invoice between the checks below and the retire.
    const [inv] = await tx
      .select({ id: invoices.id, status: invoices.status, invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
      .limit(1)
      .for('update');
    if (!inv) throw documentNotFound();
    await tx.execute(sql`
      select d.id from ${discrepancies} d
      join ${matchRuns} r on r.id = d.match_run_id and r.restaurant_id = d.restaurant_id
      where d.restaurant_id = ${restaurantId} and r.invoice_id = ${invoiceId}
      for update of d`);

    if (action === 'delete_duplicate') {
      if (flag !== 'page_duplicate') throw new TRPCError({ code: 'CONFLICT', message: 'not_a_duplicate' });
      // Only a ONE-page invoice: never delete pages that are not the duplicate.
      const others = await tx
        .select({ id: ingestDocuments.id })
        .from(ingestDocuments)
        .where(
          and(
            eq(ingestDocuments.restaurantId, restaurantId),
            eq(ingestDocuments.invoiceId, invoiceId),
            eq(ingestDocuments.status, 'registered'),
            ne(ingestDocuments.id, doc.id),
          ),
        )
        .limit(1);
      const [recomposed] = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, 'invoice'),
            eq(auditLog.entityId, invoiceId),
            eq(auditLog.restaurantId, restaurantId),
            eq(auditLog.action, PAGES_RECOMPOSED_ACTION),
          ),
        )
        .limit(1);
      if (others.length > 0 || recomposed) throw new DocumentError('multi_page');
      // An invoice the worker blanked as "a duplicate of THIS copy" keeps the
      // number: it takes it over, loses the marker, and is matched.
      const keepers = (await tx.execute(sql`
        select id, ocr_payload from ${invoices}
        where restaurant_id = ${restaurantId} and id <> ${invoiceId}
          and ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId' = ${invoiceId}
        for update`)) as unknown as Array<{ id: string; ocr_payload: { raw?: Record<string, unknown> } | null }>;
      // Clear the flags on ALL its rows first (ON DELETE SET NULL clears invoice_id after the retire).
      await tx
        .update(ingestDocuments)
        .set({ status: 'duplicate', error: null, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, invoiceId)));
      const retired = await retireInvoice(tx, { restaurantId, invoiceId, absorbedInto: null, userId: args.userId });
      if (!retired.ok) throw retired.reason === 'not_found' ? documentNotFound() : new DocumentError(retired.reason);
      const released: string[] = [];
      for (const k of keepers) {
        const raw = { ...(k.ocr_payload?.raw ?? {}) };
        const dup = raw.duplicateOf as { invoiceNumber?: string } | undefined;
        delete raw.duplicateOf;
        await tx
          .update(invoices)
          .set({
            invoiceNumber: dup?.invoiceNumber ?? inv.invoiceNumber ?? null,
            ocrPayload: { ...(k.ocr_payload ?? {}), raw } as never,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, k.id), eq(invoices.restaurantId, restaurantId)));
        await tx.insert(auditLog).values({
          restaurantId,
          userId: args.userId,
          action: 'document.duplicate_marker_moved',
          entityType: 'invoice',
          entityId: k.id,
          before: { duplicateOf: invoiceId } as never,
          after: { invoiceNumber: dup?.invoiceNumber ?? inv.invoiceNumber ?? null } as never,
        });
        released.push(k.id);
      }
      return { invoiceId: null, match: false, released };
    }

    // separate: every row of this invoice carries the decision.
    await tx
      .update(ingestDocuments)
      .set({ error: PAGE_SEPARATE, updatedAt: new Date() })
      .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, invoiceId)));
    await tx.insert(auditLog).values({
      restaurantId,
      userId: args.userId,
      action: PAGE_SEPARATED_ACTION,
      entityType: 'invoice',
      entityId: invoiceId,
      before: { flag } as never,
      after: { flag: PAGE_SEPARATE } as never,
    });
    const [run] = await tx
      .select({ id: matchRuns.id })
      .from(matchRuns)
      .where(and(eq(matchRuns.restaurantId, restaurantId), eq(matchRuns.invoiceId, invoiceId)))
      .limit(1);
    return { invoiceId, match: !run && inv.status === 'matched', released: [] as string[] };
  });
  const toMatch = [...(out.match && out.invoiceId ? [out.invoiceId] : []), ...out.released];
  for (const id of toMatch) {
    try {
      await (deps.enqueueMatch ?? enqueueMatchInvoice)({ restaurantId, invoiceId: id });
    } catch (err) {
      console.warn(`[documents] failed to enqueue match for invoice=${id}`, err);
    }
  }
  return { invoiceId: out.invoiceId, action };
}
