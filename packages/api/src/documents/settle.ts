import {
  and,
  asc,
  eq,
  ingestDocuments,
  ingestMessages,
  inArray,
  invoices,
  matchRuns,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { enqueueMatchInvoice } from '@restomatch/queue';
import { enqueueIngestJobs, type OcrJobToEnqueue } from '../ingest/pipeline';
import { groupMinutes, invoicePageRows, isPageMime, multiPageEnabled, recomposeInvoice, type PageRow } from '../ingest/grouping';
import { MAX_DOCUMENT_PAGES } from './compose';
import { invoiceClosedReason } from './intake';
import { reopenForOcr, retireInvoice } from './reocr';

/**
 * G-09 · the same-supplier guard (owner decision 31.10: "multi-page invoices
 * FROM THE SAME SUPPLIER").
 *
 * Every ingested page is registered as its own invoice and OCR'd alone. After
 * a page's OCR, the worker calls `settleDocumentPages`, which looks at the
 * page's cluster (same channel + sender, first page within N minutes):
 *  - while a sibling page is still being OCR'd → HOLD (no match yet);
 *  - a page whose OCR agrees with page 1 (ח.פ., supplier, supplier name,
 *    invoice number; a missing number = a continuation page) is merged into
 *    page 1's invoice: retired, recomposed, page 1 re-OCR'd ONCE;
 *  - a page that disagrees is NEVER merged: it stays its own invoice and its
 *    ingest_documents rows carry `page_other_supplier` / `page_other_invoice`
 *    (the inbox asks one question). Two suppliers' lines are never summed.
 * Restaurants without `settings.ingest.multiPage` are untouched (no-op).
 */

export type PageFlag = 'page_other_supplier' | 'page_other_invoice' | 'page_not_merged';
export const PAGE_FLAGS: readonly PageFlag[] = ['page_other_supplier', 'page_other_invoice', 'page_not_merged'];

export interface SettleResult {
  /** Don't match this invoice now: a sibling is pending, or it is being re-OCR'd. */
  hold: boolean;
  /** This invoice was merged into `mergedInto` and no longer exists. */
  absorbed: boolean;
  mergedInto?: string;
  /** Invoices that were NOT merged, with the reason (the inbox's question). */
  flagged: Array<{ invoiceId: string; reason: PageFlag }>;
}

export interface SettleDeps {
  enqueueOcr?: (jobs: OcrJobToEnqueue[]) => Promise<void>;
  enqueueMatch?: (job: { restaurantId: string; invoiceId: string }) => Promise<unknown>;
}

export interface PageHeader {
  invoiceId: string;
  status: string;
  supplierId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  businessId: string | null;
}

const NOTHING: SettleResult = { hold: false, absorbed: false, flagged: [] };

function digits(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 5 ? d : null;
}

function alnum(v: string | null | undefined): string | null {
  const s = (v ?? '').toLowerCase().replace(/[^0-9a-z֐-׿]/g, '');
  return s.length > 0 ? s : null;
}

/** A supplier name without legal suffixes, quotes and punctuation. */
export function normalizeSupplierName(v: string | null | undefined): string | null {
  const s = (v ?? '')
    .replace(/בע["״'׳]?מ/g, '')
    .replace(/\b(ltd|inc|llc|co)\b\.?/gi, '')
    .toLowerCase()
    .replace(/[^0-9a-z֐-׿]/g, '');
  return s.length >= 2 ? s : null;
}

/**
 * Why `page` may NOT join `first` (null = same supplier, same invoice).
 * Conservative: any positive evidence of a different supplier or a different
 * invoice number refuses; missing data on the page (a continuation page) does not.
 */
export function pageMismatch(first: PageHeader, page: PageHeader): Exclude<PageFlag, 'page_not_merged'> | null {
  if (first.supplierId && page.supplierId && first.supplierId !== page.supplierId) return 'page_other_supplier';
  const [ba, bb] = [digits(first.businessId), digits(page.businessId)];
  if (ba && bb && ba !== bb) return 'page_other_supplier';
  if (!(ba && bb)) {
    const [na, nb] = [normalizeSupplierName(first.supplierName), normalizeSupplierName(page.supplierName)];
    if (na && nb && !na.includes(nb) && !nb.includes(na)) return 'page_other_supplier';
  }
  const [ia, ib] = [alnum(first.invoiceNumber), alnum(page.invoiceNumber)];
  if (ia && ib && ia !== ib) return 'page_other_invoice';
  return null;
}

/** The OCR'd supplier header, read defensively from `invoices.ocr_payload`. */
function ocrSupplier(payload: unknown): { name: string | null; businessId: string | null } {
  const p = payload as { raw?: { reconciled?: { supplier?: unknown }; supplier?: unknown } } | null;
  const s = (p?.raw?.reconciled?.supplier ?? p?.raw?.supplier ?? null) as { name?: unknown; businessId?: unknown } | null;
  return {
    name: typeof s?.name === 'string' ? s.name : null,
    businessId: typeof s?.businessId === 'string' ? s.businessId : null,
  };
}

interface ClusterRow {
  docId: string;
  storagePath: string;
  mimeType: string | null;
  invoiceId: string;
  messageId: string;
  receivedAt: Date;
}

/**
 * Settle the page cluster of `invoiceId` after its OCR. Tenant-scoped (every
 * query filters `restaurantId`); a foreign or unknown invoice is a no-op.
 */
export async function settleDocumentPages(
  db: Database,
  args: { restaurantId: string; invoiceId: string },
  deps: SettleDeps = {},
): Promise<SettleResult> {
  const { restaurantId, invoiceId } = args;
  const outcome = await db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    const [restaurant] = await tx
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    if (!restaurant || !multiPageEnabled(restaurant.settings)) return { result: NOTHING, ocr: [], match: [] };
    const minutes = groupMinutes(restaurant.settings);

    // The page(s) of this invoice and their sender.
    const [mine] = await tx
      .select({ channelId: ingestMessages.channelId, sender: ingestMessages.sender, receivedAt: ingestMessages.receivedAt })
      .from(ingestDocuments)
      .innerJoin(
        ingestMessages,
        and(eq(ingestMessages.id, ingestDocuments.messageId), eq(ingestMessages.restaurantId, ingestDocuments.restaurantId)),
      )
      .where(
        and(
          eq(ingestDocuments.restaurantId, restaurantId),
          eq(ingestDocuments.invoiceId, invoiceId),
          eq(ingestDocuments.status, 'registered'),
        ),
      )
      .orderBy(asc(ingestMessages.receivedAt))
      .limit(1);
    if (!mine || minutes <= 0) return { result: NOTHING, ocr: [], match: [] };

    // Concurrent OCR completions of one sender's pages settle in turn.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ingest-group:${restaurantId}:${mine.channelId}:${mine.sender}`}))`,
    );

    const span = minutes * MAX_DOCUMENT_PAGES * 60_000;
    const rows: ClusterRow[] = (
      await tx
        .select({
          docId: ingestDocuments.id,
          storagePath: ingestDocuments.storagePath,
          mimeType: ingestDocuments.mimeType,
          invoiceId: ingestDocuments.invoiceId,
          error: ingestDocuments.error,
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
            eq(ingestDocuments.status, 'registered'),
            eq(ingestMessages.channelId, mine.channelId),
            eq(ingestMessages.sender, mine.sender),
            sql`${ingestDocuments.invoiceId} is not null`,
            sql`${ingestDocuments.storagePath} is not null`,
            sql`${ingestMessages.receivedAt} between ${new Date(mine.receivedAt.getTime() - span).toISOString()}::timestamptz
                and ${new Date(mine.receivedAt.getTime() + span).toISOString()}::timestamptz`,
          ),
        )
        .orderBy(asc(ingestMessages.receivedAt), asc(ingestDocuments.createdAt), asc(ingestDocuments.id))
    )
      // A flagged page already had its one question: it never joins again.
      .filter((r) => !(r.error && (PAGE_FLAGS as readonly string[]).includes(r.error)) && isPageMime(r.mimeType))
      .map((r) => ({ ...r, storagePath: r.storagePath!, invoiceId: r.invoiceId! }));

    // Anchored clustering (the same rule as review groups): a cluster starts at
    // its first message; a message more than N minutes later starts a new one.
    const clusters: ClusterRow[][] = [];
    let start = 0;
    for (const r of rows) {
      const cur = clusters[clusters.length - 1];
      if (cur && r.receivedAt.getTime() - start <= minutes * 60_000) cur.push(r);
      else {
        clusters.push([r]);
        start = r.receivedAt.getTime();
      }
    }
    const cluster = clusters.find((c) => c.some((r) => r.invoiceId === invoiceId)) ?? [];
    const memberIds = [...new Set(cluster.map((r) => r.invoiceId))];
    if (memberIds.length < 2) return { result: NOTHING, ocr: [], match: [] };

    const heads = await tx
      .select({
        invoiceId: invoices.id,
        status: invoices.status,
        supplierId: invoices.supplierId,
        invoiceNumber: invoices.invoiceNumber,
        ocrPayload: invoices.ocrPayload,
      })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, memberIds)));
    const byId = new Map<string, PageHeader>(
      heads.map((h) => {
        const s = ocrSupplier(h.ocrPayload);
        return [
          h.invoiceId,
          { invoiceId: h.invoiceId, status: h.status, supplierId: h.supplierId, invoiceNumber: h.invoiceNumber, supplierName: s.name, businessId: s.businessId },
        ];
      }),
    );
    const members = memberIds.map((id) => byId.get(id)).filter((h): h is PageHeader => Boolean(h));
    if (members.length < 2) return { result: NOTHING, ocr: [], match: [] };

    // A sibling still being read: decide later (its OCR settles the cluster).
    if (members.some((m) => m.invoiceId !== invoiceId && m.status === 'ocr_pending')) {
      return { result: { ...NOTHING, hold: true }, ocr: [], match: [] };
    }

    const [first, ...rest] = members as [PageHeader, ...PageHeader[]];
    const flagged: SettleResult['flagged'] = [];
    const toMerge: PageHeader[] = [];
    for (const page of rest) {
      const reason = pageMismatch(first, page);
      if (reason) flagged.push({ invoiceId: page.invoiceId, reason });
      else toMerge.push(page);
    }
    // Page 1 must be open (no decided פער, no claim, not approved/paid) to grow,
    // and so must every page it absorbs.
    const firstClosed = toMerge.length > 0 ? await invoiceClosedReason(tx, restaurantId, first.invoiceId) : null;
    const merging: PageHeader[] = [];
    for (const page of toMerge) {
      if (firstClosed || (await invoiceClosedReason(tx, restaurantId, page.invoiceId))) {
        flagged.push({ invoiceId: page.invoiceId, reason: 'page_not_merged' });
      } else merging.push(page);
    }

    for (const f of flagged) {
      await tx
        .update(ingestDocuments)
        .set({ error: f.reason, updatedAt: new Date() })
        .where(
          and(
            eq(ingestDocuments.restaurantId, restaurantId),
            eq(ingestDocuments.invoiceId, f.invoiceId),
            sql`${ingestDocuments.error} is null`,
          ),
        );
    }

    const ocr: OcrJobToEnqueue[] = [];
    let merged = false;
    const existingFirstPages = await invoicePageRows(tx, restaurantId, first.invoiceId);
    const total = existingFirstPages.length + cluster.filter((r) => merging.some((m) => m.invoiceId === r.invoiceId)).length;
    if (merging.length > 0 && total <= MAX_DOCUMENT_PAGES && (await reopenForOcr(tx, restaurantId, first.invoiceId))) {
      const mergingIds = merging.map((m) => m.invoiceId);
      await tx
        .update(ingestDocuments)
        .set({ invoiceId: first.invoiceId, updatedAt: new Date() })
        .where(and(eq(ingestDocuments.restaurantId, restaurantId), inArray(ingestDocuments.invoiceId, mergingIds)));
      for (const id of mergingIds) await retireInvoice(tx, restaurantId, id);
      const pages: PageRow[] = await invoicePageRows(tx, restaurantId, first.invoiceId);
      const r = await recomposeInvoice(tx, { restaurantId, invoiceId: first.invoiceId, supplierId: first.supplierId, pages });
      ocr.push(r.job);
      merged = true;
    }

    // Pages that were held for this decision and stay their own invoice get
    // their match now (a plain match job is idempotent). The current invoice is
    // matched by its own OCR job.
    const match: string[] = [];
    const settledIds = members
      .map((m) => m.invoiceId)
      .filter((id) => id !== invoiceId && !(merged && (id === first.invoiceId || merging.some((m) => m.invoiceId === id))));
    if (settledIds.length > 0) {
      const runs = await tx
        .select({ invoiceId: matchRuns.invoiceId })
        .from(matchRuns)
        .where(and(eq(matchRuns.restaurantId, restaurantId), inArray(matchRuns.invoiceId, settledIds)));
      const ran = new Set(runs.map((r) => r.invoiceId));
      for (const id of settledIds) if (!ran.has(id) && byId.get(id)?.status === 'matched') match.push(id);
    }

    const absorbed = merged && merging.some((m) => m.invoiceId === invoiceId);
    const result: SettleResult = {
      hold: merged && first.invoiceId === invoiceId,
      absorbed,
      ...(absorbed || (merged && first.invoiceId === invoiceId) ? { mergedInto: first.invoiceId } : {}),
      flagged,
    };
    return { result, ocr, match };
  });

  await (deps.enqueueOcr ?? enqueueIngestJobs)(outcome.ocr);
  for (const id of outcome.match) {
    try {
      await (deps.enqueueMatch ?? enqueueMatchInvoice)({ restaurantId, invoiceId: id });
    } catch (err) {
      console.warn(`[documents] failed to enqueue match for invoice=${id}`, err);
    }
  }
  return outcome.result;
}
