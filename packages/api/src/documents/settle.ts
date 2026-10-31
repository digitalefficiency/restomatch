import {
  and,
  asc,
  auditLog,
  discrepancies,
  eq,
  ingestDocuments,
  invoiceLines,
  ingestMessages,
  inArray,
  invoiceScans,
  invoices,
  matchRuns,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { TRPCError } from '@trpc/server';
import { INGEST_LIMITS } from '@restomatch/ingest';
import { enqueueMatchInvoice } from '@restomatch/queue';
import { enqueueIngestJobs, type OcrJobToEnqueue } from '../ingest/pipeline';
import { groupMinutes, invoicePageRows, isPageMime, multiPageEnabled, recomposeInvoice, type PageRow } from '../ingest/grouping';
import { MAX_DOCUMENT_PAGES } from './compose';
import { objectRefMatchValues, tenantPath } from './objectRef';
import { defaultDocumentStorage } from './storage';
import { PAGES_RECOMPOSED_ACTION, reopenForOcr, retireBlocker, retireInvoice } from './reocr';

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
  /** Content (totals + lines) for the re-shot-page check. */
  print?: PagePrint;
  /** Single-page prints of pages already merged into this invoice (from the merge audit rows). */
  absorbedPrints?: PagePrint[];
  /** A page flag was set on this invoice earlier: a chain BREAK, never a candidate. */
  alreadyFlagged?: PageFlag | null;
}

/** What a page says: its number, totals and lines (for the duplicate check). */
export interface PagePrint {
  /** Normalised effective invoice number of the page, when it carried one. */
  number?: string | null;
  totalExclVat: string | null;
  totalInclVat: string | null;
  lines: Array<{ qty: string | null; total: string | null; unitPrice?: string | null; description?: string | null }>;
}

const NOTHING: SettleResult = { hold: false, absorbed: false, flagged: [] };

function digits(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 5 ? d : null;
}

/** An invoice number for comparison: case-folded, without spaces and punctuation ('A 100' = 'A-100'). */
export function normalizeInvoiceNumber(v: string | null | undefined): string | null {
  const s = (v ?? '').toLowerCase().replace(/[^0-9a-z֐-׿]/g, '');
  return s.length > 0 ? s : null;
}
const alnum = normalizeInvoiceNumber;

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

/** The identity a document chain has established so far (page 1 plus every merged page). */
export interface ChainIdentity {
  supplierId: string | null;
  number: string | null;
  businessId: string | null;
  name: string | null;
}

export function identityOf(page: PageHeader): ChainIdentity {
  return {
    supplierId: page.supplierId,
    number: alnum(page.invoiceNumber),
    businessId: digits(page.businessId),
    name: normalizeSupplierName(page.supplierName),
  };
}

