import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import {
  and,
  eq,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  inArray,
  invoices,
  restaurants,
  sql,
  suppliers,
  withRestaurant,
  type Database,
  type IngestDocumentStatus,
  type IngestMessageStatus,
} from '@restomatch/db';
import {
  AttachmentTooLargeError,
  INGEST_LIMITS,
  normalizeSender,
  reviewBytesPerDay,
  sniffMime,
  type IngestKind,
  type IngestProvider,
  type InboundMessage,
} from '@restomatch/ingest';
import { enqueue, enqueueOcrInvoice, OCR_INVOICE_QUEUE } from '@restomatch/queue';
import { ORDER_TEXT_MAX_CHARS, orderTextParserFromEnv } from '@restomatch/ocr';
import { captureOrderDraft } from '../orders/captureOrder';
import { featureEnabled } from '../lib/features';
import { createIntakeInvoice, upsertInvoiceScan } from '../documents/intake';
import { objectRefMatchValues, signObjectRef, storedImageValue, tenantPath } from '../documents/objectRef';
import { groupMinutes, INLINE_IMAGE_MAX_BYTES, isPageMime, mimeOfRef, ocrDedupeKey, reviewGroupOf } from './grouping';
import { storeIngestedFile } from './store';

/** Feature key per channel kind (MASTER-PLAN §3). */
export const INGEST_FEATURE: Record<IngestKind, 'ingestWhatsapp' | 'ingestEmail'> = {
  whatsapp: 'ingestWhatsapp',
  email: 'ingestEmail',
};

export interface ResolvedChannel {
  channelId: string;
  restaurantId: string;
  kind: IngestKind;
  phoneNumberId: string | null;
}

/**
 * Token hash → channel through the SECURITY DEFINER resolver (works on the
 * RLS-enforced app role before any restaurant GUC exists). Unknown or revoked
 * tokens resolve to null.
 */
export async function resolveIngestChannel(db: Database, tokenHash: string): Promise<ResolvedChannel | null> {
  const rows = (await db.execute(
    sql`select channel_id, restaurant_id, kind, phone_number_id from app.ingest_resolve_channel(${tokenHash})`,
  )) as unknown as Array<{ channel_id: string; restaurant_id: string; kind: string; phone_number_id: string | null }>;
  const row = rows[0];
  if (!row || (row.kind !== 'whatsapp' && row.kind !== 'email')) return null;
  return {
    channelId: row.channel_id,
    restaurantId: row.restaurant_id,
    kind: row.kind,
    phoneNumberId: row.phone_number_id,
  };
}

export interface OcrJobToEnqueue {
  restaurantId: string;
  invoiceId: string;
  supplierId: string | null;
  imageUrl: string;
  /** G-09: at most one OCR job per key (`ocr:<invoiceId>:<pageCount>`). */
  dedupeKey?: string;
}

export type InboundOutcome =
  | { status: 'disabled' }
  | { status: 'duplicate'; messageId: string | null }
  | { status: IngestMessageStatus; messageId: string; documents: Array<{ id: string; status: IngestDocumentStatus }> };

/**
 * Register one stored document as an invoice — the same row the receiving
 * wizard creates (G-05 machine `initial`), deduped per (restaurant, OBJECT)
 * under the same advisory lock key shape as receiving.registerInvoice. Runs
 * inside the caller's restaurant-scoped transaction; returns the OCR job to
 * enqueue AFTER commit.
 *
 * G-09 (additive): the dedupe key is the object ref (`toObjectRef`), not a
 * signed URL; `extraDocumentIds` are further pages of the same document (all
 * rows point at the one invoice); `pageCount` lands in `invoice_scans`.
 */
