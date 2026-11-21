import { TRPCError } from '@trpc/server';
import { and, auditLog, discrepancies, eq, ingestDocuments, invoices, matchRuns, ne, sql, type Database } from '@restomatch/db';
import { enqueueMatchInvoice } from '@restomatch/queue';
import { DocumentError, documentNotFound } from './errors';
import { PAGES_RECOMPOSED_ACTION, retireInvoice } from './reocr';
import { PAGE_FLAGS, PAGE_ONE_FLAGS, type PageFlag } from './settle';
import { A_PERSONS_DECISION } from '../lib/decisions';
import { isInvoiceRematchLocked } from '../lifecycle/predicates';

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
export const UNDONE_ACTION = 'document.page_checked_together_undone';

/** Round 7: a person closed an unreadable page as not read (answered; the invoice is untouched). */
export const PAGE_UNREADABLE_CLOSED = 'page_unreadable_closed';

/** Set after a person decided a flagged page is its own invoice. Not a question any more. */
export const PAGE_SEPARATE = 'page_separate';
export const PAGE_SEPARATED_ACTION = 'document.page_separated';

/**
 * Round 12 (#9): a group re-match that must happen. Stamped inside the answer's (or the
 * undo's) transaction; the match job clears it once it ran, and the worker's sweep
 * re-enqueues any stamp left behind — the re-match is never lost to a failed enqueue.
 */
export const REMATCH_PENDING_KEY = 'groupRematchPending';