function namesAgree(a: string | null, b: string | null): boolean {
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

/**
 * Why `page` may NOT join a chain with identity `chain` (null = it may).
 * Any positive evidence of another supplier or another invoice number refuses.
 * A page that brings a NUMBER the chain does not have yet joins only when its
 * ח.פ. AND supplier name both match the chain's (a name-only page 1 cannot
 * adopt someone's invoice number).
 */
export function chainMismatch(chain: ChainIdentity, page: PageHeader): 'page_other_supplier' | 'page_other_invoice' | 'page_not_merged' | null {
  const p = identityOf(page);
  if (chain.supplierId && p.supplierId && chain.supplierId !== p.supplierId) return 'page_other_supplier';
  if (chain.businessId && p.businessId && chain.businessId !== p.businessId) return 'page_other_supplier';
  if (!(chain.businessId && p.businessId) && chain.name && p.name && !namesAgree(chain.name, p.name)) return 'page_other_supplier';
  if (chain.number && p.number && chain.number !== p.number) return 'page_other_invoice';
  if (p.number && !chain.number) {
    const bizOk = Boolean(chain.businessId && p.businessId && chain.businessId === p.businessId);
    if (!bizOk || !namesAgree(chain.name, p.name)) return 'page_not_merged';
  }
  return null;
}

/** Backwards-compatible single-pair form (page 1 vs a page). */
export function pageMismatch(first: PageHeader, page: PageHeader): 'page_other_supplier' | 'page_other_invoice' | null {
  const r = chainMismatch(identityOf(first), page);
  return r === 'page_not_merged' ? null : r;
}

function absorb(chain: ChainIdentity, page: PageHeader): void {
  const p = identityOf(page);
  chain.number ??= p.number;
  chain.businessId ??= p.businessId;
  chain.name ??= p.name;
  chain.supplierId ??= p.supplierId;
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const close = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) <= Math.max(0.5, 0.005 * Math.max(Math.abs(a), Math.abs(b)));

function tokens(v: string | null | undefined): Set<string> {
  return new Set((v ?? '').toLowerCase().split(/[^0-9a-z֐-׿]+/).filter((t) => t.length > 1));
}

function similarText(a: string | null | undefined, b: string | null | undefined): boolean {
  const [ta, tb] = [tokens(a), tokens(b)];
  if (ta.size === 0 || tb.size === 0) return false;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both += 1;
  return both / (ta.size + tb.size - both) >= 0.6;
}

/**
 * Same CONTENT: similar line counts and at least 80% of the lines matching on
 * description, quantity, unit price and line total (within ₪0.50 or 0.5% —
 * a re-shot photo reads a little differently). A total alone is never enough.
 */
export function sameContent(a: PagePrint | undefined, b: PagePrint | undefined): boolean {
  if (!a || !b || a.lines.length === 0 || b.lines.length === 0) return false;
  const [na, nb] = [a.lines.length, b.lines.length];
  if (Math.abs(na - nb) > Math.max(1, Math.floor(0.2 * Math.max(na, nb)))) return false;
  const free = [...b.lines];
  let matched = 0;
  for (const l of a.lines) {
    const i = free.findIndex(
      (m) =>
        num(m.qty) === num(l.qty) &&
        close(num(m.total), num(l.total)) &&
        (l.unitPrice == null || m.unitPrice == null || close(num(m.unitPrice), num(l.unitPrice))) &&
        similarText(m.description, l.description),
    );
    if (i >= 0) {
      matched += 1;
      free.splice(i, 1);
    }
  }
  return matched / Math.max(na, nb) >= 0.8;
}

/**
 * A re-shot copy of a page already in the chain: IDENTITY (the same normalised
 * number; or a duplicateOf pointing into the chain; or neither page carries a
 * number) AND the same content.
 */
export function samePage(
  earlier: PagePrint | undefined,
  page: PagePrint | undefined,
  opts: { duplicateOfChain?: boolean } = {},
): boolean {
  if (!earlier || !page) return false;
  const [ne, np] = [alnum(earlier.number), alnum(page.number)];
  const identity = opts.duplicateOfChain || (ne !== null && ne === np) || (ne === null && np === null);
  return identity && sameContent(earlier, page);
}

/**
 * The merge decision for an ordered cluster (page 1 first). Pure, so every
 * false-leak path is unit-testable:
 *  - nothing merges into a page 1 that is unreadable, carries NO header
 *    evidence, or was itself flagged;
 *  - the chain's IDENTITY (number, ח.פ., name) accumulates from page 1 and every
 *    merged page; each candidate is checked against it (chainMismatch);
 *  - a page flagged earlier is a chain BREAK (kept, never a candidate) — except
 *    an earlier page_duplicate that still matches a chain page (identity + content);
 *  - a page that is unreadable, a duplicate of an invoice OUTSIDE the cluster,
 *    a re-shot copy of a CHAIN page (samePage against page 1, the merged pages
 *    and their stored single-page prints — never against flagged pages), or
 *    that disagrees with the chain is flagged, and breaks the chain;
 *  - after the first break nothing merges; before it, an evidence-less page
 *    continues the page right before it (which is in the chain).
 */
export function decidePages(
  members: PageHeader[],
): { merge: PageHeader[]; flagged: Array<{ invoiceId: string; reason: PageFlag }> } {
  const [first, ...rest] = members;
  const merge: PageHeader[] = [];
  const flagged: Array<{ invoiceId: string; reason: PageFlag }> = [];
  if (!first) return { merge, flagged };
  const ids = new Set(members.map((m) => m.invoiceId));
  const chainIds = new Set<string>([first.invoiceId]);
  const chain = identityOf(first);
  let broken = Boolean(first.unreadable || first.alreadyFlagged || !hasHeaderEvidence(first));
  const chainPrints: PagePrint[] = [];
  const addPrints = (m: PageHeader) => {
    if (m.print) chainPrints.push(m.print);
    for (const p of m.absorbedPrints ?? []) chainPrints.push(p);
  };
  addPrints(first);
  const isChainDuplicate = (page: PageHeader) =>
    chainPrints.some((p) =>
      samePage(p, page.print, { duplicateOfChain: Boolean(page.duplicateOf && chainIds.has(page.duplicateOf)) }),
    );
  for (const page of rest) {
    if (page.alreadyFlagged) {
      // A re-shot duplicate of a chain page does not break the chain; anything else does.
      if (!(page.alreadyFlagged === 'page_duplicate' && isChainDuplicate(page))) broken = true;
      continue;
    }
    let reason: PageFlag | null = null;
    if (page.unreadable) reason = 'page_unreadable';
    else if (page.duplicateOf && !chainIds.has(page.duplicateOf) && !ids.has(page.duplicateOf)) {
      reason = 'page_other_invoice'; // its number is ANOTHER invoice already on file
    }
    if (!reason && isChainDuplicate(page)) reason = 'page_duplicate';
    if (!reason) reason = chainMismatch(chain, page);
    if (!reason && broken) reason = 'page_not_merged';
    if (reason) {
      flagged.push({ invoiceId: page.invoiceId, reason });
      // A chain duplicate is just a copy: it does not cut the document.
      if (reason !== 'page_duplicate') broken = true;
    } else {
      merge.push(page);
      chainIds.add(page.invoiceId);
      absorb(chain, page);
      addPrints(page);
    }
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

/** A merge refusal that retrying cannot fix. */
class PermanentMergeError extends Error {}

/**
 * Best effort: delete a composed PDF a recompose superseded, when no invoice,
 * mapping row or attachment still references it. Never a page object (only
 * composed `.pdf` objects reach here) and never fails the settle.
 */
async function removeSupersededObject(db: Database, restaurantId: string, ref: string): Promise<void> {
  try {
    const values = objectRefMatchValues(restaurantId, ref);
    const used = (await db.execute(sql`
      select 1 from ${invoices} where restaurant_id = ${restaurantId}
        and split_part(raw_image_url, '?', 1) in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})
      union all select 1 from ${invoiceScans} where restaurant_id = ${restaurantId} and storage_path = ${ref}
      union all select 1 from ${ingestDocuments} where restaurant_id = ${restaurantId} and storage_path = ${ref}
      limit 1`)) as unknown as unknown[];
    if (used.length > 0) return;
    await defaultDocumentStorage()?.remove(restaurantId, [ref]);
  } catch (err) {
    console.warn(`[documents] could not remove superseded object ${ref}`, err);
  }
}

interface ClusterRow {
  flag: PageFlag | null;
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
  const attempt = () => db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    const [restaurant] = await tx
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    if (!restaurant || !multiPageEnabled(restaurant.settings)) return { result: NOTHING, ocr: [], match: [], superseded: null };
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
    if (!mine || minutes <= 0) return { result: NOTHING, ocr: [], match: [], superseded: null };

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
      // A flagged page STAYS in the cluster: it already had its one question, so
      // it is never a merge candidate again, but it still BREAKS the chain.
      .filter((r) => isPageMime(r.mimeType))
      .map((r) => ({
        ...r,
        storagePath: r.storagePath!,
        invoiceId: r.invoiceId!,
        // A person's "separate invoice" decision is a permanent break too.
        flag:
          r.error && ((PAGE_FLAGS as readonly string[]).includes(r.error) || r.error === 'page_separate')
            ? (r.error as PageFlag)
            : null,
      }));

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
    if (memberIds.length < 2) return { result: NOTHING, ocr: [], match: [], superseded: null };

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
    const lineRows = (await tx.execute(sql`
      select l.invoice_id, l.qty_billed::text as qty, l.line_total::text as total,
             l.unit_price_billed::text as unit_price, l.raw_description as description
      from ${invoiceLines} l
      join ${invoices} i on i.id = l.invoice_id and i.restaurant_id = ${restaurantId}
      where l.invoice_id in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as Array<{
      invoice_id: string;
      qty: string | null;
      total: string | null;
      unit_price: string | null;
      description: string | null;
    }>;
    const linesOf = new Map<string, PagePrint['lines']>();
    for (const l of lineRows) {
      linesOf.set(l.invoice_id, [
        ...(linesOf.get(l.invoice_id) ?? []),
        { qty: l.qty, total: l.total, unitPrice: l.unit_price, description: l.description },
      ]);
    }
    // Single-page prints of the pages already in a member's document (page 1
    // before its composed re-OCR, and every absorbed page): kept on the
    // member's own `document.pages_recomposed` audit rows (entity-scoped lookup).
    const printRows = (await tx.execute(sql`
      select entity_id::text as invoice_id, before->'prints' as prints
      from ${auditLog}
      where entity_type = 'invoice'
        and entity_id in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})
        and restaurant_id = ${restaurantId}
        and action = ${PAGES_RECOMPOSED_ACTION}`)) as unknown as Array<{ invoice_id: string; prints: PagePrint[] | null }>;
    const absorbedOf = new Map<string, PagePrint[]>();
    for (const p of printRows) absorbedOf.set(p.invoice_id, [...(absorbedOf.get(p.invoice_id) ?? []), ...(p.prints ?? [])]);
    const flagOf = new Map<string, PageFlag>();
    for (const r of cluster) if (r.flag && !flagOf.has(r.invoiceId)) flagOf.set(r.invoiceId, r.flag);
    const byId = new Map<string, PageHeader>(
      heads.map((h) => {
        const o = ocrBits(h.ocrPayload);
        const lines = linesOf.get(h.invoiceId) ?? [];
        const parsedNoLines = h.status !== 'ocr_pending' && lines.length === 0;
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
            print: {
              number: alnum(h.invoiceNumber ?? o.duplicateNumber ?? o.number),
              totalExclVat: h.totalExclVat,
              totalInclVat: h.totalInclVat,
              lines,
            },
            absorbedPrints: absorbedOf.get(h.invoiceId) ?? [],
            alreadyFlagged: flagOf.get(h.invoiceId) ?? null,
          },
        ];
      }),
    );
    const members = memberIds.map((id) => byId.get(id)).filter((h): h is PageHeader => Boolean(h));
    if (members.length < 2) return { result: NOTHING, ocr: [], match: [], superseded: null };

    // A sibling still being read: decide later (its OCR — or its terminal
    // failure, or the sweep backstop — settles the cluster).
    if (members.some((m) => m.invoiceId !== invoiceId && m.status === 'ocr_pending')) {
      return { result: { ...NOTHING, hold: true }, ocr: [], match: [], superseded: null };
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
    /** A transient failure (deadlock, storage, signing) after the bounded retries: leave the pages held. */
    let transientHold = false;
    let superseded: { from: string; to: string } | null = null;
    if (merging.length > 0) {
      // Page 1's current object (from its mapping row: always a full path with
      // its extension), to clean up a superseded composed PDF after commit.
      const [cur] = await tx
        .select({ path: invoiceScans.storagePath })
        .from(invoiceScans)
        .where(and(eq(invoiceScans.invoiceId, first.invoiceId), eq(invoiceScans.restaurantId, restaurantId)))
        .limit(1);
      const before = cur?.path ? tenantPath(restaurantId, cur.path) : null;
      // In a savepoint: any error rolls back only the merge. A PERMANENT one
      // (a refusal, a missing page object, a size limit) flags the pages; a
      // transient one is retried twice, then the pages stay held (not flagged)
      // for the next settle or the sweep.
      for (let tries = 0; ; tries++) {
        try {
          const done = await tx.transaction(async (rawSp) => {
            const sp = rawSp as unknown as Database;
            // The single-page prints of this document, kept on page 1's own
            // audit row, so a later re-shot of ANY of its pages is recognised.
            const prints = [
              ...((first.absorbedPrints ?? []).length ? [] : first.print ? [first.print] : []),
              ...merging.flatMap((m) => [...(m.print ? [m.print] : []), ...(m.absorbedPrints ?? [])]),
            ];
            await sp.insert(auditLog).values({
              restaurantId,
              userId: null,
              action: PAGES_RECOMPOSED_ACTION,
              entityType: 'invoice',
              entityId: first.invoiceId,
              before: { prints } as never,
              after: { pages: [first.invoiceId, ...merging.map((m) => m.invoiceId)] } as never,
            });
            if (!(await reopenForOcr(sp, restaurantId, first.invoiceId))) throw new PermanentMergeError('page 1 could not be re-opened');
            const mergingIds = merging.map((m) => m.invoiceId);
            await sp
              .update(ingestDocuments)
              .set({ invoiceId: first.invoiceId, updatedAt: new Date() })
              .where(and(eq(ingestDocuments.restaurantId, restaurantId), inArray(ingestDocuments.invoiceId, mergingIds)));
            for (const id of mergingIds) {
              const retired = await retireInvoice(sp, {
                restaurantId,
                invoiceId: id,
                absorbedInto: first.invoiceId,
                userId: null,
                print: byId.get(id)?.print,
              });
              if (!retired.ok) throw new PermanentMergeError(`page ${id} could not be retired: ${retired.reason}`);
            }
            const pages: PageRow[] = await invoicePageRows(sp, restaurantId, first.invoiceId);
            return recomposeInvoice(sp, { restaurantId, invoiceId: first.invoiceId, supplierId: first.supplierId, pages });
          });
          ocr.push(done.job);
          merged = true;
          if (before && before !== done.storagePath && /\.pdf$/i.test(before)) superseded = { from: before, to: done.storagePath };
          break;
        } catch (err) {
          const permanent = err instanceof PermanentMergeError || err instanceof TRPCError;
          if (!permanent && tries < 2) continue;
          console.warn(`[documents] merge into invoice=${first.invoiceId} failed (${permanent ? 'permanent' : 'transient'})`, err);
          if (permanent) for (const page of merging) flagged.push({ invoiceId: page.invoiceId, reason: 'page_not_merged' });
          else transientHold = true;
          merging = [];
          break;
        }
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
    if (settledIds.length > 0 && !transientHold) {
      const runs = await tx
        .select({ invoiceId: matchRuns.invoiceId })
        .from(matchRuns)
        .where(and(eq(matchRuns.restaurantId, restaurantId), inArray(matchRuns.invoiceId, settledIds)));
      const ran = new Set(runs.map((r) => r.invoiceId));
      const duplicate = (id: string) =>
        flagOf.get(id) === 'page_duplicate' || flagged.some((f) => f.invoiceId === id && f.reason === 'page_duplicate');
      for (const id of settledIds) if (!ran.has(id) && byId.get(id)?.status === 'matched' && !duplicate(id)) match.push(id);
    }

    const absorbed = merged && merging.some((m) => m.invoiceId === invoiceId);
    // A re-shot duplicate is never auto-matched: it waits for a person.
    const currentIsDuplicate =
      flagOf.get(invoiceId) === 'page_duplicate' || flagged.some((f) => f.invoiceId === invoiceId && f.reason === 'page_duplicate');
    const result: SettleResult = {
      hold: (merged && first.invoiceId === invoiceId) || currentIsDuplicate || transientHold,
      absorbed,
      ...(absorbed || (merged && first.invoiceId === invoiceId) ? { mergedInto: first.invoiceId } : {}),
      flagged,
    };
    return { result, ocr, match, superseded };
  });
  // Lock order vs a concurrent claim / decision can deadlock (40P01): Postgres
  // aborts one side; retry the settle (it is idempotent) at most twice.
  let outcome: Awaited<ReturnType<typeof attempt>>;
  for (let tries = 0; ; tries++) {
    try {
      outcome = await attempt();
      break;
    } catch (err) {
      if (tries < 2 && (err as { code?: string } | null)?.code === '40P01') continue;
      throw err;
    }
  }

  await (deps.enqueueOcr ?? enqueueIngestJobs)(outcome.ocr);
  if (outcome.superseded) await removeSupersededObject(db, restaurantId, outcome.superseded.from);
  for (const id of outcome.match) {
    try {
      await (deps.enqueueMatch ?? enqueueMatchInvoice)({ restaurantId, invoiceId: id });
    } catch (err) {
      console.warn(`[documents] failed to enqueue match for invoice=${id}`, err);
    }
  }
  return outcome.result;
}
