import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  desc,
  eq,
  inArray,
  or,
  purchaseOrders,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  invoices,
  restaurants,
  sql,
  suppliers,
  type Database,
} from '@restomatch/db';
import {
  generateIngestToken,
  hashIngestToken,
  ingestEmailAddress,
  ingestWhatsAppWebhookUrl,
  normalizeSender,
  tokenHint,
  type IngestKind,
} from '@restomatch/ingest';
import { appError } from '../errors';
import { featureEnabled } from '../lib/features';
import { enqueueIngestJobs, INGEST_FEATURE, messageStatus, registerIngestedDocument } from '../ingest/pipeline';
import { PAGE_FLAGS, PAGE_ONE_FLAGS } from '../documents/settle';
import { openFlagSql, openPageQuestionSql, pageOfIncludesSql } from '../documents/questions';
import { resolvePageFlag } from '../documents/resolve';
import { assertSupplierOwned } from '../tenant';
import { captureSourceRef } from '../orders/captureOrder';
import { financeProcedure, managerProcedure, router } from '../trpc';

const KindEnum = z.enum(['whatsapp', 'email']);

async function ingestFlags(db: Database, restaurantId: string): Promise<Record<IngestKind, boolean>> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return {
    whatsapp: featureEnabled(r?.settings, INGEST_FEATURE.whatsapp),
    email: featureEnabled(r?.settings, INGEST_FEATURE.email),
  };
}

const disabled = () =>
  appError('FORBIDDEN', 'FEATURE_DISABLED', 'הפיצ׳ר אינו פעיל עבור המסעדה');

/** At least one ingest channel on (or the given kind on), else FEATURE_DISABLED. */
async function requireIngest(db: Database, restaurantId: string, kind?: IngestKind) {
  const flags = await ingestFlags(db, restaurantId);
  if (kind ? !flags[kind] : !flags.whatsapp && !flags.email) throw disabled();
  return flags;
}

/** A document of THIS restaurant (else NOT_FOUND — never reveal a foreign id). */
interface QuestionRow {
  document_id: string;
  flag: string;
  page_invoice_id: string;
  page_of: string | null;
  repeats: string | null;
}
/** One open page question, from either of its invoices (round 8). */
function questionOf(r: QuestionRow, asPageOne: boolean) {
  return {
    documentId: r.document_id,
    /** 'page_belongs' when asked from page 1 (the page itself carries the real flag in `pageFlag`). */
    flag: asPageOne ? 'page_belongs' : r.flag,
    pageFlag: r.flag,
    pageInvoiceId: r.page_invoice_id,
    /** The invoice the page belongs to (page 1, settle's record) or repeats (a duplicate). */
    otherInvoiceId: r.page_of ?? r.repeats ?? null,
  };
}

async function ownDocument(db: Database, restaurantId: string, documentId: string) {
  const [doc] = await db
    .select({
      id: ingestDocuments.id,
      status: ingestDocuments.status,
      storagePath: ingestDocuments.storagePath,
      kind: ingestMessages.kind,
      sender: ingestMessages.sender,
      messageId: ingestMessages.id,
      supplierId: ingestMessages.supplierId,
    })
    .from(ingestDocuments)
    .innerJoin(ingestMessages, eq(ingestMessages.id, ingestDocuments.messageId))
    .where(and(eq(ingestDocuments.id, documentId), eq(ingestDocuments.restaurantId, restaurantId)))
    .limit(1)
    // Row lock: a concurrent approve + reject of the same document serialise.
    .for('update', { of: ingestDocuments });
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'document not found' });
  return doc;
}

async function refreshMessageStatus(db: Database, restaurantId: string, messageId: string) {
  const docs = await db
    .select({ status: ingestDocuments.status })
    .from(ingestDocuments)
    .where(and(eq(ingestDocuments.messageId, messageId), eq(ingestDocuments.restaurantId, restaurantId)));
  const status = messageStatus(docs.map((d) => d.status));
  await db
    .update(ingestMessages)
    .set({ status })
    .where(and(eq(ingestMessages.id, messageId), eq(ingestMessages.restaurantId, restaurantId)));
}

/**
 * Invoice ingestion settings + inbox (flags ingestWhatsapp / ingestEmail).
 * Reads are financeProcedure; anything that changes routing (tokens, the
 * allow-list, approving a document into OCR) is managerProcedure. Every id
 * from the client is re-checked against ctx.session.restaurantId.
 */
