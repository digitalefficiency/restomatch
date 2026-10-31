import {
  and,
  asc,
  discrepancies,
  eq,
  ingestDocuments,
  invoiceLines,
  ingestMessages,
  inArray,
  invoices,
  matchRuns,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { INGEST_LIMITS } from '@restomatch/ingest';
import { enqueueMatchInvoice } from '@restomatch/queue';
import { enqueueIngestJobs, type OcrJobToEnqueue } from '../ingest/pipeline';
import { groupMinutes, invoicePageRows, isPageMime, multiPageEnabled, recomposeInvoice, type PageRow } from '../ingest/grouping';
import { MAX_DOCUMENT_PAGES } from './compose';
import { reopenForOcr, retireBlocker, retireInvoice } from './reocr';

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

export type PageFlag =
  | 'page_other_supplier'
  | 'page_other_invoice'
  | 'page_duplicate'
  | 'page_unreadable'
  | 'page_not_merged';
export const PAGE_FLAGS: readonly PageFlag[] = [
  'page_other_supplier',
  'page_other_invoice',
  'page_duplicate',
  'page_unreadable',
  'page_not_merged',
];

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
  /** The EFFECTIVE number: the column, else the number blanked as a duplicate, else the OCR'd one. */
  invoiceNumber: string | null;
  supplierName: string | null;
  businessId: string | null;
  /** writeOcrHeader blanked the number because it was already on file for this invoice. */
  duplicateOf?: string | null;
  /** The read failed (ocr_payload.raw.ocrFailed) or produced no lines. */
  unreadable?: boolean;
  /** Content fingerprint (totals + lines) for the re-shot-page check. */
  fingerprint?: string;
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

/** Does the page carry ANY header evidence (number, ח.פ., supplier name)? */
export function hasHeaderEvidence(page: PageHeader): boolean {
  return Boolean(alnum(page.invoiceNumber) || digits(page.businessId) || normalizeSupplierName(page.supplierName));
}

/**
 * Why `page` may NOT join `first` (null = same supplier, same invoice).
 * Conservative: any positive evidence of a different supplier or a different
 * invoice number refuses; missing data on the page does not (the walk in
 * `decidePages` decides whether an evidence-less page may join at all).
 */
export function pageMismatch(first: PageHeader, page: PageHeader): 'page_other_supplier' | 'page_other_invoice' | null {
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

/**
 * The merge decision for an ordered cluster (page 1 first). Pure, so every
 * false-leak path is unit-testable:
 *  - page 1 unreadable → nothing merges;
 *  - a page that is unreadable, a duplicate of an invoice OUTSIDE the cluster,
 *    a re-shot copy of page 1 (same content), or that disagrees with page 1 is
 *    flagged, and BREAKS the chain: no later page merges into page 1;
 *  - before the first break, a page with header evidence merges only when it
 *    agrees with page 1; an evidence-less page continues the page right
 *    before it, which (no break yet) is page 1's document.
 */
export function decidePages(
  members: PageHeader[],
): { merge: PageHeader[]; flagged: Array<{ invoiceId: string; reason: PageFlag }> } {
  const [first, ...rest] = members;
  const merge: PageHeader[] = [];
  const flagged: Array<{ invoiceId: string; reason: PageFlag }> = [];
  if (!first) return { merge, flagged };
  const ids = new Set(members.map((m) => m.invoiceId));
  let broken = Boolean(first.unreadable);
  for (const page of rest) {
    let reason: PageFlag | null = null;
    if (page.unreadable) reason = 'page_unreadable';
    else if (page.duplicateOf && page.duplicateOf !== first.invoiceId && !ids.has(page.duplicateOf)) {
      reason = 'page_other_invoice'; // its number is ANOTHER invoice already on file
    } else if (page.duplicateOf || alnum(page.invoiceNumber) === alnum(first.invoiceNumber)) {
      // Same number as page 1: a real page 2, or a re-shot photo of page 1.
      if (page.fingerprint && page.fingerprint === first.fingerprint) reason = 'page_duplicate';
    }
    if (!reason) reason = pageMismatch(first, page);
    if (!reason && broken) reason = 'page_not_merged';
    if (reason) {
      flagged.push({ invoiceId: page.invoiceId, reason });
      broken = true;
    } else merge.push(page);
  }
  return { merge, flagged };
}

/** The OCR'd header bits, read defensively from `invoices.ocr_payload`. */
function ocrBits(payload: unknown): {
  name: string | null;
  businessId: string | null;
  number: string | null;
  duplicateOf: string | null;
  duplicateNumber: string | null;
  failed: boolean;
} {
  const p = payload as {
    raw?: {
      reconciled?: { supplier?: unknown; invoiceNumber?: unknown };
      supplier?: unknown;
      duplicateOf?: { invoiceId?: unknown; invoiceNumber?: unknown };
      ocrFailed?: unknown;
    };
  } | null;
  const s = (p?.raw?.reconciled?.supplier ?? p?.raw?.supplier ?? null) as { name?: unknown; businessId?: unknown } | null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    name: str(s?.name),
    businessId: str(s?.businessId),
    number: str(p?.raw?.reconciled?.invoiceNumber),
    duplicateOf: str(p?.raw?.duplicateOf?.invoiceId),
    duplicateNumber: str(p?.raw?.duplicateOf?.invoiceNumber),
    failed: p?.raw?.ocrFailed === true,
  };
}

interface ClusterRow {
  docId: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
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
          sizeBytes: ingestDocuments.sizeBytes,
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

    // Lock the members and their gaps before any check: a decision, claim,
    // credit note or price-history row cannot appear between check and delete
    // (their writes need these rows; FK checks take KEY SHARE).
    await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, memberIds)))
      .for('update');
    await tx.execute(sql`
      select d.id from ${discrepancies} d
      join ${matchRuns} r on r.id = d.match_run_id and r.restaurant_id = d.restaurant_id
      where d.restaurant_id = ${restaurantId} and r.invoice_id in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})
      for update of d`);

    const heads = await tx
      .select({
        invoiceId: invoices.id,
        status: invoices.status,
        supplierId: invoices.supplierId,
        invoiceNumber: invoices.invoiceNumber,
        ocrPayload: invoices.ocrPayload,
        totalExclVat: invoices.totalExclVat,
        totalInclVat: invoices.totalInclVat,
      })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, memberIds)));
    const lineStats = (await tx.execute(sql`
      select l.invoice_id, count(*)::int as n,
             string_agg(coalesce(l.line_total::text, '') || '|' || coalesce(l.qty_billed::text, ''), ',' order by l.line_total, l.qty_billed) as sig
      from ${invoiceLines} l
      join ${invoices} i on i.id = l.invoice_id and i.restaurant_id = ${restaurantId}
      where l.invoice_id in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})
      group by l.invoice_id`)) as unknown as Array<{ invoice_id: string; n: number; sig: string | null }>;
    const linesOf = new Map(lineStats.map((l) => [l.invoice_id, l]));
    const byId = new Map<string, PageHeader>(
      heads.map((h) => {
        const o = ocrBits(h.ocrPayload);
        const lines = linesOf.get(h.invoiceId);
        const parsedNoLines = h.status !== 'ocr_pending' && !lines;
        return [
          h.invoiceId,
          {
            invoiceId: h.invoiceId,
            status: h.status,
            supplierId: h.supplierId,
            invoiceNumber: h.invoiceNumber ?? o.duplicateNumber ?? o.number,
            supplierName: o.name,
            businessId: o.businessId,
            duplicateOf: o.duplicateOf,
            unreadable: o.failed || parsedNoLines,
            fingerprint: `${h.totalExclVat ?? ''}|${h.totalInclVat ?? ''}|${lines?.n ?? 0}|${lines?.sig ?? ''}`,
          },
        ];
      }),
    );
    const members = memberIds.map((id) => byId.get(id)).filter((h): h is PageHeader => Boolean(h));
    if (members.length < 2) return { result: NOTHING, ocr: [], match: [] };

    // A sibling still being read: decide later (its OCR — or its terminal
    // failure, or the sweep backstop — settles the cluster).
    if (members.some((m) => m.invoiceId !== invoiceId && m.status === 'ocr_pending')) {
      return { result: { ...NOTHING, hold: true }, ocr: [], match: [] };
    }

    const first = members[0]!;
    const decision = decidePages(members);
    const flagged = [...decision.flagged];
    let merging: PageHeader[] = [];
    if (decision.merge.length > 0) {
      // Page 1 grows only when nothing references it either, and every page it
      // absorbs is retirable (no claim, decision, approval/payment, credit
      // note, goods receipt, price history) — checked under the locks above.
      const firstBlocked = await retireBlocker(tx, restaurantId, first.invoiceId);
      for (const page of decision.merge) {
        if (firstBlocked || (await retireBlocker(tx, restaurantId, page.invoiceId))) {
          flagged.push({ invoiceId: page.invoiceId, reason: 'page_not_merged' });
        } else merging.push(page);
      }
      // The composed PDF must fit the attachment limit; otherwise nothing merges.
      const mergingIds = new Set([first.invoiceId, ...merging.map((m) => m.invoiceId)]);
      const bytes = cluster.filter((r) => mergingIds.has(r.invoiceId)).reduce((n, r) => n + (r.sizeBytes ?? 0), 0);
      const pageCount = cluster.filter((r) => mergingIds.has(r.invoiceId)).length;
      if (merging.length > 0 && (bytes > INGEST_LIMITS.attachmentBytes || pageCount > MAX_DOCUMENT_PAGES)) {
        for (const page of merging) flagged.push({ invoiceId: page.invoiceId, reason: 'page_not_merged' });
        merging = [];
      }
    }

    const ocr: OcrJobToEnqueue[] = [];
    let merged = false;
    if (merging.length > 0) {
      // In a savepoint: a compose / sign / storage error rolls back only the
      // merge; the pages are flagged and the held siblings still get matched.
      try {
        const job = await tx.transaction(async (rawSp) => {
          const sp = rawSp as unknown as Database;
          if (!(await reopenForOcr(sp, restaurantId, first.invoiceId))) throw new Error('page 1 could not be re-opened');
          const mergingIds = merging.map((m) => m.invoiceId);
          await sp
            .update(ingestDocuments)
            .set({ invoiceId: first.invoiceId, updatedAt: new Date() })
            .where(and(eq(ingestDocuments.restaurantId, restaurantId), inArray(ingestDocuments.invoiceId, mergingIds)));
          for (const id of mergingIds) {
            const retired = await retireInvoice(sp, { restaurantId, invoiceId: id, absorbedInto: first.invoiceId, userId: null });
            if (!retired.ok) throw new Error(`page ${id} could not be retired: ${retired.reason}`);
          }
          const pages: PageRow[] = await invoicePageRows(sp, restaurantId, first.invoiceId);
          const r = await recomposeInvoice(sp, { restaurantId, invoiceId: first.invoiceId, supplierId: first.supplierId, pages });
          return r.job;
        });
        ocr.push(job);
        merged = true;
      } catch (err) {
        console.warn(`[documents] merge into invoice=${first.invoiceId} failed; pages stay separate`, err);
        for (const page of merging) flagged.push({ invoiceId: page.invoiceId, reason: 'page_not_merged' });
        merging = [];
      }
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