export async function registerIngestedDocument(
  tx: Database,
  args: {
    restaurantId: string;
    documentId: string;
    storagePath: string;
    kind: IngestKind;
    supplierId: string | null;
    userId: string | null;
    extraDocumentIds?: string[];
    pageCount?: number | null;
  },
): Promise<{ invoiceId: string; job: OcrJobToEnqueue | null }> {
  const ref = tenantPath(args.restaurantId, args.storagePath);
  if (!ref) throw new Error('could not sign the stored document');
  const imageUrl = await signObjectRef(args.restaurantId, ref);
  if (!imageUrl) throw new Error('could not sign the stored document');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`register-invoice:${args.restaurantId}:${ref}`}))`);
  const matchValues = objectRefMatchValues(args.restaurantId, ref);
  const [existing] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, args.restaurantId),
        sql`split_part(${invoices.rawImageUrl}, '?', 1) in (${sql.join(
          matchValues.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      ),
    )
    .limit(1);
  let invoiceId: string;
  let job: OcrJobToEnqueue | null = null;
  const pageCount = args.pageCount ?? (isPageMime(mimeOfRef(ref)) ? 1 : null);
  if (existing) {
    invoiceId = existing.id;
  } else {
    invoiceId = await createIntakeInvoice(tx, {
      restaurantId: args.restaurantId,
      supplierId: args.supplierId,
      rawImageUrl: storedImageValue(args.restaurantId, ref),
      source: args.kind === 'whatsapp' ? 'whatsapp' : 'email',
      createdBy: args.userId,
    });
    await upsertInvoiceScan(tx, {
      restaurantId: args.restaurantId,
      invoiceId,
      storagePath: ref,
      mimeType: mimeOfRef(ref),
      pageCount,
    });
    job = {
      restaurantId: args.restaurantId,
      invoiceId,
      supplierId: args.supplierId,
      imageUrl,
      dedupeKey: ocrDedupeKey(invoiceId, pageCount ?? 1),
    };
  }
  // Only a document still awaiting review can be registered (approve/reject race).
  const ids = [args.documentId, ...(args.extraDocumentIds ?? [])];
  const moved = await tx
    .update(ingestDocuments)
    .set({ status: 'registered', invoiceId, error: null, updatedAt: new Date() })
    .where(
      and(
        inArray(ingestDocuments.id, ids),
        eq(ingestDocuments.restaurantId, args.restaurantId),
        eq(ingestDocuments.status, 'needs_review'),
      ),
    )
    .returning({ id: ingestDocuments.id });
  if (!moved.some((m) => m.id === args.documentId)) throw new Error('document is no longer awaiting review');
  return { invoiceId, job };
}

/**
 * G-09: approve a review document TOGETHER with its review group (the other
 * needs_review images of the same sender within N minutes). Each page becomes
 * its own invoice and is OCR'd alone; settleDocumentPages merges them after
 * OCR when their supplier and invoice number agree. A non-image document
 * registers alone, exactly like registerIngestedDocument.
 */
export async function registerReviewGroup(
  tx: Database,
  args: { restaurantId: string; documentId: string; kind: IngestKind; supplierId: string | null; userId: string | null },
): Promise<{ invoiceIds: string[]; jobs: OcrJobToEnqueue[]; documentIds: string[] }> {
  const [restaurant] = await tx
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, args.restaurantId))
    .limit(1);
  const group = await reviewGroupOf(tx, args.restaurantId, args.documentId, groupMinutes(restaurant?.settings));
  if (group.length === 0) throw new Error('document is no longer awaiting review');
  const invoiceIds: string[] = [];
  const jobs: OcrJobToEnqueue[] = [];
  for (const page of group) {
    const reg = await registerIngestedDocument(tx, {
      restaurantId: args.restaurantId,
      documentId: page.id,
      storagePath: page.storagePath,
      kind: args.kind,
      supplierId: args.supplierId,
      userId: args.userId,
      pageCount: isPageMime(page.mimeType) ? 1 : null,
    });
    invoiceIds.push(reg.invoiceId);
    if (reg.job) jobs.push(reg.job);
  }
  return { invoiceIds, jobs, documentIds: group.map((g) => g.id) };
}

/** Enqueue OCR jobs after the transaction committed. Never throws. */
export async function enqueueIngestJobs(jobs: OcrJobToEnqueue[]): Promise<void> {
  for (const job of jobs) {
    try {
      const { dedupeKey, ...payload } = job;
      if (dedupeKey) await enqueue(OCR_INVOICE_QUEUE, payload, { dedupeKey });
      else await enqueueOcrInvoice(payload);
    } catch (err) {
      console.error(`[ingest] failed to enqueue ocr-invoice for invoice=${job.invoiceId}`, err);
    }
  }
}

