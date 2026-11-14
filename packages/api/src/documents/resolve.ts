import { TRPCError } from '@trpc/server';
import { and, auditLog, discrepancies, eq, ingestDocuments, invoices, matchRuns, ne, sql, type Database } from '@restomatch/db';
import { enqueueMatchInvoice } from '@restomatch/queue';
import { DocumentError, documentNotFound } from './errors';
import { PAGES_RECOMPOSED_ACTION, retireInvoice } from './reocr';
import { PAGE_FLAGS, PAGE_ONE_FLAGS, type PageFlag } from './settle';

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
export type PageFlagAction = 'separate' | 'delete_duplicate' | 'close_unreadable' | 'checked_together' | 'undo_checked_together';

/**
 * Round 8: a person compared the page with its page 1 — they are ONE invoice (answered;
 * nothing merged or split). Round 9 (N4): the person picks which invoice carries the
 * total; the other is marked raw.paidWith and held in the pay run (T4), never paid twice.
 */
export const PAGE_CHECKED_TOGETHER = 'page_checked_together';
export const CHECKED_TOGETHER_ACTION = 'document.page_checked_together';

/** Round 7: a person closed an unreadable page as not read (answered; the invoice is untouched). */
export const PAGE_UNREADABLE_CLOSED = 'page_unreadable_closed';

/** Set after a person decided a flagged page is its own invoice. Not a question any more. */
export const PAGE_SEPARATE = 'page_separate';
export const PAGE_SEPARATED_ACTION = 'document.page_separated';

export interface ResolveDeps {
  enqueueMatch?: (job: { restaurantId: string; invoiceId: string }) => Promise<unknown>;
}

