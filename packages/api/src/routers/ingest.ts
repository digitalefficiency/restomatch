import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  desc,
  eq,
  inArray,
  purchaseOrders,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  restaurants,
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
import { assertSupplierOwned } from '../tenant';
import { captureSourceRef } from '../orders/captureOrder';
import { can, financeProcedure, managerProcedure, router } from '../trpc';
import { localScanStorageEnabled, localScanUrl } from '../lib/localScanStorage';
import { getServiceStorageClient } from '../lib/supabaseStorage';
import { INVOICE_SCANS_BUCKET } from '../lib/scanUrls';

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

/** Preview URLs live at most a minute (W2-02 §7): signed per request, never stored. */
const PREVIEW_TTL_SEC = 60;

async function signPreview(restaurantId: string, storagePath: string): Promise<string | null> {
  if (!restaurantId || !storagePath.startsWith(`${restaurantId}/`) || storagePath.includes('..') || storagePath.includes('\\')) {
    return null;
  }
  const storage = getServiceStorageClient();
  if (!storage) {
    if (!localScanStorageEnabled()) return null;
    return localScanUrl(storagePath.slice(restaurantId.length + 1).replace(/\.[a-z0-9]+$/i, ''));
  }
  const { data } = await storage.storage.from(INVOICE_SCANS_BUCKET).createSignedUrl(storagePath, PREVIEW_TTL_SEC);
  return data?.signedUrl ?? null;
}

/** Register one reviewed document (approve → OCR). Shared by approveDocument and bulkApprove. */
async function approveOne(
  db: Database,
  rid: string,
  userId: string,
  input: { documentId: string; supplierId?: string; allowSender: boolean },
) {
  const doc = await ownDocument(db, rid, input.documentId);
  await requireIngest(db, rid, doc.kind);
  if (input.supplierId) await assertSupplierOwned(db, input.supplierId, rid);
  if (doc.status !== 'needs_review') throw appError('CONFLICT', 'input.invalid', 'המסמך כבר טופל');
  // Over-quota documents are metadata only — nothing to read; ask the sender to resend.
  if (!doc.storagePath) throw appError('BAD_REQUEST', 'input.invalid', 'אין קובץ שמור למסמך זה');
  const supplierId = input.supplierId ?? doc.supplierId ?? null;
  const reg = await registerIngestedDocument(db, {
    restaurantId: rid,
    documentId: doc.id,
    storagePath: doc.storagePath,
    kind: doc.kind,
    supplierId,
    userId,
  });
  if (input.allowSender) {
    await db
      .insert(ingestSenders)
      .values({ restaurantId: rid, kind: doc.kind, sender: doc.sender, supplierId, createdBy: userId })
      .onConflictDoNothing();
  }
  await refreshMessageStatus(db, rid, doc.messageId);
  return reg;
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
    return {
      features: flags,
      emailDomain: process.env.INGEST_EMAIL_DOMAIN || null,
      channels,
      needsReview: pending.length,
    };
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
            ? inArray(ingestMessages.status, ['failed', 'rejected'])
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
  approveDocument: can('intake.approve', financeProcedure)
    .input(
      z.object({
        documentId: z.string().uuid(),
        supplierId: z.string().uuid().optional(),
        allowSender: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const out = await approveOne(ctx.db, ctx.session.restaurantId, ctx.session.userId, input);
      await enqueueIngestJobs(out.job ? [out.job] : []);
      return { invoiceId: out.invoiceId };
    }),

  /**
   * W2-02 bulk "פענחו N": send N reviewed documents to OCR. Not a payment
   * approval (no ₪ moves), so no bulk ₪ cap; each id is tenant-checked and the
   * whole batch fails on a foreign id before anything is enqueued.
   */
  bulkApprove: can('intake.approve', financeProcedure)
    .input(z.object({ documentIds: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const jobs = [];
      const invoiceIds: string[] = [];
      for (const documentId of [...new Set(input.documentIds)]) {
        const out = await approveOne(ctx.db, ctx.session.restaurantId, ctx.session.userId, { documentId, allowSender: false });
        if (out.job) jobs.push(out.job);
        invoiceIds.push(out.invoiceId);
      }
      await enqueueIngestJobs(jobs);
      return { invoiceIds };
    }),

  /**
   * W2-02 intake preview: a ≤60 s URL for the stored file of one of the
   * caller's documents. The path is read from the row and checked against the
   * tenant prefix before signing; nothing is persisted. Foreign id → NOT_FOUND.
   */
  documentPreview: can('intake.approve', financeProcedure)
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const [doc] = await ctx.db
        .select({ storagePath: ingestDocuments.storagePath, mimeType: ingestDocuments.mimeType })
        .from(ingestDocuments)
        .where(and(eq(ingestDocuments.id, input.documentId), eq(ingestDocuments.restaurantId, rid)))
        .limit(1);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'document not found' });
      const url = doc.storagePath ? await signPreview(rid, doc.storagePath) : null;
      return {
        url,
        mimeType: doc.mimeType,
        kind: doc.mimeType === 'application/pdf' ? ('pdf' as const) : doc.mimeType?.startsWith('image/') ? ('image' as const) : ('other' as const),
        expiresInSec: url ? PREVIEW_TTL_SEC : null,
      };
    }),

  rejectDocument: can('intake.approve', financeProcedure).input(z.object({ documentId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
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
