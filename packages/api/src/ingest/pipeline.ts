import { createHash } from 'node:crypto';
import {
  and,
  eq,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
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
import { enqueueOcrInvoice } from '@restomatch/queue';
import { featureEnabled } from '../lib/features';
import { isAllowedScanUrl } from '../lib/scanUrls';
import { signedUrlForStoragePath, storeIngestedFile } from './store';

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
}

export type InboundOutcome =
  | { status: 'disabled' }
  | { status: 'duplicate'; messageId: string | null }
  | { status: IngestMessageStatus; messageId: string; documents: Array<{ id: string; status: IngestDocumentStatus }> };

/**
 * Register one stored document as an invoice — the same row the receiving
 * wizard creates (status ocr_pending), deduped per (restaurant, object) under
 * the same advisory lock as receiving.registerInvoice. Runs inside the caller's
 * restaurant-scoped transaction; returns the OCR job to enqueue AFTER commit.
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
  },
): Promise<{ invoiceId: string; job: OcrJobToEnqueue | null }> {
  const imageUrl = await signedUrlForStoragePath(args.restaurantId, args.storagePath);
  if (!imageUrl || !isAllowedScanUrl(imageUrl)) throw new Error('could not sign the stored document');
  const objectUrl = imageUrl.split('?')[0]!;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`register-invoice:${args.restaurantId}:${objectUrl}`}))`,
  );
  const [existing] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, args.restaurantId),
        sql`split_part(${invoices.rawImageUrl}, '?', 1) = ${objectUrl}`,
      ),
    )
    .limit(1);
  let invoiceId: string;
  let job: OcrJobToEnqueue | null = null;
  if (existing) {
    invoiceId = existing.id;
  } else {
    const [row] = await tx
      .insert(invoices)
      .values({
        restaurantId: args.restaurantId,
        supplierId: args.supplierId,
        rawImageUrl: imageUrl,
        status: 'ocr_pending',
        source: args.kind === 'whatsapp' ? 'whatsapp' : 'email',
        createdBy: args.userId,
      })
      .returning({ id: invoices.id });
    if (!row) throw new Error('failed to register invoice');
    invoiceId = row.id;
    job = { restaurantId: args.restaurantId, invoiceId, supplierId: args.supplierId, imageUrl };
  }
  // Only a document still awaiting review can be registered (approve/reject race).
  const moved = await tx
    .update(ingestDocuments)
    .set({ status: 'registered', invoiceId, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(ingestDocuments.id, args.documentId),
        eq(ingestDocuments.restaurantId, args.restaurantId),
        eq(ingestDocuments.status, 'needs_review'),
      ),
    )
    .returning({ id: ingestDocuments.id });
  if (moved.length === 0) throw new Error('document is no longer awaiting review');
  return { invoiceId, job };
}

/** Enqueue OCR jobs after the transaction committed. Never throws. */
export async function enqueueIngestJobs(jobs: OcrJobToEnqueue[]): Promise<void> {
  for (const job of jobs) {
    try {
      await enqueueOcrInvoice(job);
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
): Promise<InboundOutcome> {
  const jobs: OcrJobToEnqueue[] = [];
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
      if (!autoRegister) {
        // Storage quota for review documents (stored without OCR) per channel per day.
        const rows = (await tx.execute(sql`
          select coalesce(sum(d.size_bytes), 0)::bigint as bytes
          from ingest_documents d
          join ingest_messages m on m.id = d.message_id and m.restaurant_id = d.restaurant_id
          where m.channel_id = ${channel.channelId}
            and d.restaurant_id = ${channel.restaurantId}
            and d.storage_path is not null
            and d.invoice_id is null
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
          const reg = await registerIngestedDocument(tx, {
            restaurantId: channel.restaurantId,
            documentId: docId,
            storagePath: stored.storagePath,
            kind: channel.kind,
            supplierId,
            userId: null,
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
