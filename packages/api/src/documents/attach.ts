import { and, eq, ingestDocuments, inArray, invoices, restaurants, sql, type Database } from '@restomatch/db';
import { enqueueIngestJobs, type OcrJobToEnqueue } from '../ingest/pipeline';
import { invoicePageRows, isPageMime, multiPageEnabled, recomposeInvoice, type PageRow } from '../ingest/grouping';
import { MAX_DOCUMENT_PAGES } from './compose';
import { DocumentError, documentNotFound } from './errors';
import { createIntakeInvoice, invoiceClosedReason } from './intake';
import { reopenForOcr, retireInvoice } from './reocr';
import { storedImageValue } from './objectRef';
import type { AttachAsPageInput, AttachAsPageResult, SplitDocumentInput, SplitDocumentResult } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttachDeps {
  /** Test seam: where OCR jobs go (default: the queue, after commit). */
  enqueue?: (jobs: OcrJobToEnqueue[]) => Promise<void>;
}

/** Open, tenant-owned, or a named refusal / NOT_FOUND (foreign and missing look alike). */
async function assertOpen(tx: Database, restaurantId: string, invoiceId: string): Promise<void> {
  const reason = await invoiceClosedReason(tx, restaurantId, invoiceId);
  if (reason === 'not_found') throw documentNotFound();
  if (reason) throw new DocumentError(reason);
}

/** The multi-page switch of this restaurant (settings.ingest.multiPage), or a named refusal. */
async function assertMultiPage(tx: Database, restaurantId: string): Promise<void> {
  const [r] = await tx.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r || !multiPageEnabled(r.settings)) throw new DocumentError('reocr_not_enabled');
}

async function lockInvoices(tx: Database, restaurantId: string, ids: string[]): Promise<void> {
  await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, ids)))
    .for('update');
}

async function pagesOf(tx: Database, restaurantId: string, invoiceId: string): Promise<PageRow[]> {
  const rows = await invoicePageRows(tx, restaurantId, invoiceId);
  // Only image pages can be recomposed (a PDF is its own document).
  if (rows.length === 0 || rows.some((r) => !isPageMime(r.mimeType))) throw new DocumentError('unsupported_page_type');
  return rows;
}

/** Persist page order: rows get increasing created_at from the earliest one. */
async function setPageOrder(tx: Database, restaurantId: string, rows: PageRow[]): Promise<void> {
  const [first] = (await tx.execute(
    sql`select min(created_at) as t from ${ingestDocuments} where restaurant_id = ${restaurantId} and id in (${sql.join(
      rows.map((r) => sql`${r.id}`),
      sql`, `,
    )})`,
  )) as unknown as Array<{ t: string | Date }>;
  const base = new Date(first!.t).getTime();
  for (const [i, r] of rows.entries()) {
    await tx
      .update(ingestDocuments)
      .set({ createdAt: new Date(base + i), updatedAt: new Date() })
      .where(and(eq(ingestDocuments.id, r.id), eq(ingestDocuments.restaurantId, restaurantId)));
  }
}

/**
 * "צרפו כעמוד 2 לחשבונית X": merge an already-split invoice (`documentId`) into
 * `invoiceId` as page(s) at `pageIndex`. One transaction retires the absorbed
 * invoice, recomposes, and enqueues OCR ONCE (dedupe `ocr:<id>:<N>`).
 * Refused when either invoice has a decided פער, a claim, or is approved/paid.
 */