export async function resolvePageFlag(
  db: Database,
  args: {
    restaurantId: string;
    documentId: string;
    action: PageFlagAction;
    userId: string | null;
    /**
     * Round 9 (N4), `checked_together` only: which of the two invoices carries the
     * document's total and is paid — the page's own invoice or the one it belongs to.
     * The other is held in the pay run as "paid with" it (never paid twice).
     */
    payableInvoiceId?: string;
    /** …and the invoice the person compared it with (one of the heads settle recorded; default the likeliest). */
    withInvoiceId?: string;
  },
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
    let flag = doc.error as PageFlag | null;
    // Round 6: "separate" on a possible duplicate is reversible — a page a
    // person separated while it was page_duplicate can still be deleted.
    if (flag === (PAGE_SEPARATE as string) && action === 'delete_duplicate' && doc.invoiceId) {
      const [was] = await tx
        .select({ before: auditLog.before })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, restaurantId),
            eq(auditLog.entityType, 'invoice'),
            eq(auditLog.entityId, doc.invoiceId),
            eq(auditLog.action, PAGE_SEPARATED_ACTION),
          ),
        )
        .orderBy(sql`${auditLog.at} desc`)
        .limit(1);
      if ((was?.before as { flag?: string } | null)?.flag === 'page_duplicate') flag = 'page_duplicate';
    }
    // Round 10 (P6/P7): "checked together" is undoable (audited): the page asks again,
    // and the invoices that answer marked "included" are payable on their own again.
    if (action === 'undo_checked_together') {
      if (flag !== (PAGE_CHECKED_TOGETHER as string)) throw new TRPCError({ code: 'CONFLICT', message: 'not_flagged' });
      const [was] = await tx
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, restaurantId),
            eq(auditLog.entityType, 'invoice'),
            eq(auditLog.entityId, doc.invoiceId),
            eq(auditLog.action, CHECKED_TOGETHER_ACTION),
          ),
        )
        .orderBy(sql`${auditLog.at} desc`)
        .limit(1);
      const before = (was?.before as { flag?: string } | null)?.flag;
      const after = (was?.after as { payableInvoiceId?: string; paidWithInvoiceIds?: string[]; paidWithInvoiceId?: string } | null) ?? {};
      const restore = before && (PAGE_ONE_FLAGS as readonly string[]).includes(before) ? before : 'page_not_merged';
      const marked = after.paidWithInvoiceIds ?? (after.paidWithInvoiceId ? [after.paidWithInvoiceId] : []);
      if (marked.length > 0 && after.payableInvoiceId) {
        const list = sql.join(marked.map((id) => sql`${id}::uuid`), sql`, `);
        await tx.execute(sql`
          update ${invoices}
             set ocr_payload = jsonb_set(ocr_payload, '{raw}', (ocr_payload -> 'raw') - 'paidWith'), updated_at = now()
           where restaurant_id = ${restaurantId} and id in (${list})
             and ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId' = ${after.payableInvoiceId}`);
      }
      await tx
        .update(ingestDocuments)
        .set({ error: restore, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, doc.invoiceId), eq(ingestDocuments.error, PAGE_CHECKED_TOGETHER)));
      await tx.insert(auditLog).values({
        restaurantId,
        userId: args.userId,
        action: 'document.page_checked_together_undone',
        entityType: 'invoice',
        entityId: doc.invoiceId,
        before: { flag: PAGE_CHECKED_TOGETHER } as never,
        after: { flag: restore, released: marked } as never,
      });
      return { invoiceId: doc.invoiceId, match: false, released: [] as string[] };
    }
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
      // Invoices the worker blanked as "a duplicate of THIS copy". Only the
      // in-cluster chain page the copy repeats (recorded by settle) takes the
      // number back and is matched; any other (an unrelated re-send) stays
      // blanked, its marker re-pointed at that keeper (round 5).
      const [self] = (await tx.execute(sql`
        select ocr_payload -> 'raw' -> 'pageRepeats' ->> 'invoiceId' as repeats
        from ${invoices} where id = ${invoiceId} and restaurant_id = ${restaurantId}`)) as unknown as Array<{ repeats: string | null }>;
      const repeats = self?.repeats ?? null;
      const blanked = (await tx.execute(sql`
        select id, ocr_payload from ${invoices}
        where restaurant_id = ${restaurantId} and id <> ${invoiceId}
          and ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId' = ${invoiceId}
        order by id
        for update`)) as unknown as Array<{ id: string; ocr_payload: { raw?: Record<string, unknown> } | null }>;
      const keepers = blanked.filter((k) => k.id === repeats);
      const bystanders = blanked.filter((k) => k.id !== repeats);
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
      for (const o of bystanders) {
        if (keepers.length === 0) continue; // nothing to point at: left as it is
        const raw = { ...(o.ocr_payload?.raw ?? {}) };
        raw.duplicateOf = { ...(raw.duplicateOf as Record<string, unknown>), invoiceId: keepers[0]!.id };
        await tx
          .update(invoices)
          .set({ ocrPayload: { ...(o.ocr_payload ?? {}), raw } as never, updatedAt: new Date() })
          .where(and(eq(invoices.id, o.id), eq(invoices.restaurantId, restaurantId)));
      }
      return { invoiceId: null, match: false, released };
    }

    if (action === 'checked_together') {
      if (!(PAGE_ONE_FLAGS as readonly string[]).includes(flag)) throw new TRPCError({ code: 'CONFLICT', message: 'not_comparable' });
      // Round 9 (N4): ONE invoice stays payable. Round 10 (P9): the pair is the page's
      // invoice and its LIKELIEST head (raw.pageOf.invoiceId — what every compare shows).
      const [pair] = (await tx.execute(sql`
        select ocr_payload -> 'raw' -> 'pageOf' ->> 'invoiceId' as head
          from ${invoices} where id = ${invoiceId} and restaurant_id = ${restaurantId}`)) as unknown as Array<{ head: string | null }>;
      const head = pair?.head ?? null;
      if (!head) throw new TRPCError({ code: 'CONFLICT', message: 'not_comparable' });
      if (args.withInvoiceId && args.withInvoiceId !== head) throw new TRPCError({ code: 'BAD_REQUEST', message: 'payable_required' });
      const payable = args.payableInvoiceId;
      if (!payable) throw new TRPCError({ code: 'BAD_REQUEST', message: 'payable_required' });
      // Round 10 (P4/Q4): ONE group. Any invoice already "included in" one of the pair,
      // or that one of the pair is included in, joins it — and every member is
      // re-pointed to the carrier picked now (order-independent: exactly one payable).
      const rows = (await tx.execute(sql`
        with recursive grp(id) as (
          select unnest(array[${invoiceId}::uuid, ${head}::uuid])
          union
          select i.id from ${invoices} i, grp
           where i.restaurant_id = ${restaurantId}
             and (i.id::text = (select g.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId' from ${invoices} g where g.id = grp.id and g.restaurant_id = ${restaurantId})
                  or (i.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId') = grp.id::text))
        select i.id::text as id, i.status, i.supplier_id::text as supplier_id,
               (i.ocr_payload -> 'raw' -> 'duplicateOf') is not null as dup_stamp,
               exists (select 1 from ${matchRuns} mr join ${discrepancies} d on d.match_run_id = mr.id and d.restaurant_id = mr.restaurant_id
                        where mr.invoice_id = i.id and mr.restaurant_id = i.restaurant_id
                          and d.type = 'DUPLICATE_INVOICE' and d.resolution_status in ('open', 'escalated', 'accepted')) as dup_finding
          from ${invoices} i join grp on grp.id = i.id
         where i.restaurant_id = ${restaurantId}
         for update of i`)) as unknown as Array<{ id: string; status: string; supplier_id: string | null; dup_stamp: boolean; dup_finding: boolean }>;
      const pairRows = rows.filter((r) => r.id === invoiceId || r.id === head);
      if (pairRows.length < 2) throw new TRPCError({ code: 'CONFLICT', message: 'not_comparable' });
      // the payable is one of the pair — or the invoice the head is already included in
      if (!rows.some((r) => r.id === payable)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'payable_required' });
      // Round 10 (P7): never across suppliers.
      const suppliers = new Set(rows.map((r) => r.supplier_id).filter(Boolean));
      if (suppliers.size > 1) throw new TRPCError({ code: 'CONFLICT', message: 'not_comparable' });
      // Round 10 (P6): never while either is being re-read (its invoice may still change).
      if (pairRows.some((r) => r.status === 'ocr_pending')) throw new TRPCError({ code: 'CONFLICT', message: 'reocr_pending' });
      // Round 10 (P5): a known duplicate is never folded into a payable invoice (it would
      // hide as a calm "included" row while its copy is paid again).
      if (rows.some((r) => r.dup_stamp || r.dup_finding)) throw new TRPCError({ code: 'CONFLICT', message: 'duplicate_on_file' });
      if (rows.some((r) => r.status === 'paid' && r.id !== payable)) throw new TRPCError({ code: 'CONFLICT', message: 'already_paid' });
      const marked = rows.map((r) => r.id).filter((id) => id !== payable);
      const markList = sql.join(marked.map((id) => sql`${id}::uuid`), sql`, `);
      await tx.execute(sql`
        update ${invoices}
           set ocr_payload = coalesce(ocr_payload, '{}'::jsonb) || jsonb_build_object('raw',
                 coalesce(ocr_payload -> 'raw', '{}'::jsonb) || jsonb_build_object('paidWith', jsonb_build_object('invoiceId', ${payable}::text))),
               updated_at = now()
         where restaurant_id = ${restaurantId} and id in (${markList})`);
      // the carrier itself is payable — never "included" in anything
      await tx.execute(sql`
        update ${invoices}
           set ocr_payload = jsonb_set(ocr_payload, '{raw}', (ocr_payload -> 'raw') - 'paidWith'), updated_at = now()
         where restaurant_id = ${restaurantId} and id = ${payable}::uuid and (ocr_payload -> 'raw') ? 'paidWith'`);
      await tx
        .update(ingestDocuments)
        .set({ error: PAGE_CHECKED_TOGETHER, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, invoiceId), eq(ingestDocuments.error, flag)));
      await tx.insert(auditLog).values({
        restaurantId,
        userId: args.userId,
        action: CHECKED_TOGETHER_ACTION,
        entityType: 'invoice',
        entityId: invoiceId,
        before: { flag } as never,
        after: { flag: PAGE_CHECKED_TOGETHER, payableInvoiceId: payable, withInvoiceId: head, paidWithInvoiceIds: marked } as never,
      });
      return { invoiceId, match: false, released: [] as string[] };
    }

    if (action === 'close_unreadable') {
      if (flag !== 'page_unreadable') throw new TRPCError({ code: 'CONFLICT', message: 'not_unreadable' });
      await tx
        .update(ingestDocuments)
        .set({ error: PAGE_UNREADABLE_CLOSED, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, invoiceId), eq(ingestDocuments.error, 'page_unreadable')));
      await tx.insert(auditLog).values({
        restaurantId,
        userId: args.userId,
        action: 'document.page_unreadable_closed',
        entityType: 'invoice',
        entityId: invoiceId,
        before: { flag } as never,
        after: { flag: PAGE_UNREADABLE_CLOSED } as never,
      });
      return { invoiceId, match: false, released: [] as string[] };
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