async function attachmentBytes(
  provider: IngestProvider,
  message: InboundMessage,
  a: InboundMessage['attachments'][number],
): Promise<Uint8Array> {
  if (a.declaredSize !== null && a.declaredSize > INGEST_LIMITS.attachmentBytes) throw new AttachmentTooLargeError();
  if (a.contentBase64 !== undefined) {
    // base64 inflates 4/3 — refuse before decoding a huge string.
    if (a.contentBase64.length > Math.ceil((INGEST_LIMITS.attachmentBytes * 4) / 3) + 4) {
      throw new AttachmentTooLargeError();
    }
    const bytes = Buffer.from(a.contentBase64, 'base64');
    if (bytes.byteLength > INGEST_LIMITS.attachmentBytes) throw new AttachmentTooLargeError();
    return bytes;
  }
  if (!a.providerRef) throw new Error('attachment has no content');
  const fetched = await provider.fetchAttachment({ providerMessageId: message.providerMessageId, ref: a.providerRef });
  if (fetched.bytes.byteLength > INGEST_LIMITS.attachmentBytes) throw new AttachmentTooLargeError();
  return fetched.bytes;
}

export function messageStatus(statuses: IngestDocumentStatus[]): IngestMessageStatus {
  if (statuses.length === 0) return 'empty';
  if (statuses.some((s) => s === 'needs_review')) return 'needs_review';
  if (statuses.some((s) => s === 'registered' || s === 'duplicate')) return 'accepted';
  if (statuses.every((s) => s === 'rejected' || s === 'skipped')) return 'rejected';
  return 'failed';
}

/**
 * The pipeline for ONE inbound message on an already-resolved channel. Every
 * read and write runs under the channel's restaurant GUC (RLS), so even a bug
 * here cannot touch another tenant. Unknown senders' documents are stored but
 * NOT registered (no OCR spend) — they wait in the inbox for review.
 */
