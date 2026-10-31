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
import { PAGE_ABSORBED_ACTION, PAGES_RECOMPOSED_ACTION, reopenForOcr, retireBlocker, retireInvoice } from './reocr';

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
  /** Single-page prints of pages already absorbed into this invoice (from the merge audit rows). */
  absorbedPrints?: PagePrint[];
  /** A page flag was set on this invoice earlier: it is a chain BREAK, never a candidate. */
  alreadyFlagged?: PageFlag | null;
}

/** What a page says: its totals and lines (for the duplicate check). */
export interface PagePrint {
  totalExclVat: string | null;
  totalInclVat: string | null;
  lines: Array<{ qty: string | null; total: string | null }>;
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Tolerant "same page": the same non-null total (incl. or excl. VAT), or at
 * least 80% of the lines overlapping (same quantity, total within ₪0.50 or
 * 0.5%). A re-shot photo is usually re-taken because the first was blurry, so
 * the two reads differ a little; an exact compare would merge it (lines doubled).
 */
export function samePage(a: PagePrint | undefined, b: PagePrint | undefined): boolean {
  if (!a || !b) return false;
  const [ai, bi, ae, be] = [num(a.totalInclVat), num(b.totalInclVat), num(a.totalExclVat), num(b.totalExclVat)];
  if ((ai !== null && ai > 0 && ai === bi) || (ae !== null && ae > 0 && ae === be)) return true;
  const n = Math.max(a.lines.length, b.lines.length);
  if (n === 0 || a.lines.length === 0 || b.lines.length === 0) return false;
  const free = [...b.lines];
  let matched = 0;
  for (const l of a.lines) {
    const lt = num(l.total);
    const i = free.findIndex((m) => {
      const mt = num(m.total);
      if (num(m.qty) !== num(l.qty) || lt === null || mt === null) return false;
      return Math.abs(lt - mt) <= Math.max(0.5, 0.005 * Math.max(Math.abs(lt), Math.abs(mt)));
    });
    if (i >= 0) {
      matched += 1;
      free.splice(i, 1);
    }
  }
  return matched / n >= 0.8;
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
 *  - nothing merges into a page 1 that is unreadable, carries NO header
 *    evidence (number, ח.פ., name), or was itself flagged;
 *  - a page flagged earlier is a chain BREAK (kept in the cluster, never a
 *    candidate, not re-flagged);
 *  - a page that is unreadable, a duplicate of an invoice OUTSIDE the
 *    cluster, a re-shot copy of ANY earlier page or absorbed page (samePage),
 *    or that disagrees with page 1 is flagged, and breaks the chain;
 *  - after the first break nothing merges into page 1; before it, a page with
 *    header evidence merges only when it agrees with page 1, and an
 *    evidence-less page continues the page right before it.
 */
export function decidePages(
  members: PageHeader[],
): { merge: PageHeader[]; flagged: Array<{ invoiceId: string; reason: PageFlag }> } {
  const [first, ...rest] = members;
  const merge: PageHeader[] = [];
  const flagged: Array<{ invoiceId: string; reason: PageFlag }> = [];
  if (!first) return { merge, flagged };
  const ids = new Set(members.map((m) => m.invoiceId));
  let broken = Boolean(first.unreadable || first.alreadyFlagged || !hasHeaderEvidence(first));
  const earlier: PagePrint[] = [];
  const remember = (m: PageHeader) => {
    if (m.print) earlier.push(m.print);
    for (const p of m.absorbedPrints ?? []) earlier.push(p);
  };
  remember(first);
  for (const page of rest) {
    if (page.alreadyFlagged) {
      broken = true; // its question is already asked: a break, not a candidate
      remember(page);
      continue;
    }
    let reason: PageFlag | null = null;
    if (page.unreadable) reason = 'page_unreadable';
    else if (page.duplicateOf && page.duplicateOf !== first.invoiceId && !ids.has(page.duplicateOf)) {
      reason = 'page_other_invoice'; // its number is ANOTHER invoice already on file
    }
    if (!reason) reason = pageMismatch(first, page);
    if (!reason && earlier.some((p) => samePage(p, page.print))) reason = 'page_duplicate';
    if (!reason && broken) reason = 'page_not_merged';
    if (reason) {
      flagged.push({ invoiceId: page.invoiceId, reason });
      broken = true;
    } else merge.push(page);
    remember(page);
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
      // A flagged page STAYS in the cluster: it already had its one question, so
      // it is never a merge candidate again, but it still BREAKS the chain.
      .filter((r) => isPageMime(r.mimeType))
      .map((r) => ({
        ...r,
        storagePath: r.storagePath!,
        invoiceId: r.invoiceId!,
        flag: r.error && (PAGE_FLAGS as readonly string[]).includes(r.error) ? (r.error as PageFlag) : null,
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
    const lineRows = (await tx.execute(sql`
      select l.invoice_id, l.qty_billed::text as qty, l.line_total::text as total
      from ${invoiceLines} l
      join ${invoices} i on i.id = l.invoice_id and i.restaurant_id = ${restaurantId}
      where l.invoice_id in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as Array<{
      invoice_id: string;
      qty: string | null;
      total: string | null;
    }>;
    const linesOf = new Map<string, PagePrint['lines']>();
    for (const l of lineRows) linesOf.set(l.invoice_id, [...(linesOf.get(l.invoice_id) ?? []), { qty: l.qty, total: l.total }]);
    // Single-page prints of pages already merged into a member (and of page 1
    // before its composed re-OCR): kept on the merge audit rows.
    const printRows = (await tx.execute(sql`
      select coalesce(after->>'absorbedInto', entity_id::text) as invoice_id, before->'print' as print
      from ${auditLog}
      where restaurant_id = ${restaurantId}
        and action in (${PAGE_ABSORBED_ACTION}, ${PAGES_RECOMPOSED_ACTION})
        and coalesce(after->>'absorbedInto', entity_id::text) in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})
        and before ? 'print'`)) as unknown as Array<{ invoice_id: string; print: PagePrint }>;
    const absorbedOf = new Map<string, PagePrint[]>();
    for (const p of printRows) absorbedOf.set(p.invoice_id, [...(absorbedOf.get(p.invoice_id) ?? []), p.print]);
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
            print: { totalExclVat: h.totalExclVat, totalInclVat: h.totalInclVat, lines },
            absorbedPrints: absorbedOf.get(h.invoiceId) ?? [],
            alreadyFlagged: flagOf.get(h.invoiceId) ?? null,
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
          // Keep page 1's single-page print before the re-OCR replaces its lines,
          // so a later re-shot of page 1 is still recognised as a duplicate.
          if (!(first.absorbedPrints ?? []).length) {
            await sp.insert(auditLog).values({
              restaurantId,
              userId: null,
              action: PAGES_RECOMPOSED_ACTION,
              entityType: 'invoice',
              entityId: first.invoiceId,
              before: { print: first.print } as never,
              after: { pages: [first.invoiceId, ...merging.map((m) => m.invoiceId)] } as never,
            });
          }
          if (!(await reopenForOcr(sp, restaurantId, first.invoiceId))) throw new Error('page 1 could not be re-opened');
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
      const duplicate = (id: string) =>
        flagOf.get(id) === 'page_duplicate' || flagged.some((f) => f.invoiceId === id && f.reason === 'page_duplicate');
      for (const id of settledIds) if (!ran.has(id) && byId.get(id)?.status === 'matched' && !duplicate(id)) match.push(id);
    }

    const absorbed = merged && merging.some((m) => m.invoiceId === invoiceId);
    // A re-shot duplicate is never auto-matched: it waits for a person.
    const currentIsDuplicate =
      flagOf.get(invoiceId) === 'page_duplicate' || flagged.some((f) => f.invoiceId === invoiceId && f.reason === 'page_duplicate');
    const result: SettleResult = {
      hold: (merged && first.invoiceId === invoiceId) || currentIsDuplicate,
      absorbed,
      ...(absorbed || (merged && first.invoiceId === invoiceId) ? { mergedInto: first.invoiceId } : {}),
      flagged,
    };
    return { result, ocr, match };
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
  for (const id of outcome.match) {
    try {
      await (deps.enqueueMatch ?? enqueueMatchInvoice)({ restaurantId, invoiceId: id });
    } catch (err) {
      console.warn(`[documents] failed to enqueue match for invoice=${id}`, err);
    }
  }
  return outcome.result;
}