export async function attachAsPage(db: Database, input: AttachAsPageInput, deps: AttachDeps = {}): Promise<AttachAsPageResult> {
  const { restaurantId, invoiceId, documentId } = input;
  if (!UUID.test(invoiceId) || !UUID.test(documentId)) throw documentNotFound();
  if (invoiceId === documentId) throw new DocumentError('same_invoice');

  const { result, job } = await db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    await assertMultiPage(tx, restaurantId);
    await lockInvoices(tx, restaurantId, [invoiceId, documentId]);
    await assertOpen(tx, restaurantId, invoiceId);
    await assertOpen(tx, restaurantId, documentId);
    const survivor = await pagesOf(tx, restaurantId, invoiceId);
    const absorbed = await pagesOf(tx, restaurantId, documentId);
    if (survivor.length + absorbed.length > MAX_DOCUMENT_PAGES) throw new DocumentError('too_many_pages');
    const at = Math.max(0, Math.min(input.pageIndex ?? survivor.length, survivor.length));
    const merged = [...survivor.slice(0, at), ...absorbed, ...survivor.slice(at)];

    if (!(await reopenForOcr(tx, restaurantId, invoiceId))) throw new DocumentError('reocr_not_enabled');
    // Every row of the absorbed invoice (pages and duplicate links) now points at the survivor.
    await tx
      .update(ingestDocuments)
      .set({ invoiceId, updatedAt: new Date() })
      .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.invoiceId, documentId)));
    await setPageOrder(tx, restaurantId, merged);
    if (!(await retireInvoice(tx, restaurantId, documentId))) throw new DocumentError('reocr_not_enabled');

    const [inv] = await tx
      .select({ supplierId: invoices.supplierId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
      .limit(1);
    const r = await recomposeInvoice(tx, { restaurantId, invoiceId, supplierId: inv?.supplierId ?? null, pages: merged });
    return {
      result: { invoiceId, absorbedInvoiceId: documentId, storagePath: r.storagePath, pageCount: r.pageCount, ocrEnqueued: true },
      job: r.job,
    };
  });
  await (deps.enqueue ?? enqueueIngestJobs)([job]);
  return result;
}

/** A partition of 0..n-1 into ≥2 non-empty groups, or null. */
function validPartition(groups: number[][], n: number): boolean {
  if (!Array.isArray(groups) || groups.length < 2) return false;
  const seen = new Set<number>();
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return false;
    for (const i of g) {
      if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
      seen.add(i);
    }
  }
  return seen.size === n;
}

/**
 * The inverse of attachAsPage: one invoice → N invoices, each composed from
 * its pages and OCR'd once. The original keeps `pages[0]`.
 */
export async function splitDocument(db: Database, input: SplitDocumentInput, deps: AttachDeps = {}): Promise<SplitDocumentResult> {
  const { restaurantId, invoiceId } = input;
  if (!UUID.test(invoiceId)) throw documentNotFound();

  const { ids, jobs } = await db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    await assertMultiPage(tx, restaurantId);
    await lockInvoices(tx, restaurantId, [invoiceId]);
    await assertOpen(tx, restaurantId, invoiceId);
    const rows = await pagesOf(tx, restaurantId, invoiceId);
    if (!validPartition(input.pages, rows.length)) throw new DocumentError('invalid_split');
    const [orig] = await tx
      .select({ supplierId: invoices.supplierId, source: invoices.source, createdBy: invoices.createdBy })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
      .limit(1);
    if (!orig) throw documentNotFound();
    if (!(await reopenForOcr(tx, restaurantId, invoiceId))) throw new DocumentError('reocr_not_enabled');

    const out: string[] = [];
    const queued: OcrJobToEnqueue[] = [];
    for (const [k, group] of input.pages.entries()) {
      const groupRows = group.map((i) => rows[i]!);
      let target = invoiceId;
      if (k > 0) {
        target = await createIntakeInvoice(tx, {
          restaurantId,
          supplierId: orig.supplierId,
          rawImageUrl: storedImageValue(restaurantId, groupRows[0]!.storagePath),
          source: orig.source === 'whatsapp' || orig.source === 'email' ? orig.source : 'photo',
          createdBy: orig.createdBy,
        });
        await tx
          .update(ingestDocuments)
          .set({ invoiceId: target, updatedAt: new Date() })
          .where(and(eq(ingestDocuments.restaurantId, restaurantId), inArray(ingestDocuments.id, groupRows.map((r) => r.id))));
      }
      await setPageOrder(tx, restaurantId, groupRows);
      const r = await recomposeInvoice(tx, { restaurantId, invoiceId: target, supplierId: orig.supplierId, pages: groupRows });
      queued.push(r.job);
      out.push(target);
    }
    return { ids: out, jobs: queued };
  });
  await (deps.enqueue ?? enqueueIngestJobs)(jobs);
  return { invoiceIds: ids };
}