/** Round 12 (#6): answers and undos of one restaurant run one at a time. */
async function lockTogether(tx: Database, restaurantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'g09.checked_together:' + restaurantId}, 0))`);
}

/** Round 12 (#6): an answer's order — the stamp taken under the lock (older answers: their audit time). Alias a. */
const ANSWER_STAMP = sql.raw(`coalesce((a.after ->> 'stampedAt')::timestamptz, a.at)`);

/** The prior state an answer records, and its undo restores (round 11 M3, round 12 #2/#3). */
interface TogetherSnapshot {
  flag?: string;
  members?: Array<{ id: string; paidWith: string | null; status?: string; duplicateOf?: unknown; releasedFromReview?: boolean }>;
  /** Every member's own match_runs row, and its findings, as they were (row_to_json). */
  runs?: unknown[];
  findings?: unknown[];
}

async function markRematchPending(tx: Database, restaurantId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`
    update ${invoices}
       set ocr_payload = jsonb_set(ocr_payload, ${`{raw,${REMATCH_PENDING_KEY}}`}::text[], to_jsonb(now()), true), updated_at = now()
     where restaurant_id = ${restaurantId} and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       and jsonb_typeof(ocr_payload -> 'raw') = 'object'`);
}

export interface ResolveDeps {
  enqueueMatch?: (job: { restaurantId: string; invoiceId: string; rematch?: boolean }) => Promise<unknown>;
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
    /** Round 12 (#8): the person confirmed a carrier whose printed total does not cover the document's lines. */
    acceptShortTotal?: boolean;
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
    // Round 10 (P6/P7) + rounds 11/12 (M3, #3, #6): "checked together" is undoable —
    // EXACTLY: every member's prior state (the answer's snapshot: its link, its stamp, its
    // own run and findings) comes back in this transaction, the carrier's combined run goes,
    // and the page asks again. Last answer first, ordered by a stamp taken under one
    // per-restaurant lock (never the transaction start time). When the prior state can no
    // longer come back exactly (the carrier was approved or paid, a person decided on its
    // run, a member moved on) the undo is refused — never a half-undo.
    if (action === 'undo_checked_together') {
      if (flag !== (PAGE_CHECKED_TOGETHER as string)) throw new TRPCError({ code: 'CONFLICT', message: 'not_flagged' });
      await lockTogether(tx, restaurantId);
      const [was] = (await tx.execute(sql`
        select a.id::text as id, a.before, a.after, ${ANSWER_STAMP} as stamp
          from ${auditLog} a
         where a.restaurant_id = ${restaurantId} and a.entity_type = 'invoice' and a.entity_id = ${doc.invoiceId}
           and a.action = ${CHECKED_TOGETHER_ACTION}
           and not exists (select 1 from ${auditLog} u
                            where u.restaurant_id = a.restaurant_id and u.action = ${UNDONE_ACTION}
                              and u.after ->> 'answerId' = a.id::text)
         order by ${ANSWER_STAMP} desc limit 1`)) as unknown as Array<{ id: string; before: unknown; after: unknown; stamp: string }>;
      if (!was) throw new TRPCError({ code: 'CONFLICT', message: 'not_flagged' });
      const before = (was.before as TogetherSnapshot | null) ?? {};
      const after = (was.after as { memberIds?: string[]; paidWithInvoiceIds?: string[]; payableInvoiceId?: string; waivedTotalMismatchIds?: string[] } | null) ?? {};
      const members = after.memberIds ?? [...new Set([...(after.paidWithInvoiceIds ?? []), ...(after.payableInvoiceId ? [after.payableInvoiceId] : [])])];
      // LIFO: a LATER, still-standing answer touching any of these invoices blocks the undo.
      if (members.length > 0) {
        const [later] = (await tx.execute(sql`
          select 1 as hit from ${auditLog} a
           where a.restaurant_id = ${restaurantId} and a.action = ${CHECKED_TOGETHER_ACTION}
             and ${ANSWER_STAMP} > ${was.stamp}::timestamptz and a.id::text <> ${was.id}
             and exists (select 1 from jsonb_array_elements_text(coalesce(a.after -> 'memberIds', a.after -> 'paidWithInvoiceIds', '[]'::jsonb)) m
                          where m in (${sql.join(members.map((m) => sql`${m}`), sql`, `)}))
             and not exists (select 1 from ${auditLog} u
                              where u.restaurant_id = a.restaurant_id and u.action = ${UNDONE_ACTION}
                                and u.after ->> 'answerId' = a.id::text)
           limit 1`)) as unknown as Array<{ hit: number }>;
        if (later) throw new TRPCError({ code: 'CONFLICT', message: 'undo_later_first' });
      }
      const exact = Array.isArray(before.runs);
      const memberList = members.length > 0 ? sql.join(members.map((id) => sql`${id}::uuid`), sql`, `) : null;
      if (memberList) {
        await tx.execute(sql`select id from ${invoices} where restaurant_id = ${restaurantId} and id in (${memberList}) order by id for update`);
      }
      if (exact && memberList) {
        const payable = after.payableInvoiceId ?? null;
        const now = (await tx.execute(sql`
          select i.id::text as id, i.status from ${invoices} i where i.restaurant_id = ${restaurantId} and i.id in (${memberList})`)) as unknown as Array<{ id: string; status: string }>;
        const statusOf = new Map(now.map((r) => [r.id, r.status]));
        // the carrier was signed off or paid on the combined document: its pages can't be un-included
        if (payable && isInvoiceRematchLocked(statusOf.get(payable) ?? '')) throw new TRPCError({ code: 'CONFLICT', message: 'already_paid' });
        // a person decided on the carrier's combined run (or a claim hangs on it): that decision stays
        if (payable) {
          const [decidedOnCarrier] = (await tx.execute(sql`
            select 1 as hit from ${matchRuns} mr join ${discrepancies} d on d.match_run_id = mr.id and d.restaurant_id = mr.restaurant_id
             where mr.restaurant_id = ${restaurantId} and mr.invoice_id = ${payable}::uuid and ${A_PERSONS_DECISION}
             limit 1`)) as unknown as Array<{ hit: number }>;
          if (decidedOnCarrier) throw new TRPCError({ code: 'CONFLICT', message: 'decided' });
        }
        // a member that moved on since the answer can't come back exactly
        for (const m of before.members ?? []) {
          const expected = m.releasedFromReview ? 'matched' : m.status;
          if (expected && statusOf.get(m.id) !== expected) throw new TRPCError({ code: 'CONFLICT', message: 'decided' });
        }
      }
      // restore EXACTLY the snapshot (an earlier answer's links stay as they were)
      for (const m of before.members ?? []) {
        if (m.paidWith) {
          await tx.execute(sql`
            update ${invoices}
               set ocr_payload = jsonb_set(coalesce(ocr_payload, '{}'::jsonb), '{raw,paidWith}', jsonb_build_object('invoiceId', ${m.paidWith}::text), true),
                   updated_at = now()
             where restaurant_id = ${restaurantId} and id = ${m.id}::uuid and jsonb_typeof(ocr_payload -> 'raw') = 'object'`);
        } else {
          await tx.execute(sql`
            update ${invoices}
               set ocr_payload = jsonb_set(ocr_payload, '{raw}', (ocr_payload -> 'raw') - 'paidWith'), updated_at = now()
             where restaurant_id = ${restaurantId} and id = ${m.id}::uuid and (ocr_payload -> 'raw') ? 'paidWith'`);
        }
        // Round 12 (#2): the carrier's own-document stamp the answer cleared comes back.
        if (m.duplicateOf) {
          await tx.execute(sql`
            update ${invoices}
               set ocr_payload = jsonb_set(ocr_payload, '{raw,duplicateOf}', ${JSON.stringify(m.duplicateOf)}::jsonb, true),
                   status = case when ${Boolean(m.releasedFromReview)} then ${m.status ?? 'parsed'} else status end,
                   updated_at = now()
             where restaurant_id = ${restaurantId} and id = ${m.id}::uuid and jsonb_typeof(ocr_payload -> 'raw') = 'object'`);
        }
      }
      if (!before.members) {
        // a round-9/10 answer without a snapshot: release only what it marked
        const marked = after.paidWithInvoiceIds ?? [];
        if (marked.length > 0 && after.payableInvoiceId) {
          await tx.execute(sql`
            update ${invoices}
               set ocr_payload = jsonb_set(ocr_payload, '{raw}', (ocr_payload -> 'raw') - 'paidWith'), updated_at = now()
             where restaurant_id = ${restaurantId} and id in (${sql.join(marked.map((id) => sql`${id}::uuid`), sql`, `)})
               and ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId' = ${after.payableInvoiceId}`);
        }
      }
      // Round 11 (L1): the totals an earlier version of the answer set aside are open again.
      const waived = after.waivedTotalMismatchIds ?? [];
      if (waived.length > 0) {
        await tx.execute(sql`
          update ${discrepancies}
             set resolution_status = 'open', resolved_by = null, resolved_at = null, resolution_note = null
           where restaurant_id = ${restaurantId} and id in (${sql.join(waived.map((id) => sql`${id}::uuid`), sql`, `)})
             and resolution_status = 'rejected'`);
      }
      // Round 12 (#3): the runs come back EXACTLY — the combined run goes, each member's
      // own run and findings (statuses, PO, receipt) are re-inserted as they were.
      let rematch: string[] = members;
      if (exact && memberList) {
        await tx.execute(sql`delete from ${matchRuns} where restaurant_id = ${restaurantId} and invoice_id in (${memberList})`);
        for (const run of before.runs ?? []) {
          await tx.execute(sql`insert into ${matchRuns} select * from jsonb_populate_record(null::match_runs, ${JSON.stringify(run)}::jsonb)`);
        }
        for (const f of before.findings ?? []) {
          await tx.execute(sql`insert into ${discrepancies} select * from jsonb_populate_record(null::discrepancies, ${JSON.stringify(f)}::jsonb)`);
        }
        // only an invoice that had no run of its own goes to the matcher (its own gates decide)
        const hadRun = new Set((before.runs ?? []).map((r) => (r as { invoice_id?: string }).invoice_id));
        rematch = members.filter((id) => !hadRun.has(id));
      }
      const restore = before.flag && (PAGE_ONE_FLAGS as readonly string[]).includes(before.flag) ? before.flag : 'page_not_merged';
      await tx
        .update(ingestDocuments)
        .set({ error: restore, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, doc.invoiceId), eq(ingestDocuments.error, PAGE_CHECKED_TOGETHER)));
      await markRematchPending(tx, restaurantId, rematch);
      await tx.insert(auditLog).values({
        restaurantId,
        userId: args.userId,
        action: UNDONE_ACTION,
        entityType: 'invoice',
        entityId: doc.invoiceId,
        before: { flag: PAGE_CHECKED_TOGETHER } as never,
        after: { flag: restore, answerId: was.id, restored: before.members ?? null, restoredRuns: (before.runs ?? []).length, reopened: waived } as never,
      });
      return { invoiceId: doc.invoiceId, match: false, released: [] as string[], rematch };
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
      // Round 12 (#6): one answer / undo at a time per restaurant, before anything is read.
      await lockTogether(tx, restaurantId);
      // Round 9 (N4): ONE invoice stays payable. Round 10 (P9): the pair is the page's
      // invoice and its LIKELIEST head (raw.pageOf.invoiceId — what every compare shows).
      const [pair] = (await tx.execute(sql`
        select ocr_payload -> 'raw' -> 'pageOf' ->> 'invoiceId' as head,
               coalesce(ocr_payload -> 'raw' -> 'pageOf' -> 'invoiceIds', '[]'::jsonb) as heads
          from ${invoices} where id = ${invoiceId} and restaurant_id = ${restaurantId}`)) as unknown as Array<{ head: string | null; heads: unknown }>;
      const recorded = [pair?.head, ...(Array.isArray(pair?.heads) ? (pair!.heads as unknown[]) : [])].filter((h): h is string => typeof h === 'string');
      if (recorded.length === 0) throw new TRPCError({ code: 'CONFLICT', message: 'not_comparable' });
      // Round 11 (M6): the compare page shows EVERY recorded head; the person answers for
      // the one they compared with (default: the likeliest). Never an unrecorded invoice.
      if (args.withInvoiceId && !recorded.includes(args.withInvoiceId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'payable_required' });
      const head = args.withInvoiceId ?? recorded[0]!;
      const payable = args.payableInvoiceId;
      if (!payable) throw new TRPCError({ code: 'BAD_REQUEST', message: 'payable_required' });
      // Round 10 (P4/Q4): ONE group. Any invoice already "included in" one of the pair,
      // or that one of the pair is included in, joins it — and every member is
      // re-pointed to the carrier picked now (order-independent: exactly one payable).
      // Round 11 (L3): the members are LOCKED in id order and the group is re-read inside
      // the lock until it is stable — two answers at once never build on a stale group.
      const groupOf = async (seed: string[]): Promise<string[]> => {
        const r = (await tx.execute(sql`
          with recursive grp(id) as (
            select unnest(array[${sql.join(seed.map((id) => sql`${id}::uuid`), sql`, `)}])
            union
            select i.id from ${invoices} i, grp
             where i.restaurant_id = ${restaurantId}
               and (i.id::text = (select g.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId' from ${invoices} g where g.id = grp.id and g.restaurant_id = ${restaurantId})
                    or (i.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId') = grp.id::text))
          select id::text as id from grp order by id`)) as unknown as Array<{ id: string }>;
        return r.map((x) => x.id);
      };
      const lockAll = async (ids: string[]) => {
        await tx.execute(sql`
          select id from ${invoices}
           where restaurant_id = ${restaurantId} and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
           order by id for update`);
      };
      let memberIds = [invoiceId, head].sort();
      await lockAll(memberIds);
      for (let i = 0; i < 6; i++) {
        const next = await groupOf(memberIds);
        if (next.length === memberIds.length && next.every((id, k) => id === memberIds[k])) break;
        memberIds = next;
        await lockAll(memberIds);
      }
      const memberList = sql.join(memberIds.map((id) => sql`${id}::uuid`), sql`, `);
      const rows = (await tx.execute(sql`
        select i.id::text as id, i.status, i.supplier_id::text as supplier_id,
               i.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId' as paid_with,
               (i.ocr_payload -> 'raw' -> 'duplicateOf') is not null as dup_stamp,
               i.ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId' as dup_of,
               i.ocr_payload -> 'raw' -> 'duplicateOf' as dup_json,
               (coalesce(jsonb_array_length(case when jsonb_typeof(i.ocr_payload -> 'raw' -> 'reviewReasons') = 'array' then i.ocr_payload -> 'raw' -> 'reviewReasons' end), 0) > 0
                 or coalesce(i.ocr_payload -> 'raw' -> 'ocrFailed' = 'true'::jsonb, false)) as other_review,
               exists (select 1 from ${matchRuns} mr join ${discrepancies} d on d.match_run_id = mr.id and d.restaurant_id = mr.restaurant_id
                        where mr.invoice_id = i.id and mr.restaurant_id = i.restaurant_id
                          and d.type = 'DUPLICATE_INVOICE' and d.resolution_status in ('open', 'escalated', 'accepted')) as dup_finding
          from ${invoices} i
         where i.restaurant_id = ${restaurantId} and i.id in (${memberList})
         order by i.id`)) as unknown as Array<{
        id: string;
        status: string;
        supplier_id: string | null;
        paid_with: string | null;
        dup_stamp: boolean;
        dup_of: string | null;
        dup_json: unknown;
        other_review: boolean;
        dup_finding: boolean;
      }>;
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
      // hide as a calm "included" row while its copy is paid again). Round 11 (M2): a
      // stamp pointing at a page of THIS document (a member or a recorded head — a
      // continuation repeating its own page 1's number) is a repeat, not a duplicate.
      const inDocument = new Set([...memberIds, ...recorded]);
      const realDuplicate = (r: (typeof rows)[number]) => r.dup_finding || (r.dup_stamp && !(r.dup_of && inDocument.has(r.dup_of)));
      if (rows.some(realDuplicate)) throw new TRPCError({ code: 'CONFLICT', message: 'duplicate_on_file' });
      if (rows.some((r) => r.status === 'paid' && r.id !== payable)) throw new TRPCError({ code: 'CONFLICT', message: 'already_paid' });
      const marked = memberIds.filter((id) => id !== payable);
      const markedList = sql.join(marked.map((id) => sql`${id}::uuid`), sql`, `);
      // Round 12 (#3/#9): the carrier is matched again on the whole document and its undo
      // must be exact — so never a carrier already signed off or paid (its re-match would be
      // skipped: the included pages' lines would be matched nowhere), nor one a credit claim
      // hangs on (the re-match keeps that run).
      const carrierRow = rows.find((r) => r.id === payable)!;
      if (isInvoiceRematchLocked(carrierRow.status)) throw new TRPCError({ code: 'CONFLICT', message: 'already_paid' });
      const [claimOnCarrier] = (await tx.execute(sql`
        select 1 as hit from ${matchRuns} mr join ${discrepancies} d on d.match_run_id = mr.id and d.restaurant_id = mr.restaurant_id
         where mr.restaurant_id = ${restaurantId} and mr.invoice_id = ${payable}::uuid
           and exists (select 1 from recovery_claims c where c.discrepancy_id = d.id and c.restaurant_id = d.restaurant_id)
         limit 1`)) as unknown as Array<{ hit: number }>;
      if (claimOnCarrier) throw new TRPCError({ code: 'CONFLICT', message: 'decided' });
      // Round 11 (L1) / round 12 (#4): the included invoices' own runs go (their lines are
      // matched with the carrier's) — never one a PERSON decided on (the codebase's one rule:
      // resolved by a person, escalated, or a claim on it). An engine auto-approval is not
      // a decision and never blocks.
      const [decided] = (await tx.execute(sql`
        select 1 as hit from ${matchRuns} mr join ${discrepancies} d on d.match_run_id = mr.id and d.restaurant_id = mr.restaurant_id
         where mr.restaurant_id = ${restaurantId} and mr.invoice_id in (${markedList}) and ${A_PERSONS_DECISION}
         limit 1`)) as unknown as Array<{ hit: number }>;
      if (decided) throw new TRPCError({ code: 'CONFLICT', message: 'decided' });
      // Round 12 (#8): the carrier is the page that prints the DOCUMENT total — its printed
      // total (before VAT) covers every line of the group (±₪0.10, the engine's rounding
      // allowance). Otherwise its match would read a phantom TOTAL_MISMATCH. The person may
      // still pick a smaller carrier, but only by saying so (acceptShortTotal).
      const [covered] = (await tx.execute(sql`
        select (c.total_excl_vat is not null and c.total_excl_vat + 0.10 >= (
                  select coalesce(sum(il.line_total), 0) from invoice_lines il join ${invoices} i on i.id = il.invoice_id
                   where i.restaurant_id = ${restaurantId} and i.id in (${memberList}))) as ok
          from ${invoices} c where c.id = ${payable}::uuid and c.restaurant_id = ${restaurantId}`)) as unknown as Array<{ ok: boolean }>;
      if (!covered?.ok && !args.acceptShortTotal) throw new TRPCError({ code: 'CONFLICT', message: 'carrier_total_short' });
      // Round 11 (M3) + round 12 (#2/#3): the exact prior state of every member — its link,
      // its status, the carrier's own-document stamp, and every member's run and findings
      // as stored. The undo restores THIS, in one transaction.
      const snapRuns = (await tx.execute(sql`
        select to_jsonb(mr) as row from ${matchRuns} mr where mr.restaurant_id = ${restaurantId} and mr.invoice_id in (${memberList})`)) as unknown as Array<{ row: unknown }>;
      const snapFindings = (await tx.execute(sql`
        select to_jsonb(d) as row from ${discrepancies} d join ${matchRuns} mr on mr.id = d.match_run_id and mr.restaurant_id = d.restaurant_id
         where mr.restaurant_id = ${restaurantId} and mr.invoice_id in (${memberList})`)) as unknown as Array<{ row: unknown }>;
      // Round 12 (#2): a carrier stamped as a "duplicate" of one of this document's own pages
      // (a continuation repeating its page 1's number) is the same document: the stamp goes
      // (else its re-match waits for review forever) and comes back on undo.
      const ownStamp = Boolean(carrierRow.dup_stamp && carrierRow.dup_of && inDocument.has(carrierRow.dup_of));
      // The OCR held the carrier ('parsed') for that stamp; when it was the ONLY reason on
      // record (no other review reason, not a failed read), the person's answer settles it:
      // the carrier goes to the matcher like any read invoice. Any other reason keeps it held.
      const releaseFromReview = ownStamp && carrierRow.status === 'parsed' && !carrierRow.other_review;
      const snapshot = rows.map((r) => ({
        id: r.id,
        paidWith: r.paid_with,
        status: r.status,
        ...(r.id === payable && ownStamp ? { duplicateOf: r.dup_json } : {}),
        ...(r.id === payable && releaseFromReview ? { releasedFromReview: true } : {}),
      }));
      await tx.execute(sql`
        update ${invoices}
           set ocr_payload = coalesce(ocr_payload, '{}'::jsonb) || jsonb_build_object('raw',
                 coalesce(ocr_payload -> 'raw', '{}'::jsonb) || jsonb_build_object('paidWith', jsonb_build_object('invoiceId', ${payable}::text))),
               updated_at = now()
         where restaurant_id = ${restaurantId} and id in (${markedList})`);
      // the carrier itself is payable — never "included" in anything
      await tx.execute(sql`
        update ${invoices}
           set ocr_payload = jsonb_set(ocr_payload, '{raw}', (ocr_payload -> 'raw') - 'paidWith'), updated_at = now()
         where restaurant_id = ${restaurantId} and id = ${payable}::uuid and (ocr_payload -> 'raw') ? 'paidWith'`);
      if (ownStamp) {
        await tx.execute(sql`
          update ${invoices}
             set ocr_payload = jsonb_set(ocr_payload, '{raw}', (ocr_payload -> 'raw') - 'duplicateOf'),
                 status = case when ${releaseFromReview} then 'matched' else status end,
                 updated_at = now()
           where restaurant_id = ${restaurantId} and id = ${payable}::uuid`);
      }
      // Round 11 (L1): one document, one match — the included invoices' runs go; the carrier
      // is re-matched on the document's real lines (buildMatchInputForInvoice), so no
      // page-level TOTAL_MISMATCH ever arises. Round 12 (#9): the re-match is stamped here,
      // in the transaction, and the sweep retries it until it ran.
      await tx.execute(sql`delete from ${matchRuns} where restaurant_id = ${restaurantId} and invoice_id in (${markedList})`);
      await markRematchPending(tx, restaurantId, [payable]);
      await tx
        .update(ingestDocuments)
        .set({ error: PAGE_CHECKED_TOGETHER, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, invoiceId), eq(ingestDocuments.error, flag)));
      const [stamp] = (await tx.execute(sql`select clock_timestamp()::text as at`)) as unknown as Array<{ at: string }>;
      await tx.insert(auditLog).values({
        restaurantId,
        userId: args.userId,
        action: CHECKED_TOGETHER_ACTION,
        entityType: 'invoice',
        entityId: invoiceId,
        before: { flag, members: snapshot, runs: snapRuns.map((r) => r.row), findings: snapFindings.map((r) => r.row) } satisfies TogetherSnapshot as never,
        after: {
          flag: PAGE_CHECKED_TOGETHER,
          payableInvoiceId: payable,
          withInvoiceId: head,
          memberIds,
          paidWithInvoiceIds: marked,
          stampedAt: stamp!.at,
          ...(covered?.ok ? {} : { acceptedShortTotal: true }),
        } as never,
      });
      return { invoiceId, match: false, released: [] as string[], rematch: [payable] };
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
  // Round 11 (L1): a "checked together" group (or its undo) is matched afresh.
  for (const id of (out as { rematch?: string[] }).rematch ?? []) {
    try {
      await (deps.enqueueMatch ?? enqueueMatchInvoice)({ restaurantId, invoiceId: id, rematch: true });
    } catch (err) {
      console.warn(`[documents] failed to enqueue the re-match for invoice=${id}`, err);
    }
  }
  return { invoiceId: out.invoiceId, action };
}
