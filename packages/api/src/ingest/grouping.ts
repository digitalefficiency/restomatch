import { z } from 'zod';
import { and, asc, eq, ingestDocuments, ingestMessages, invoices, sql, type Database } from '@restomatch/db';
import { composeDocument, MAX_DOCUMENT_PAGES } from '../documents/compose';
import { extOf, signObjectRef, storedImageValue } from '../documents/objectRef';
import { setInvoiceImage, upsertInvoiceScan } from '../documents/intake';

/**
 * G-09 · grouping inbound images into ONE document.
 *
 *  - The JPEG/PNG images of one message are one document.
 *  - An image from the same normalised sender on the same channel within N
 *    minutes of the document's FIRST page is the next page (N = restaurant
 *    setting `ingest.groupMinutes`, default 10). Later → a new document.
 *  - PDFs and webp stay their own single-page document.
 */

export const DEFAULT_GROUP_MINUTES = 10;
/** E-mail images smaller than this are signature logos / inline art, not pages. */
export const INLINE_IMAGE_MAX_BYTES = 20_000;
/** Images that can be a page of a composed PDF. */
export const PAGE_MIMES = ['image/jpeg', 'image/png'] as const;

export function isPageMime(mime: string | null | undefined): boolean {
  return mime === 'image/jpeg' || mime === 'image/png';
}

/**
 * `settings.ingest.groupMinutes`, read through a LOCAL parser:
 * `RestaurantSettings` lives in immutable schema.ts and is not widened.
 */