export const ingestRouter = router({
  overview: financeProcedure.query(async ({ ctx }) => {
    const flags = await requireIngest(ctx.db, ctx.session.restaurantId);
    const channels = await ctx.db
      .select({
        kind: ingestChannels.kind,
        tokenHint: ingestChannels.tokenHint,
        phoneNumberId: ingestChannels.phoneNumberId,
        createdAt: ingestChannels.createdAt,
      })
      .from(ingestChannels)
      .where(and(eq(ingestChannels.restaurantId, ctx.session.restaurantId), eq(ingestChannels.active, true)));
    const pending = await ctx.db
      .select({ id: ingestDocuments.id })
      .from(ingestDocuments)
      .where(
        and(eq(ingestDocuments.restaurantId, ctx.session.restaurantId), eq(ingestDocuments.status, 'needs_review')),
      );
    // G-09 (round 6): open page questions need a person too (page_separate is answered).
    // Round 7: one question per INVOICE (a merged document's rows count once), open ones only.
    const pageQuestions = (await ctx.db.execute(sql`
      select distinct d.invoice_id from ${ingestDocuments} d
       where d.restaurant_id = ${ctx.session.restaurantId} and ${openFlagSql('d')}`)) as unknown as unknown[];
    return {
      features: flags,
      emailDomain: process.env.INGEST_EMAIL_DOMAIN || null,
      channels,
      needsReview: pending.length + pageQuestions.length,
      pageQuestions: pageQuestions.length,
    };
  }),

  /** G-09 (round 6): the open page question on one invoice (null when none) — the invoice page shows it as held. */
  pageQuestionOf: financeProcedure.input(z.object({ invoiceId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    // Round 8: the whole question — the flagged page, its invoice and the invoice it
    // belongs to / repeats — so the invoice page, approvals and the pay run can
    // open it from any invoice id. (Not gated on intake: answering is not intake.)
    const own = (await ctx.db.execute(sql`
      select d.id as document_id, d.error as flag, d.invoice_id::text as page_invoice_id,
             i.ocr_payload -> 'raw' -> 'pageOf' ->> 'invoiceId' as page_of,
             coalesce(i.ocr_payload -> 'raw' -> 'pageRepeats' ->> 'invoiceId', i.ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId') as repeats
        from ${ingestDocuments} d
        join ${invoices} i on i.id = d.invoice_id and i.restaurant_id = d.restaurant_id
       where d.restaurant_id = ${rid} and d.invoice_id = ${input.invoiceId} and ${openFlagSql('d')}
       limit 1`)) as unknown as QuestionRow[];
    if (own[0]) return questionOf(own[0], false);
    // Round 7/8: page 1 of a page that probably belongs to it (raw.pageOf) waits too.
    const one = (await ctx.db.execute(sql`
      select d.id as document_id, d.error as flag, d.invoice_id::text as page_invoice_id,
             ${input.invoiceId}::text as page_of, null::text as repeats
        from ${ingestDocuments} d
        join ${invoices} i on i.id = d.invoice_id and i.restaurant_id = d.restaurant_id
       where d.restaurant_id = ${rid} and ${openFlagSql('d')} and d.error in (${sql.join(PAGE_ONE_FLAGS.map((f) => sql`${f}`), sql`, `)})
         and ${pageOfIncludesSql('i', sql`${input.invoiceId}`)}
       limit 1`)) as unknown as QuestionRow[];
    return one[0] ? questionOf(one[0], true) : null;
  }),

  /** New secret for a channel; the old one stops working at once. Plaintext returned ONCE. */
  rotateChannel: managerProcedure
    .input(z.object({ kind: KindEnum, phoneNumberId: z.string().regex(/^\d{5,32}$/).optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireIngest(ctx.db, ctx.session.restaurantId, input.kind);
      const token = generateIngestToken(input.kind);
      const previous = await ctx.db
        .update(ingestChannels)
        .set({ active: false, revokedAt: new Date() })
        .where(
          and(
            eq(ingestChannels.restaurantId, ctx.session.restaurantId),
            eq(ingestChannels.kind, input.kind),
            eq(ingestChannels.active, true),
          ),
        )
        .returning({ phoneNumberId: ingestChannels.phoneNumberId });
      await ctx.db.insert(ingestChannels).values({
        restaurantId: ctx.session.restaurantId,
        kind: input.kind,
        tokenHash: hashIngestToken(token),
        tokenHint: tokenHint(token),
        // A rotation replaces the secret, not the WhatsApp number: keep the
        // binding unless a new one is given (an unbound channel rejects every
        // message in production).
        phoneNumberId: input.phoneNumberId ?? previous[0]?.phoneNumberId ?? null,
        createdBy: ctx.session.userId,
      });
      return {
        kind: input.kind,
        token,
        address: input.kind === 'email' ? ingestEmailAddress(token) : null,
        webhookUrl: input.kind === 'whatsapp' ? ingestWhatsAppWebhookUrl(token) : null,
      };
    }),

  revokeChannel: managerProcedure.input(z.object({ kind: KindEnum })).mutation(async ({ ctx, input }) => {
    await requireIngest(ctx.db, ctx.session.restaurantId, input.kind);
    const rows = await ctx.db
      .update(ingestChannels)
      .set({ active: false, revokedAt: new Date() })
      .where(
        and(
          eq(ingestChannels.restaurantId, ctx.session.restaurantId),
          eq(ingestChannels.kind, input.kind),
          eq(ingestChannels.active, true),
        ),
      )
      .returning({ id: ingestChannels.id });
    return { revoked: rows.length };
  }),

  senders: financeProcedure.query(async ({ ctx }) => {
    await requireIngest(ctx.db, ctx.session.restaurantId);
    return ctx.db
      .select({
        id: ingestSenders.id,
        kind: ingestSenders.kind,
        sender: ingestSenders.sender,
        label: ingestSenders.label,
        supplierId: ingestSenders.supplierId,
        supplierName: suppliers.name,
        createdAt: ingestSenders.createdAt,
      })
      .from(ingestSenders)
      .leftJoin(
        suppliers,
        and(eq(suppliers.id, ingestSenders.supplierId), eq(suppliers.restaurantId, ctx.session.restaurantId)),
      )
      .where(eq(ingestSenders.restaurantId, ctx.session.restaurantId))
      .orderBy(desc(ingestSenders.createdAt));
  }),

  addSender: managerProcedure
    .input(
      z.object({
        kind: KindEnum,
        sender: z.string().min(3).max(320),
        supplierId: z.string().uuid().optional(),
        label: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireIngest(ctx.db, ctx.session.restaurantId, input.kind);
      const sender = normalizeSender(input.kind, input.sender);
      if (!sender) throw appError('BAD_REQUEST', 'input.invalid', 'כתובת / מספר לא תקינים');
      if (input.supplierId) await assertSupplierOwned(ctx.db, input.supplierId, ctx.session.restaurantId);
      const [row] = await ctx.db
        .insert(ingestSenders)
        .values({
          restaurantId: ctx.session.restaurantId,
          kind: input.kind,
          sender,
          supplierId: input.supplierId ?? null,
          label: input.label ?? null,
          createdBy: ctx.session.userId,
        })
        .onConflictDoUpdate({
          target: [ingestSenders.restaurantId, ingestSenders.kind, ingestSenders.sender],
          set: { supplierId: input.supplierId ?? null, label: input.label ?? null },
        })
        .returning({ id: ingestSenders.id, sender: ingestSenders.sender });
      return row!;
    }),

  removeSender: managerProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await requireIngest(ctx.db, ctx.session.restaurantId);
    const rows = await ctx.db
      .delete(ingestSenders)
      .where(and(eq(ingestSenders.id, input.id), eq(ingestSenders.restaurantId, ctx.session.restaurantId)))
      .returning({ id: ingestSenders.id });
    if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'sender not found' });
    return { removed: true };
  }),

  /** Received messages with their documents, newest first. */
  inbox: financeProcedure
    .input(
      z
        .object({ filter: z.enum(['all', 'needs_review', 'errors']).default('all'), limit: z.number().int().min(1).max(100).default(50) })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      await requireIngest(ctx.db, ctx.session.restaurantId);
      const rid = ctx.session.restaurantId;
      const statusFilter =
        input.filter === 'needs_review'
          ? inArray(ingestMessages.status, ['needs_review'])
          : input.filter === 'errors'
            ? // G-09: a message with a flagged page (the inbox's one question) is an error too.
              or(
                inArray(ingestMessages.status, ['failed', 'rejected']),
                sql`exists (select 1 from ${ingestDocuments} d where d.message_id = ${ingestMessages.id}
                      and d.restaurant_id = ${ingestMessages.restaurantId}
                      and d.error in (${sql.join(PAGE_FLAGS.map((f) => sql`${f}`), sql`, `)}))`,
              )
            : undefined;
      const messages = await ctx.db
        .select({
          id: ingestMessages.id,
          kind: ingestMessages.kind,
          sender: ingestMessages.sender,
          senderAllowed: ingestMessages.senderAllowed,
          subject: ingestMessages.subject,
          status: ingestMessages.status,
          error: ingestMessages.error,
          receivedAt: ingestMessages.receivedAt,
          supplierName: suppliers.name,
        })
        .from(ingestMessages)
        .leftJoin(suppliers, and(eq(suppliers.id, ingestMessages.supplierId), eq(suppliers.restaurantId, rid)))
        .where(statusFilter ? and(eq(ingestMessages.restaurantId, rid), statusFilter) : eq(ingestMessages.restaurantId, rid))
        .orderBy(desc(ingestMessages.receivedAt))
        .limit(input.limit);
      const ids = messages.map((m) => m.id);
      const docs = ids.length
        ? await ctx.db
            .select({
              id: ingestDocuments.id,
              messageId: ingestDocuments.messageId,
              filename: ingestDocuments.filename,
              mimeType: ingestDocuments.mimeType,
              sizeBytes: ingestDocuments.sizeBytes,
              status: ingestDocuments.status,
              error: ingestDocuments.error,
              invoiceId: ingestDocuments.invoiceId,
              storagePath: ingestDocuments.storagePath,
              // Round 7: does this page still ask something (an unreadable page whose invoice got lines does not)?
              questionOpen: sql<boolean>`${openFlagSql('"ingest_documents"')}`,
              // G-09: the invoice a page_duplicate repeats, when the OCR recorded it.
              repeatsInvoiceId: sql<string | null>`(select coalesce(i.ocr_payload -> 'raw' -> 'pageRepeats' ->> 'invoiceId', i.ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId')
                from ${invoices} i where i.id = ${ingestDocuments.invoiceId} and i.restaurant_id = ${ingestDocuments.restaurantId})`,
              // G-09 (round 8): the chain's page 1 settle recorded for this page (raw.pageOf) — "בדקו את שתיהן יחד".
              relatedInvoiceId: sql<string | null>`(select i.ocr_payload -> 'raw' -> 'pageOf' ->> 'invoiceId'
                from ${invoices} i where i.id = "ingest_documents"."invoice_id" and i.restaurant_id = "ingest_documents"."restaurant_id")`,
              // G-09 (round 6): what is at stake on a page question — the page invoice's ₪ and supplier.
              invoiceTotal: sql<string | null>`(select coalesce(i.total_incl_vat, i.total_excl_vat)::text
                from ${invoices} i where i.id = ${ingestDocuments.invoiceId} and i.restaurant_id = ${ingestDocuments.restaurantId})`,
              invoiceSupplier: sql<string | null>`(select coalesce(s.name, i.ocr_payload -> 'raw' -> 'reconciled' -> 'supplier' ->> 'name')
                from ${invoices} i left join ${suppliers} s on s.id = i.supplier_id and s.restaurant_id = i.restaurant_id
                where i.id = "ingest_documents"."invoice_id" and i.restaurant_id = "ingest_documents"."restaurant_id")`,
            })
            .from(ingestDocuments)
            .where(and(eq(ingestDocuments.restaurantId, rid), inArray(ingestDocuments.messageId, ids)))
        : [];
      // orderCapture: a forwarded order (WhatsApp text, no files) links to the
      // draft PO captured from it (same idempotency key as captureOrderDraft).
      const refOf = new Map<string, string>();
      for (const m of messages) {
        if (m.kind === 'whatsapp' && m.subject && !docs.some((d) => d.messageId === m.id)) {
          refOf.set(m.id, captureSourceRef(m.subject));
        }
      }
      const orderPos = refOf.size
        ? await ctx.db
            .select({ id: purchaseOrders.id, sourceRef: purchaseOrders.sourceRef, status: purchaseOrders.status })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.restaurantId, rid), inArray(purchaseOrders.sourceRef, [...refOf.values()])))
        : [];
      // Never expose storage paths — only whether a file is stored.
      return messages.map((m) => ({
        ...m,
        order: refOf.has(m.id)
          ? (() => {
              const po = orderPos.find((p) => p.sourceRef === refOf.get(m.id));
              return po ? { poId: po.id, poStatus: po.status } : m.error === 'order_needs_supplier' ? { poId: null, poStatus: null } : null;
            })()
          : null,
        documents: docs
          .filter((d) => d.messageId === m.id)
          .map(({ storagePath, ...d }) => ({ ...d, stored: storagePath !== null })),
      }));
    }),

  /** Approve a document from an unknown sender: register it → OCR. Optionally allow-list the sender. */
  approveDocument: managerProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        supplierId: z.string().uuid().optional(),
        allowSender: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const doc = await ownDocument(ctx.db, rid, input.documentId);
      await requireIngest(ctx.db, rid, doc.kind);
      if (input.supplierId) await assertSupplierOwned(ctx.db, input.supplierId, rid);
      if (doc.status !== 'needs_review') throw appError('CONFLICT', 'input.invalid', 'המסמך כבר טופל');
      // Over-quota documents are metadata only — nothing to read; ask the sender to resend.
      if (!doc.storagePath) throw appError('BAD_REQUEST', 'input.invalid', 'אין קובץ שמור למסמך זה');
      const supplierId = input.supplierId ?? doc.supplierId ?? null;
      // G-09 (round 8): each page is approved on its own, with its own supplier
      // (never registered or stamped unseen). With multi-page on, a page approved
      // first waits in settle for a same-sender page still in review (pendingReview).
      const reg = await registerIngestedDocument(ctx.db, {
        restaurantId: rid,
        documentId: doc.id,
        storagePath: doc.storagePath,
        kind: doc.kind,
        supplierId,
        userId: ctx.session.userId,
      });
      if (input.allowSender) {
        await ctx.db
          .insert(ingestSenders)
          .values({ restaurantId: rid, kind: doc.kind, sender: doc.sender, supplierId, createdBy: ctx.session.userId })
          .onConflictDoNothing();
      }
      await refreshMessageStatus(ctx.db, rid, doc.messageId);
      // Same as receiving.registerInvoice: enqueued from inside the member tx.
      await enqueueIngestJobs(reg.job ? [reg.job] : []);
      return { invoiceId: reg.invoiceId, invoiceIds: [reg.invoiceId] };
    }),

  /**
   * G-09: the one action on a flagged page (owner/manager). `separate` — it is
   * its own invoice (sticky; audited; matched); `delete_duplicate` — retire a
   * re-shot copy behind every refusal guard. Foreign ids → NOT_FOUND.
   */
  resolvePageFlag: managerProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        action: z.enum(['separate', 'delete_duplicate', 'close_unreadable', 'checked_together']),
        /** Round 9 (N4): checked_together — the invoice that carries the total and is paid. */
        payableInvoiceId: z.string().uuid().optional(),
        withInvoiceId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const doc = await ownDocument(ctx.db, rid, input.documentId);
      // Round 8 (M9): answering a page question is not intake — it works with the
      // channel switched off (a rollback must never strand a hold).
      const res = await resolvePageFlag(ctx.db, {
        restaurantId: rid,
        documentId: doc.id,
        action: input.action,
        userId: ctx.session.userId,
        ...(input.payableInvoiceId ? { payableInvoiceId: input.payableInvoiceId } : {}),
        ...(input.withInvoiceId ? { withInvoiceId: input.withInvoiceId } : {}),
      });
      await refreshMessageStatus(ctx.db, rid, doc.messageId);
      return res;
    }),

  rejectDocument: managerProcedure.input(z.object({ documentId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    const doc = await ownDocument(ctx.db, rid, input.documentId);
    await requireIngest(ctx.db, rid, doc.kind);
    if (doc.status !== 'needs_review') throw appError('CONFLICT', 'input.invalid', 'המסמך כבר טופל');
    await ctx.db
      .update(ingestDocuments)
      .set({ status: 'rejected', error: 'rejected_by_user', updatedAt: new Date() })
      .where(and(eq(ingestDocuments.id, doc.id), eq(ingestDocuments.restaurantId, rid)));
    await refreshMessageStatus(ctx.db, rid, doc.messageId);
    return { rejected: true };
  }),
});