export async function processInboundMessage(
  db: Database,
  channel: ResolvedChannel,
  message: InboundMessage,
  provider: IngestProvider,
  opts: { now?: Date } = {},
): Promise<InboundOutcome> {
  const jobs: OcrJobToEnqueue[] = [];
  const now = opts.now ?? new Date();
  const outcome = await withRestaurant(db, channel.restaurantId, async (tx): Promise<InboundOutcome> => {
    const [restaurant] = await tx
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, channel.restaurantId))
      .limit(1);
    if (!restaurant || !featureEnabled(restaurant.settings, INGEST_FEATURE[channel.kind])) {
      return { status: 'disabled' };
    }

    const sender = normalizeSender(channel.kind, message.sender) ?? message.sender.slice(0, 320);
    const [allow] = await tx
      .select({ supplierId: ingestSenders.supplierId })
      .from(ingestSenders)
      .where(
        and(
          eq(ingestSenders.restaurantId, channel.restaurantId),
          eq(ingestSenders.kind, channel.kind),
          eq(ingestSenders.sender, sender),
        ),
      )
      .limit(1);
    // A supplier link must be this tenant's (FK is global) — re-check.
    let supplierId: string | null = null;
    if (allow?.supplierId) {
      const [s] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, allow.supplierId), eq(suppliers.restaurantId, channel.restaurantId)))
        .limit(1);
      supplierId = s?.id ?? null;
    }
    const senderAllowed = Boolean(allow);

    // Replay guard: the unique (restaurant, kind, provider message id) makes a
    // re-delivered message a no-op.
    const [msg] = await tx
      .insert(ingestMessages)
      .values({
        restaurantId: channel.restaurantId,
        channelId: channel.channelId,
        kind: channel.kind,
        provider: provider.name,
        providerMessageId: message.providerMessageId.slice(0, 256),
        sender,
        senderAllowed,
        supplierId,
        subject: message.subject?.slice(0, 500) ?? null,
        status: 'empty',
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: ingestMessages.id });
    if (!msg) return { status: 'duplicate', messageId: null };

    const docs: Array<{ id: string; status: IngestDocumentStatus }> = [];
    for (const [i, a] of message.attachments.entries()) {
      const base = {
        restaurantId: channel.restaurantId,
        messageId: msg.id,
        filename: a.filename?.slice(0, 255) ?? null,
        // Page order = insertion order, also inside one transaction.
        createdAt: sql`clock_timestamp()`,
      };
      if (i >= INGEST_LIMITS.attachmentsPerMessage) {
        const [d] = await tx
          .insert(ingestDocuments)
          .values({ ...base, status: 'skipped', error: 'too_many_attachments' })
          .returning({ id: ingestDocuments.id });
        docs.push({ id: d!.id, status: 'skipped' });
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await attachmentBytes(provider, message, a);
      } catch (err) {
        const tooLarge = err instanceof AttachmentTooLargeError;
        const status: IngestDocumentStatus = tooLarge ? 'rejected' : 'failed';
        const [d] = await tx
          .insert(ingestDocuments)
          .values({ ...base, status, error: tooLarge ? 'too_large' : 'fetch_failed' })
          .returning({ id: ingestDocuments.id });
        docs.push({ id: d!.id, status });
        continue;
      }
      const mime = sniffMime(bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!mime) {
        const [d] = await tx
          .insert(ingestDocuments)
          .values({ ...base, sizeBytes: bytes.byteLength, sha256, status: 'rejected', error: 'unsupported_type' })
          .returning({ id: ingestDocuments.id });
        docs.push({ id: d!.id, status: 'rejected' });
        continue;
      }
      // An e-mail signature logo / inline image is not a page.
      if (channel.kind === 'email' && mime !== 'application/pdf' && bytes.byteLength < INLINE_IMAGE_MAX_BYTES) {
        const [d] = await tx
          .insert(ingestDocuments)
          .values({ ...base, mimeType: mime, sizeBytes: bytes.byteLength, sha256, status: 'skipped', error: 'inline_image' })
          .returning({ id: ingestDocuments.id });
        docs.push({ id: d!.id, status: 'skipped' });
        continue;
      }
      // Same bytes already registered for this restaurant → link, don't re-OCR.
      const [dup] = await tx
        .select({ invoiceId: ingestDocuments.invoiceId })
        .from(ingestDocuments)
        .where(
          and(
            eq(ingestDocuments.restaurantId, channel.restaurantId),
            eq(ingestDocuments.sha256, sha256),
            eq(ingestDocuments.status, 'registered'),
          ),
        )
        .limit(1);
      if (dup?.invoiceId) {
        const [d] = await tx
          .insert(ingestDocuments)
          .values({ ...base, mimeType: mime, sizeBytes: bytes.byteLength, sha256, invoiceId: dup.invoiceId, status: 'duplicate' })
          .returning({ id: ingestDocuments.id });
        docs.push({ id: d!.id, status: 'duplicate' });
        continue;
      }
      // Auto-register (→ OCR) only an allow-listed AND authenticated sender:
      // WhatsApp numbers are authenticated by Meta; an e-mail From needs a passing
      // SPF/DKIM/DMARC verdict from our inbound provider. Otherwise the allow-list
      // only SUGGESTS the supplier and the document waits for a manager.
      const autoRegister = senderAllowed && message.authVerdict === 'pass';
      // Quota only for UNKNOWN senders: otherwise anyone who knows the inbound
      // address could exhaust it and starve a real (allow-listed, but not yet
      // authenticated) supplier's invoices for the day.
      if (!senderAllowed) {
        // Storage quota for review documents (stored without OCR) per channel per day.
        const rows = (await tx.execute(sql`
          select coalesce(sum(d.size_bytes), 0)::bigint as bytes
          from ingest_documents d
          join ingest_messages m on m.id = d.message_id and m.restaurant_id = d.restaurant_id
          where m.channel_id = ${channel.channelId}
            and d.restaurant_id = ${channel.restaurantId}
            and d.storage_path is not null
            and d.invoice_id is null
            and not m.sender_allowed
            and d.created_at > now() - interval '1 day'
        `)) as unknown as Array<{ bytes: string | number }>;
        if (Number(rows[0]?.bytes ?? 0) + bytes.byteLength > reviewBytesPerDay()) {
          // Over quota: keep the metadata for review, but store no blob.
          const [d] = await tx
            .insert(ingestDocuments)
            .values({ ...base, mimeType: mime, sizeBytes: bytes.byteLength, sha256, status: 'needs_review', error: 'quota_exceeded' })
            .returning({ id: ingestDocuments.id });
          docs.push({ id: d!.id, status: 'needs_review' });
          continue;
        }
      }
      let docId: string | null = null;
      try {
        const stored = await storeIngestedFile({ restaurantId: channel.restaurantId, sha256, mimeType: mime, bytes });
        const [d] = await tx
          .insert(ingestDocuments)
          .values({
            ...base,
            mimeType: mime,
            sizeBytes: bytes.byteLength,
            sha256,
            storagePath: stored.storagePath,
            status: 'needs_review',
          })
          .returning({ id: ingestDocuments.id });
        docId = d!.id;
        if (autoRegister) {
          // G-09: every page is its own invoice and is OCR'd alone; pages of one
          // document are merged AFTER OCR, only when their supplier and invoice
          // number agree (documents/settle.ts).
          const reg = await registerIngestedDocument(tx, {
            restaurantId: channel.restaurantId,
            documentId: docId,
            storagePath: stored.storagePath,
            kind: channel.kind,
            supplierId,
            userId: null,
            pageCount: mime === 'application/pdf' ? await pdfPageCount(bytes) : 1,
          });
          if (reg.job) jobs.push(reg.job);
          docs.push({ id: docId, status: 'registered' });
        } else {
          docs.push({ id: docId, status: 'needs_review' });
        }
      } catch (err) {
        console.error('[ingest] store/register failed', err);
        // One attachment = one document row: mark the existing row failed.
        if (docId) {
          await tx
            .update(ingestDocuments)
            .set({ status: 'failed', error: 'store_failed', updatedAt: new Date() })
            .where(eq(ingestDocuments.id, docId));
        } else {
          const [d] = await tx
            .insert(ingestDocuments)
            .values({ ...base, mimeType: mime, sizeBytes: bytes.byteLength, sha256, status: 'failed', error: 'store_failed' })
            .returning({ id: ingestDocuments.id });
          docId = d!.id;
        }
        docs.push({ id: docId, status: 'failed' });
      }
    }

    // orderCapture: a forwarded order (a WhatsApp text, no media) from an
    // allow-listed number → a DRAFT purchase order for one-tap confirm.
    const orderText = message.attachments.length === 0 ? message.body?.trim() : '';
    if (
      orderText &&
      channel.kind === 'whatsapp' &&
      senderAllowed &&
      message.authVerdict === 'pass' &&
      featureEnabled(restaurant.settings, 'orderCapture')
    ) {
      const body = orderText.slice(0, ORDER_TEXT_MAX_CHARS);
      const order = await captureOrderDraft(tx, {
        restaurantId: channel.restaurantId,
        text: body,
        parser: orderTextParserFromEnv(),
        supplierId,
        senderPhone: sender,
        source: 'whatsapp',
      }).catch((err: unknown) => {
        console.error('[ingest] order capture failed', err);
        return { status: 'failed' as const };
      });
      const status: IngestMessageStatus =
        order.status === 'draft' ? 'accepted' : order.status === 'needs_supplier' ? 'needs_review' : order.status === 'failed' ? 'failed' : 'empty';
      // The full text is kept (subject) so the inbox can open it in the capture screen.
      await tx
        .update(ingestMessages)
        .set({
          subject: body,
          status,
          error: order.status === 'needs_supplier' ? 'order_needs_supplier' : order.status === 'failed' ? 'order_capture_failed' : null,
        })
        .where(eq(ingestMessages.id, msg.id));
      return { status, messageId: msg.id, documents: docs };
    }

    const status = messageStatus(docs.map((d) => d.status));
    await tx
      .update(ingestMessages)
      .set({ status, error: status === 'failed' ? 'processing_failed' : null })
      .where(eq(ingestMessages.id, msg.id));
    return { status, messageId: msg.id, documents: docs };
  });
  await enqueueIngestJobs(jobs);
  return outcome;
}

/** Pages in a PDF attachment (null when it does not parse — OCR still reads it). */
async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    return null;
  }
}