const GroupSettings = z
  .object({
    ingest: z
      .object({ groupMinutes: z.number().int().min(0).max(120).optional() })
      .partial()
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough();

export function groupMinutes(settings: unknown): number {
  const parsed = GroupSettings.safeParse(settings ?? {});
  const v = parsed.success ? parsed.data.ingest?.groupMinutes : undefined;
  return typeof v === 'number' ? v : DEFAULT_GROUP_MINUTES;
}

export interface PageRow {
  id: string;
  storagePath: string;
  mimeType: string | null;
}

/** The registered page rows of an ingested invoice, in page order. */
export async function invoicePageRows(tx: Database, restaurantId: string, invoiceId: string): Promise<PageRow[]> {
  const rows = await tx
    .select({ id: ingestDocuments.id, storagePath: ingestDocuments.storagePath, mimeType: ingestDocuments.mimeType })
    .from(ingestDocuments)
    .where(
      and(
        eq(ingestDocuments.restaurantId, restaurantId),
        eq(ingestDocuments.invoiceId, invoiceId),
        eq(ingestDocuments.status, 'registered'),
        sql`${ingestDocuments.storagePath} is not null`,
      ),
    )
    .orderBy(asc(ingestDocuments.createdAt), asc(ingestDocuments.id));
  return rows.map((r) => ({ id: r.id, storagePath: r.storagePath!, mimeType: r.mimeType }));
}

/**
 * The open candidate an image from (channel, sender) at `now` joins: the most
 * recent ingested IMAGE invoice from that sender whose first page arrived
 * within `minutes`, still in an open status. Openness beyond the status
 * (decisions, claims) is checked by the caller.
 */
export async function findOpenCandidate(
  tx: Database,
  args: { restaurantId: string; channelId: string; sender: string; messageId: string; now: Date; minutes: number },
): Promise<string | null> {
  if (args.minutes <= 0) return null;
  const since = new Date(args.now.getTime() - args.minutes * 60_000);
  const rows = (await tx.execute(sql`
    select d.invoice_id
    from ${ingestDocuments} d
    join ${ingestMessages} m on m.id = d.message_id and m.restaurant_id = d.restaurant_id
    join ${invoices} i on i.id = d.invoice_id and i.restaurant_id = d.restaurant_id
    where d.restaurant_id = ${args.restaurantId}
      and d.status = 'registered'
      and d.invoice_id is not null
      and m.id <> ${args.messageId}
      and i.status in ('ocr_pending', 'parsed', 'matched')
    group by d.invoice_id
    having bool_and(m.channel_id = ${args.channelId} and m.sender = ${args.sender})
       and bool_and(d.mime_type in ('image/jpeg', 'image/png'))
       and min(m.received_at) >= ${since.toISOString()}::timestamptz
       and min(m.received_at) <= ${args.now.toISOString()}::timestamptz
    order by min(m.received_at) desc
    limit 1
  `)) as unknown as Array<{ invoice_id: string }>;
  return rows[0]?.invoice_id ?? null;
}

/**
 * The review group of a needs_review image document: the needs_review images
 * of the same (channel, sender), clustered by the same anchored N-minute rule.
 * A non-image (or unknown) document is its own group.
 */
export async function reviewGroupOf(
  tx: Database,
  restaurantId: string,
  documentId: string,
  minutes: number,
): Promise<PageRow[]> {
  const [me] = await tx
    .select({
      id: ingestDocuments.id,
      storagePath: ingestDocuments.storagePath,
      mimeType: ingestDocuments.mimeType,
      status: ingestDocuments.status,
      messageId: ingestDocuments.messageId,
      channelId: ingestMessages.channelId,
      sender: ingestMessages.sender,
      receivedAt: ingestMessages.receivedAt,
    })
    .from(ingestDocuments)
    .innerJoin(
      ingestMessages,
      and(eq(ingestMessages.id, ingestDocuments.messageId), eq(ingestMessages.restaurantId, ingestDocuments.restaurantId)),
    )
    .where(and(eq(ingestDocuments.id, documentId), eq(ingestDocuments.restaurantId, restaurantId)))
    .limit(1);
  if (!me) return [];
  const self: PageRow[] = me.storagePath ? [{ id: me.id, storagePath: me.storagePath, mimeType: me.mimeType }] : [];
  if (me.status !== 'needs_review' || !me.storagePath || !isPageMime(me.mimeType)) return self;
  const span = Math.max(minutes, 0) * MAX_DOCUMENT_PAGES * 60_000;
  const rows = await tx
    .select({
      id: ingestDocuments.id,
      storagePath: ingestDocuments.storagePath,
      mimeType: ingestDocuments.mimeType,
      messageId: ingestDocuments.messageId,
      receivedAt: ingestMessages.receivedAt,
    })
    .from(ingestDocuments)
    .innerJoin(
      ingestMessages,
      and(eq(ingestMessages.id, ingestDocuments.messageId), eq(ingestMessages.restaurantId, ingestDocuments.restaurantId)),
    )
    .where(
      and(
        eq(ingestDocuments.restaurantId, restaurantId),
        eq(ingestDocuments.status, 'needs_review'),
        eq(ingestMessages.channelId, me.channelId),
        eq(ingestMessages.sender, me.sender),
        sql`${ingestDocuments.storagePath} is not null`,
        sql`${ingestDocuments.mimeType} in ('image/jpeg', 'image/png')`,
        sql`${ingestMessages.receivedAt} between ${new Date(me.receivedAt.getTime() - span).toISOString()}::timestamptz
            and ${new Date(me.receivedAt.getTime() + span).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(ingestMessages.receivedAt), asc(ingestDocuments.createdAt), asc(ingestDocuments.id));
  // Anchored clustering: a cluster starts at its first message; a message more
  // than N minutes after that start opens a new cluster. One message never splits.
  const clusters: Array<typeof rows> = [];
  let start = 0;
  let lastMessage: string | null = null;
  for (const r of rows) {
    const t = r.receivedAt.getTime();
    const cur = clusters[clusters.length - 1];
    if (cur && (r.messageId === lastMessage || (minutes > 0 && t - start <= minutes * 60_000)) && cur.length < MAX_DOCUMENT_PAGES) {
      cur.push(r);
    } else {
      clusters.push([r]);
      start = t;
    }
    lastMessage = r.messageId;
  }
  const mine = clusters.find((c) => c.some((r) => r.id === documentId));
  return (mine ?? []).map((r) => ({ id: r.id, storagePath: r.storagePath!, mimeType: r.mimeType }));
}

const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function mimeOfRef(ref: string): string {
  return MIME_BY_EXT[extOf(ref) ?? ''] ?? 'application/octet-stream';
}

/** The OCR dedupe key: at most one job per (invoice, page count). */
export function ocrDedupeKey(invoiceId: string, pageCount: number): string {
  return `ocr:${invoiceId}:${pageCount}`;
}

/**
 * The object for a page list: a single page is itself (no compose, as today);
 * two or more are composed into a versioned PDF `ingest:<firstPageId>#p<N>`.
 * Ingest pages are the attachment records, so they are never deleted.
 */
export async function objectForPages(
  restaurantId: string,
  firstPageId: string,
  paths: string[],
): Promise<{ storagePath: string; pageCount: number; mimeType: string }> {
  if (paths.length === 1) return { storagePath: paths[0]!, pageCount: 1, mimeType: mimeOfRef(paths[0]!) };
  const composed = await composeDocument({
    restaurantId,
    clientDocumentId: `ingest:${firstPageId}#p${paths.length}`,
    pageObjects: paths,
    deletePages: false,
  });
  return { storagePath: composed.storagePath, pageCount: composed.pageCount, mimeType: 'application/pdf' };
}

/**
 * Point an EXISTING invoice at the object for `pages` (recompose), refresh its
 * invoice_scans row and return the OCR job (dedupe `ocr:<id>:<N>`). The caller
 * has already re-opened it for OCR.
 */
export async function recomposeInvoice(
  tx: Database,
  args: { restaurantId: string; invoiceId: string; supplierId: string | null; pages: PageRow[] },
): Promise<{ storagePath: string; pageCount: number; job: { restaurantId: string; invoiceId: string; supplierId: string | null; imageUrl: string; dedupeKey: string } }> {
  const obj = await objectForPages(args.restaurantId, args.pages[0]!.id, args.pages.map((p) => p.storagePath));
  const imageUrl = await signObjectRef(args.restaurantId, obj.storagePath);
  if (!imageUrl) throw new Error('could not sign the composed document');
  await setInvoiceImage(tx, args.restaurantId, args.invoiceId, storedImageValue(args.restaurantId, obj.storagePath));
  await upsertInvoiceScan(tx, {
    restaurantId: args.restaurantId,
    invoiceId: args.invoiceId,
    storagePath: obj.storagePath,
    mimeType: obj.mimeType,
    pageCount: obj.pageCount,
  });
  return {
    storagePath: obj.storagePath,
    pageCount: obj.pageCount,
    job: {
      restaurantId: args.restaurantId,
      invoiceId: args.invoiceId,
      supplierId: args.supplierId,
      imageUrl,
      dedupeKey: ocrDedupeKey(args.invoiceId, obj.pageCount),
    },
  };
}
