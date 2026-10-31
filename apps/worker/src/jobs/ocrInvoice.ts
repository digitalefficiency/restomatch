import {
  buildDevOcrStub,
  fillEnglishNames,
  isAllowedScanUrl,
  meterOcrScan,
  signedUrlForStoragePath,
  receiptState,
  scanReceiptToStamp,
  withScanGrId,
} from '@restomatch/api';
import { matchProductTopN, MockEmbeddingProvider } from '@restomatch/catalog';
import { HELD_FOR_RECEIPTS_KEY, receiptsBeingCountedForScan } from '@restomatch/charts';
import { and, eq, findDemoTenants, invoiceLines, invoices, ne, restaurants, sql, suppliers, type Database } from '@restomatch/db';
import {
  ClaudeVision,
  runOcrPipeline,
  StubOcrProvider,
  type CatalogMatcherFn,
  type OcrProvider,
} from '@restomatch/ocr';
import { enqueueMatchInvoice, ocrJobDeadlineMs, TERMINAL_JOB_ERROR } from '@restomatch/queue';
import type { InvoiceOcrResult, OcrInvoiceJob } from '@restomatch/types';
import { makeWorker, type WorkerJob } from '../queue';
import { jobDb } from '../db';
import { findJobInvoice } from './findJobInvoice';

export type { OcrInvoiceJob };

const embedder = new MockEmbeddingProvider(1536);

/**
 * Who gets which OCR (pilot gate, OCR-A).
 *
 *   'claude'   — real Claude Vision: ANTHROPIC_API_KEY is set AND the restaurant
 *                is listed in OCR_REAL_RESTAURANT_IDS (comma-separated UUIDs).
 *                Unset / empty list = nobody. The ONLY mode that is metered.
 *   'stub'     — the demo identity only (packages/db demoTenants: כפר הזיתים and
 *                its branches), and only for a receiving scan (job carries grId):
 *                a deterministic "extraction" built from the receipt's PO, with
 *                invoice numbers prefixed DEMO-. It fabricates lines, so it is
 *                NEVER given to any other tenant.
 *   'disabled' — everyone else: no provider call, no meter; the invoice is
 *                marked OCR-failed with reason 'ocr_disabled' so the receiver
 *                continues by hand.
 *
 * The demo's password was exposed: the demo must never reach a paid call, so
 * the allowlist check comes first and the demo is simply never listed.
 */
export type OcrMode = 'claude' | 'stub' | 'disabled';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Malformed OCR_REAL_RESTAURANT_IDS entries already warned about (one warning each per process). */
const warnedEntries = new Set<string>();

/** The restaurants listed in OCR_REAL_RESTAURANT_IDS (lower-cased UUIDs). Malformed entries are ignored. */
export function ocrRealRestaurantIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const ids = new Set<string>();
  for (const part of (env.OCR_REAL_RESTAURANT_IDS ?? '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    if (UUID_RE.test(entry)) {
      ids.add(entry.toLowerCase());
    } else if (!warnedEntries.has(entry)) {
      warnedEntries.add(entry);
      console.warn(`[ocr-invoice] OCR_REAL_RESTAURANT_IDS: ignoring an entry that is not a UUID (${entry.length} chars)`);
    }
  }
  return ids;
}

/** The restaurants that get real OCR right now: none without ANTHROPIC_API_KEY. */
export function claudeOcrRestaurantIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  if (!env.ANTHROPIC_API_KEY) return new Set();
  return ocrRealRestaurantIds(env);
}

/**
 * Is `restaurantId` one of the demo tenants? By identity (findDemoTenants), never
 * by name alone. When the demo set is mixed with real data findDemoTenants
 * refuses — then nobody counts as demo (fail closed → 'disabled').
 */
export async function isDemoTenant(db: Database, restaurantId: string): Promise<boolean> {
  try {
    const client = (db as unknown as { $client: Parameters<typeof findDemoTenants>[0] }).$client;
    const demo = await findDemoTenants(client);
    return demo.restaurants.some((r) => r.id.toLowerCase() === restaurantId.toLowerCase());
  } catch (err) {
    console.warn('[ocr-invoice] demo-tenant check failed — treating the tenant as non-demo', err instanceof Error ? err.message.split('\n')[0] : err);
    return false;
  }
}

export async function ocrModeFor(
  restaurantId: string,
  opts: { grId?: string; env?: NodeJS.ProcessEnv; isDemo: (restaurantId: string) => Promise<boolean> },
): Promise<OcrMode> {
  if (claudeOcrRestaurantIds(opts.env ?? process.env).has(restaurantId.toLowerCase())) return 'claude';
  if (opts.grId && (await opts.isDemo(restaurantId))) return 'stub';
  return 'disabled';
}

/** The string entries of an unknown value that should be a string[] (else none). */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64) : [];
}

/** A scan object name under `<restaurantId>/` (mirrors @restomatch/api ingest/store SCAN_OBJECT_NAME). */
const SCAN_OBJECT_NAME = /^scan-[a-z0-9]+-[a-f0-9]+(?:\.[a-z0-9]{1,5})?$/;

/**
 * The URL a real read fetches for the scan on the invoice ROW (review #3). The
 * row is the trust boundary — the payload's imageUrl is never used.
 *
 *   - a full URL (has a scheme): returned as is; the caller's isAllowedScanUrl
 *     pins it to our signed invoice-scans bucket (SSRF), as before;
 *   - a bare storage path (G-09 #190 stores `<restaurantId>/<scan>` once
 *     STORE_OBJECT_PATH lands): accepted ONLY when it is exactly
 *     `<row's restaurantId>/scan-<id>-<hex>[.<ext>]` (an allowlist: no '%', no
 *     control characters, no sub-folders, no '?' / '#'), then signed now
 *     (bucket TTL, ingest/store.ts) — an old row never fails on an expired URL;
 *   - anything else, or a 4xx from storage while signing: null (refused). A
 *     5xx / network error while signing is THROWN, so the job retries it.
 *
 * TODO(G-09): swap to toObjectRef/signObjectRef once #190 is on main.
 */
export async function rowScanUrl(restaurantId: string, stored: string): Promise<string | null> {
  const value = stored.trim();
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  // An exact allowlist (`<restaurantId>/scan-<id>-<hex>[.<ext>]`, what our
  // writers store), not a '..' blacklist: '%2e%2e', '.%2E' or a tab/CR/LF-split
  // '..' would pass a blacklist, and storage-js signs the concatenated path.
  // Same pattern as signedUrlForStoragePath (@restomatch/api ingest/store).
  if (!(restaurantId && value.startsWith(`${restaurantId}/`) && SCAN_OBJECT_NAME.test(value.slice(restaurantId.length + 1)))) {
    return null;
  }
  try {
    return await signedUrlForStoragePath(restaurantId, value);
  } catch (err) {
    // A 4xx from storage (no such object, bad request) will not get better: the
    // scan is refused. Anything else (5xx, 'fetch failed', a timeout) is
    // rethrown, so classifyOcrError retries it instead of refusing for good.
    const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status ?? (err as { statusCode?: unknown } | null)?.statusCode;
    const code = Number(status);
    if (Number.isFinite(code) && code >= 400 && code < 500) {
      console.warn(`[ocr-invoice] signing the scan path was refused by storage (${code})`);
      return null;
    }
    throw err;
  }
}

/** Thrown when a read outlives its per-job deadline — retryable (message says "timed out"). */
export class OcrDeadlineError extends Error {
  constructor(ms: number) {
    super(`OCR read timed out after ${ms}ms (per-job deadline)`);
    this.name = 'OcrDeadlineError';
  }
}

/** `p`, or an OcrDeadlineError after `ms`. */
export async function withOcrDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OcrDeadlineError(ms)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** First 8 characters of an id, for logs. */
const short = (id: string) => id.slice(0, 8);

/** Token usage of the job's Claude call(s), for the one log line (no content). */
interface OcrUsage {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * $ per 1M tokens (input, output) — Anthropic list prices, 2026-10, the same
 * table as packages/ocr bench/run.ts (not exported there). Log-only estimate;
 * an unknown model logs usd=? rather than a guess.
 */
const OCR_PRICES_PER_MTOK: Readonly<Record<string, readonly [number, number]>> = {
  'claude-opus-4-8': [5, 25],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export function ocrCostUsd(usage: OcrUsage): number | null {
  const price = usage.model ? OCR_PRICES_PER_MTOK[usage.model] : undefined;
  if (!price) return null;
  return (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1e6;
}

function realProviders(usage?: OcrUsage): { documentAi: OcrProvider; claude: OcrProvider } {
  // ocrModeFor returned 'claude', so the key is set.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('OCR providers not configured — ANTHROPIC_API_KEY unset');

  // Claude-only pilot: Google Document AI is not yet wired. We hand the SAME
  // ClaudeVision instance to BOTH provider slots. M11: runOcrPipeline detects
  // the shared instance and calls it ONCE (was two paid Opus calls per scan);
  // the reconciler then sees full agreement (no conflicts → high confidence).
  //
  // PR1/A.1: the scan bucket is PRIVATE, so the invoice URL is a signed/expiring
  // URL. fetchBytes makes the worker fetch the bytes itself and send base64 —
  // Anthropic cannot reliably fetch a private/signed URL.
  const claude = new ClaudeVision({
    apiKey,
    model: process.env.OCR_CLAUDE_MODEL,
    fetchBytes: true,
    onUsage: (u) => {
      if (!usage) return;
      usage.inputTokens += u.input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
    },
  });
  if (usage) usage.model = process.env.OCR_CLAUDE_MODEL ?? OCR_DEFAULT_MODEL;
  return { documentAi: claude, claude };
}

/** packages/ocr ClaudeVision's default when OCR_CLAUDE_MODEL is unset (log only). */
const OCR_DEFAULT_MODEL = 'claude-opus-4-8';

/** One stub instance in both slots: the pipeline calls it once and sees full agreement. */
function stubProviders(result: InvoiceOcrResult): { documentAi: OcrProvider; claude: OcrProvider } {
  const stub = new StubOcrProvider('claude_vision', result);
  return { documentAi: stub, claude: stub };
}

/**
 * Test / local-QA hook: a payload's `mockProviders` (smoke scripts, the local
 * dev stub from receiving.registerInvoice). Outside production only — in
 * production a payload can never inject an extraction (payloads are not a
 * trust boundary, and the lines would be fabricated).
 */
function payloadMockProviders(job: OcrInvoiceJob): { documentAi: OcrProvider; claude: OcrProvider } | null {
  if (!job.mockProviders || process.env.NODE_ENV === 'production') return null;
  return {
    documentAi: new StubOcrProvider('document_ai', job.mockProviders.docAi),
    claude: new StubOcrProvider('claude_vision', job.mockProviders.claude),
  };
}

export function startOcrInvoiceWorker() {
  return makeWorker<OcrInvoiceJob>('ocr-invoice', processOcrInvoice);
}

/** The ocr-invoice job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processOcrInvoice(job: WorkerJob<OcrInvoiceJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  // Tenant guard: job payloads are not a trust boundary — verify the invoice
  // belongs to the payload's restaurant, and take supplierId from the verified
  // row rather than the payload. Re-read briefly first: the producer enqueues
  // before its transaction commits the row.
  const invoice = await findJobInvoice(db, job.data.restaurantId, job.data.invoiceId);
  if (!invoice) {
    // Terminal: a retry reads the same rows (the ocr-sweep retries a commit-race
    // refusal once, on its own — ocrSweep.ts NOT_FOUND_REFUSAL).
    throw new Error(
      `${TERMINAL_JOB_ERROR}[ocr-invoice] invoice=${job.data.invoiceId} not found in restaurant=${job.data.restaurantId} — refusing to process`,
    );
  }

  // One log line per job (mode, short ids, outcome) — never a URL or content.
  // A read also logs model, tokens, ms, estimated $ and the document kind.
  let mode: OcrMode | 'mock' = 'disabled';
  let outcome = '';
  const t0 = Date.now();
  const usage: OcrUsage = { model: null, inputTokens: 0, outputTokens: 0 };
  let read = false;
  const logLine = () => {
    const usd = ocrCostUsd(usage);
    const cost = read
      ? ` model=${usage.model ?? '-'} tokens=${usage.inputTokens}/${usage.outputTokens} ms=${Date.now() - t0}` +
        ` usd=${usd == null ? '?' : usd.toFixed(4)}`
      : '';
    console.log(
      `[ocr-invoice] mode=${mode} restaurant=${short(job.data.restaurantId)} invoice=${short(job.data.invoiceId)}` +
        (outcome ? ` ${outcome}` : '') +
        cost,
    );
  };

  // Only an invoice still waiting for its read is read: a retry / duplicate job
  // must never overwrite a read (or a human's correction) already on file.
  if (invoice.status !== 'ocr_pending') {
    mode = 'disabled';
    outcome = `skipped=not_pending status=${invoice.status}`;
    logLine();
    return { invoiceId: job.data.invoiceId, skipped: 'not_pending' as const };
  }

  // Everything from here runs inside the classified try (review #5): a failure
  // before the read (the demo-tenant lookup, the stub build, a missing key) used
  // to dead-letter the job and leave the invoice 'ocr_pending' forever.
  try {
    const mock = payloadMockProviders(job.data);
    mode = mock ? 'mock' : await ocrModeFor(job.data.restaurantId, { grId: job.data.grId, isDemo: (id) => isDemoTenant(db, id) });

    let providers: { documentAi: OcrProvider; claude: OcrProvider };
    // The scan on the ROW, never the payload's URL. A real read resolves it to a
    // fetchable URL (a bare storage path is signed at read time — review #3).
    let imageUrl = invoice.rawImageUrl ?? '';
    if (mode === 'claude') imageUrl = (await rowScanUrl(job.data.restaurantId, imageUrl)) ?? '';
    if (mode === 'disabled') {
      await markOcrFailed(db, job.data.restaurantId, job.data.invoiceId, null, 'ocr_disabled');
      outcome = 'skipped=ocr_disabled';
      return { invoiceId: job.data.invoiceId, skipped: 'ocr_disabled' as const };
    }
    if (mode === 'claude' && !isAllowedScanUrl(imageUrl)) {
      // Re-checked here: the row is the trust boundary, not the producer.
      await markOcrFailed(db, job.data.restaurantId, job.data.invoiceId, null, 'scan_url_refused');
      outcome = 'skipped=scan_url_refused';
      return { invoiceId: job.data.invoiceId, skipped: 'scan_url_refused' as const };
    }
    if (mode === 'stub') {
      const stub = job.data.grId
        ? await buildDevOcrStub(db, job.data.restaurantId, job.data.grId, { invoicePrefix: 'DEMO-' })
        : null;
      if (!stub) {
        // A receipt with no PO lines: nothing to build, and nothing is made up.
        await markOcrFailed(db, job.data.restaurantId, job.data.invoiceId, null, 'ocr_disabled');
        outcome = 'skipped=no_po_lines';
        return { invoiceId: job.data.invoiceId, skipped: 'ocr_disabled' as const };
      }
      providers = stubProviders(stub);
    } else {
      providers = mock ?? realProviders(usage);
    }

    // Metered once per scan: the retry of a transient failure (attempt 2) is the
    // same scan, not a second one.
    if ((mode === 'claude' || mode === 'mock') && (job.attemptsMade ?? 0) === 0) {
      // Authoritative usage metering — counts the scan and enforces the plan's
      // monthly OCR cap here at the worker (race-safe), so the limit can't be
      // bypassed by enqueuing jobs directly. No-op for restaurants without a
      // billing account (implicit trial). Throws QuotaExceededError when over cap.
      // Only a real read is metered ('mock' = the non-production test hook,
      // metered like the real read it stands in for); the demo stub never is.
      await meterOcrScan(db, job.data.restaurantId);
    }

    const matcher: CatalogMatcherFn = async (line) => {
      const embedding = await embedder.embed(line.rawDescription);
      const candidates = await matchProductTopN(
        db,
        {
          restaurantId: job.data.restaurantId,
          supplierId: invoice.supplierId,
          rawDescription: line.rawDescription,
          // מק״ט from the invoice — strategy-0 exact key when the supplier prints it.
          supplierSku: line.sku ?? undefined,
          embedding,
        },
        3,
      );
      return candidates.map((c) => ({
        productId: c.productId,
        canonicalName: c.canonicalName,
        confidence: c.confidence,
        matchedBy: c.matchedBy,
      }));
    };

    // Per-restaurant review threshold (falls back to pipeline default)
    const restaurant = await db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, job.data.restaurantId))
      .limit(1);
    const reviewThreshold = restaurant[0]?.settings?.ocrReviewThreshold;

    read = true;
    // A per-job deadline (review #10): the read must end before the invocation's
    // headroom does. Hitting it is a retryable timeout (attempt 2 in a later run),
    // never an in-job retry. The provider call itself is not cancelled (the
    // ClaudeVision API takes no signal yet — S14): its result is just not waited for.
    const result = await withOcrDeadline(
      runOcrPipeline(imageUrl, {
        ...providers,
        catalogMatcher: matcher,
        ...(reviewThreshold !== undefined ? { reviewThreshold } : {}),
      }),
      ocrJobDeadlineMs(),
    );

    const r = result.reconciled;
    // From the provider's own extraction: the reconciler keeps only the fields it
    // compares, so documentKind / billingPeriod / deliveryNotes live on `primary`.
    const facts = documentFacts({ ...(result.primary ?? {}), ...r });
    // The receipt this photo was taken on — so a receipt submit claims exactly
    // its own scans (receiving/matchTriggers), never a same-day sibling's.
    const scanGrId = await scanReceiptToStamp(db, job.data.restaurantId, job.data.grId, invoice.supplierId);
    // What holds the invoice for a human instead of the auto-match (PR-OCR-2b):
    //  - a document that is not an ordinary tax invoice (doc_kind_<kind>);
    //  - a consolidated invoice (חשבונית ריכוז) is never single-PO matched: it is
    //    cross-matched against its delivery notes (match/consolidated.ts) — and
    //    with no known supplier there is nothing to cross-match, so a human.
    const reviewReasons: string[] = [];
    if (facts.kind !== 'tax_invoice' && facts.kind !== 'consolidated') reviewReasons.push(`doc_kind_${facts.kind}`);
    // Explicit, so a link-only release (G-08) can never flip a ריכוז to 'matched'.
    if (facts.kind === 'consolidated') reviewReasons.push('consolidated');
    if (facts.kind === 'consolidated' && !invoice.supplierId) reviewReasons.push('consolidated_unknown_supplier');
    if (facts.consolidatedEvidence) reviewReasons.push('consolidated_evidence');
    //  - the ח.פ. printed on the document is not the one on file for the invoice's
    //    supplier (tenant-scoped): the wrong supplier, or a look-alike — a human.
    const businessIdMismatch = await supplierBusinessIdMismatch(db, job.data.restaurantId, invoice.supplierId, r.supplier?.businessId);
    if (businessIdMismatch) reviewReasons.push('supplier_id_mismatch');
    const holdForHuman =
      result.needsHumanReview || facts.kind !== 'tax_invoice' || businessIdMismatch || facts.consolidatedEvidence;
    // The pipeline's own reasons (G-08 link holds 'unlinked' / 'unlinkedPo', #174's
    // checks) are kept too — the de-duplicated union, never dropped (review #2).
    const pipelineReasons = [
      ...stringList((result as { reviewReasons?: unknown }).reviewReasons),
      ...stringList((result as { checks?: { reasons?: unknown } }).checks?.reasons),
    ];
    const allReasons = [...new Set([...pipelineReasons, ...reviewReasons])];

    // ONE copy of the extraction (the pipeline result repeats it as primary,
    // reconciled and both providers) + the keys the readers look for at the top
    // level of raw: kind / periodStart / periodEnd / deliveryNotes (consolidated
    // cross-match, supplier ledger coverage, inventory).
    const raw = withScanGrId(
      {
        reconciled: r,
        confidence: result.confidence,
        conflicts: result.conflicts,
        needsHumanReview: result.needsHumanReview,
        kind: facts.kind,
        ...(facts.kind === 'consolidated'
          ? { periodStart: facts.periodStart, periodEnd: facts.periodEnd, deliveryNotes: facts.deliveryNotes }
          : {}),
        ...(allReasons.length ? { reviewReasons: allReasons } : {}),
        ...((result as { checks?: unknown }).checks !== undefined ? { checks: (result as { checks?: unknown }).checks } : {}),
      },
      scanGrId,
    );

    // Header + lines in ONE transaction, written only while the invoice is still
    // 'ocr_pending': a second job (a sweep retry, a stalled run's twin) that read
    // the same scan meanwhile finds it taken and writes nothing — never a header
    // from one read over lines from another.
    const written = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      // Merge over what is already on the row (review #4): keys stamped before the
      // read — raw.scanGrId (S2's one-receipt-one-invoice resume), a link hold —
      // survive the read; the read's own keys win; reasons are united.
      const [cur] = await tx
        .select({ payload: invoices.ocrPayload })
        .from(invoices)
        .where(and(eq(invoices.id, job.data.invoiceId), eq(invoices.restaurantId, job.data.restaurantId)))
        .for('update');
      const prior = cur?.payload?.raw;
      const priorRaw = prior && typeof prior === 'object' && !Array.isArray(prior) ? (prior as Record<string, unknown>) : {};
      const reasons = [...new Set([...stringList(priorRaw.reviewReasons), ...stringList((raw as { reviewReasons?: unknown }).reviewReasons)])];
      const mergedRaw = { ...priorRaw, ...raw, ...(reasons.length ? { reviewReasons: reasons } : {}) };
      const header = await writeOcrHeader(
        tx,
        { restaurantId: job.data.restaurantId, invoiceId: job.data.invoiceId, supplierId: invoice.supplierId },
        {
          invoiceNumber: r.invoiceNumber ?? null,
          invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null,
          totalExclVat: r.totals.subtotal?.toString() ?? null,
          vatAmount: r.totals.vat?.toString() ?? null,
          totalInclVat: r.totals.total?.toString() ?? null,
          allocationNumber: r.allocationNumber ?? null,
          ocrPayload: { provider: 'reconciled', raw: mergedRaw, reconciledAt: new Date().toISOString() },
          ocrConfidence: result.confidence.toString(),
          status: holdForHuman ? 'parsed' : 'matched',
        },
        { onlyPending: true },
      );
      if (header.written === false) return header;
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, job.data.invoiceId));
      if (r.lines.length > 0) {
        await tx.insert(invoiceLines).values(
          r.lines.map((line) => ({
            invoiceId: job.data.invoiceId,
            productId: line.productId,
            supplierSku: line.sku ?? null,
            rawDescription: line.rawDescription,
            // "Receiver in English": Claude Vision returns it in the same call.
            rawDescriptionEn: line.rawDescriptionEn ?? null,
            qtyBilled: line.qty.toString(),
            unit: line.unit,
            unitPriceBilled: line.unitPrice.toString(),
            lineTotal: line.lineTotal.toString(),
            vatRate: line.vatRate?.toString() ?? null,
            ocrConfidenceLine: line.confidence?.toString() ?? null,
          })),
        );
      }
      return header;
    });
    if (written.written === false) {
      outcome = `skipped=already_read kind=${facts.kind}`;
      return { invoiceId: job.data.invoiceId, skipped: 'already_read' as const };
    }
    const { duplicateOf } = written;
    // A number already on file holds the invoice for a human (no auto-match).
    const needsHumanReview = holdForHuman || duplicateOf !== undefined;

    // Fill any English the extraction didn't carry (stub / Document AI lines)
    // plus the linked products' name_en — glossary first, Claude only when
    // keyed. Display-only; a failure here must never fail the OCR job.
    try {
      await fillEnglishNames(db, job.data.restaurantId, { invoiceId: job.data.invoiceId });
    } catch (err) {
      console.warn(`[ocr-invoice] English fill failed for invoice=${job.data.invoiceId}`, err);
    }

    outcome =
      `kind=${facts.kind} confidence=${result.confidence.toFixed(2)} conflicts=${result.conflicts.length} ` +
      `lines=${r.lines.length} needsReview=${needsHumanReview}` +
      (duplicateOf !== undefined ? ` duplicateOf=${duplicateOf ? short(duplicateOf) : 'unknown'}` : '');

    // Chain into the 3-way PO↔invoice match when OCR is confident enough to
    // auto-proceed. Low-confidence (parsed / needs-review) invoices wait for a
    // human to confirm product matches first (match.runForInvoice on demand).
    // A queue failure must never break the OCR persistence above.
    const decision: OcrMatchHold = needsHumanReview
      ? { match: false }
      : await ocrAutoMatchHold(db, job.data.restaurantId, job.data.grId, { invoiceId: job.data.invoiceId });
    // Held for a receipt's count: say so on the invoice, so the owner's screens show
    // "waiting for the count", not "waiting to be linked to an order" (#94).
    if (decision.heldFor?.length) {
      await markHeldForCount(db, job.data.restaurantId, job.data.invoiceId, decision.heldFor);
    }
    if (decision.match) {
      try {
        // A variable, not a literal: compiles on either queue job shape (#49).
        const matchJob: Parameters<typeof enqueueMatchInvoice>[0] & { poId?: string } = {
          restaurantId: job.data.restaurantId,
          invoiceId: job.data.invoiceId,
          ...(decision.poId ? { poId: decision.poId } : {}),
        };
        await enqueueMatchInvoice(matchJob);
      } catch (err) {
        console.warn(
          `[ocr-invoice] failed to enqueue match for invoice=${job.data.invoiceId}`,
          err,
        );
      }
    }

    return {
      invoiceId: job.data.invoiceId,
      confidence: result.confidence,
      needsHumanReview,
      conflicts: result.conflicts.length,
      lines: r.lines.length,
    };
  } catch (err) {
    // EN-3: a failed OCR used to leave the invoice in 'ocr_pending' forever
    // (the receiver's wizard spun until it gave up). On the FINAL attempt
    // move it to a terminal, reviewable state the UI can show.
    // A terminal failure (classifyOcrError) is final at once: a retry is a
    // second paid call that fails the same way.
    const raw = job as { attemptsMade?: number; opts?: { attempts?: number } };
    const kind = classifyOcrError(err);
    const final = kind.retryable === false || (raw.attemptsMade ?? 0) + 1 >= (raw.opts?.attempts ?? 1);
    if (final) {
      await markOcrFailed(db, job.data.restaurantId, job.data.invoiceId, err, kind.reason).catch((e) =>
        console.error(`[ocr-invoice] could not mark invoice=${job.data.invoiceId} failed`, e),
      );
    }
    outcome = `failed=${err instanceof Error ? err.name : 'error'} class=${kind.retryable ? 'retryable' : 'terminal'}${final ? '' : ' retry=1'}`;
    if (!kind.retryable && err instanceof Error && !err.message.startsWith(TERMINAL_JOB_ERROR)) {
      err.message = `${TERMINAL_JOB_ERROR}${err.message}`;
    }
    throw err;
  } finally {
    logLine();
  }
}

/**
 * What kind of document the read was, from the extraction (S14 PR-OCR-2 /
 * claude/pilot-ocr-consolidated add documentKind, billingPeriod, deliveryNotes).
 * Read loosely: an extraction without them (today's, the stub) is an ordinary
 * tax invoice. `kind` is what `ocr_payload.raw.kind` stores — 'consolidated' is
 * the value match/consolidated.ts and ledger/coverage.ts look for.
 */
export interface DocumentFacts {
  kind: string;
  /** Consolidated only: the billed period, local dates 'YYYY-MM-DD'. */
  periodStart: string | null;
  periodEnd: string | null;
  /** The delivery notes (ת.מ.) the document lists, by canonical number (written for consolidated only). */
  deliveryNotes: Array<{ number: string; printed?: string }>;
  /**
   * A document read as an ordinary invoice that nonetheless carries the marks of
   * a consolidated one (≥ 2 distinct delivery-note numbers, or a printed billing
   * period): held for a human ('consolidated_evidence'), never auto-matched.
   */
  consolidatedEvidence: boolean;
}

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONSOLIDATED_KINDS = new Set(['consolidated', 'consolidated_invoice', 'monthly_consolidated']);
const TAX_INVOICE_KINDS = new Set(['tax_invoice', 'invoice', 'tax_invoice_receipt']);
/** A printed delivery-note label in front of the number: ת.מ. / ת"מ / ת״מ / תעודת משלוח / DN / D.N. / No. */
const NOTE_PREFIX = /^(?:תעודת\s*משלוח|ת\s*[.״"']?\s*מ\s*[.׳']?|d\s*\.?\s*n\s*\.?|no\s*\.?|מס['׳]?)\s*[:#.\-]?\s*/i;

/**
 * A delivery-note number as written, reduced to its digit run: the printed label
 * (ת.מ., DN …) is stripped. A range ("1201-1205") or a list ("1201, 1202") is not
 * ONE note and is rejected (null), as is anything that is not a digit run.
 */
export function canonicalNoteNumber(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v !== 'string') return null;
  let t = v.trim();
  for (let k = 0; k < 2 && NOTE_PREFIX.test(t); k++) t = t.replace(NOTE_PREFIX, '').trim();
  return /^\d{1,20}$/.test(t) ? t : null;
}

/**
 * What kind of document the read was, from the extraction's documentKind /
 * consolidation / billingPeriod / deliveryNotes (the fields #174 / S14 add to
 * the reconciled result). Read loosely: an extraction without them (today's, the
 * stub) is an ordinary tax invoice. `kind` is what `ocr_payload.raw.kind`
 * stores — 'consolidated' is what match/consolidated.ts and ledger/coverage.ts
 * look for. When the extraction carries an explicit `consolidation` verdict it
 * wins over a bare documentKind.
 */
export function documentFacts(extraction: unknown): DocumentFacts {
  const e = (extraction ?? {}) as Record<string, unknown>;
  const rawKind = typeof e.documentKind === 'string' ? e.documentKind.trim().toLowerCase() : '';
  const consolidation = typeof e.consolidation === 'string' ? e.consolidation : null;
  const kind =
    consolidation === 'consolidated'
      ? 'consolidated'
      : !rawKind || TAX_INVOICE_KINDS.has(rawKind) || (CONSOLIDATED_KINDS.has(rawKind) && consolidation === 'regular')
        ? 'tax_invoice'
        : CONSOLIDATED_KINDS.has(rawKind)
          ? 'consolidated'
          : rawKind.replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  const period = (e.billingPeriod ?? {}) as Record<string, unknown>;
  const day = (v: unknown) => (typeof v === 'string' && LOCAL_DAY.test(v.trim()) ? v.trim() : null);
  const notes = Array.isArray(e.deliveryNotes) ? e.deliveryNotes : [];
  const byNumber = new Map<string, { number: string; printed?: string }>();
  for (const n of notes) {
    const v = typeof n === 'object' && n !== null ? (n as { number?: unknown }).number : n;
    const number = canonicalNoteNumber(v);
    if (!number || byNumber.has(number)) continue;
    const printed = typeof v === 'string' && v.trim() !== number ? v.trim().slice(0, 64) : undefined;
    byNumber.set(number, printed ? { number, printed } : { number });
  }
  const periodStart = day(period.start ?? period.from ?? e.periodStart);
  const periodEnd = day(period.end ?? period.to ?? e.periodEnd);
  return {
    kind,
    periodStart,
    periodEnd,
    deliveryNotes: [...byNumber.values()],
    consolidatedEvidence: kind === 'tax_invoice' && (byNumber.size >= 2 || periodStart !== null || periodEnd !== null),
  };
}

/**
 * A ח.פ. / ע.מ. / ת.ז. as 9 canonical digits, or null (= unknown, never a
 * mismatch). The SAME semantics as S14's `normalizeBusinessId` in @restomatch/ocr
 * (checks.ts), which replaces this copy once it is on main:
 * digits only (spaces, dashes, a "ח.פ." label dropped); a 10-digit value with a
 * leading 0 loses it; 8–9 digits are padded to 9; any other length → null; the
 * Israeli check digit must hold (weights 1,2,1,2…, digit-sum of products).
 */
export function normalizeBusinessId(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  let digits = String(v).replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 8 || digits.length > 9) return null;
  const id = digits.padStart(9, '0');
  let sum = 0;
  for (let k = 0; k < 9; k++) {
    const p = Number(id[k]) * (k % 2 === 0 ? 1 : 2);
    sum += p > 9 ? p - 9 : p;
  }
  return sum % 10 === 0 ? id : null;
}

/**
 * True when the document prints a ח.פ. AND the invoice's supplier (this tenant's
 * row only) has one on file AND they differ. Unknown on either side is not a
 * mismatch (nothing to compare — never guessed). A failed lookup is logged and
 * treated as no mismatch: it must not fail the read.
 */
export async function supplierBusinessIdMismatch(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  printed: unknown,
): Promise<boolean> {
  const onDocument = normalizeBusinessId(printed);
  if (!supplierId || !onDocument) return false;
  try {
    const [row] = await db
      .select({ businessId: suppliers.businessId })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.restaurantId, restaurantId)))
      .limit(1);
    const onFile = normalizeBusinessId(row?.businessId);
    return onFile !== null && onFile !== onDocument;
  } catch (err) {
    console.warn(`[ocr-invoice] supplier ח.פ. lookup failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

type InvoiceHeader = Pick<
  typeof invoices.$inferInsert,
  | 'invoiceNumber'
  | 'invoiceDate'
  | 'totalExclVat'
  | 'vatAmount'
  | 'totalInclVat'
  | 'allocationNumber'
  | 'ocrPayload'
  | 'ocrConfidence'
  | 'status'
>;

/** Postgres unique violation on invoices_dedupe_idx (supplier_id, invoice_number). */
function isInvoiceNumberTaken(err: unknown): boolean {
  for (let e = err; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505') return pg.constraint_name === 'invoices_dedupe_idx';
  }
  return false;
}

/**
 * Write the OCR header onto the invoice. invoices_dedupe_idx is UNIQUE on
 * (supplier_id, invoice_number), so a scan whose number is already on file for
 * this supplier (the same paper photographed twice, or a supplier billing
 * twice) used to throw here: the job failed and the receiver lost the whole
 * read. Keep the read instead, without the number, record which invoice holds
 * it, and leave the row for a human (status 'parsed').
 *
 * `duplicateOf` is undefined when the number was free, else the id of the
 * invoice that already carries it (null if that row could not be found).
 */
export async function writeOcrHeader(
  db: Database,
  ids: { restaurantId: string; invoiceId: string; supplierId: string | null },
  header: InvoiceHeader,
  opts: { onlyPending?: boolean } = {},
): Promise<{ duplicateOf?: string | null; written?: false }> {
  // onlyPending: write only while the invoice still waits for its read
  // (`written: false` when another read got there first).
  const where = and(
    eq(invoices.id, ids.invoiceId),
    eq(invoices.restaurantId, ids.restaurantId),
    ...(opts.onlyPending ? [eq(invoices.status, 'ocr_pending')] : []),
  );
  // Blank → NULL: the prompt allows '' for an unreadable number, and '' is a
  // value to the unique index (a second blank collides); NULLs never do.
  const invoiceNumber = header.invoiceNumber?.trim() || null;
  header = { ...header, invoiceNumber };
  try {
    // A savepoint: inside the caller's transaction a unique violation would
    // otherwise abort it, and the number-less retry below could not run.
    const rows = await db.transaction((sp) =>
      (sp as unknown as Database).update(invoices).set(header).where(where).returning({ id: invoices.id }),
    );
    return rows.length > 0 ? {} : { written: false };
  } catch (err) {
    if (!invoiceNumber || !isInvoiceNumberTaken(err)) throw err;
  }

  // supplier_id NULL never conflicts (NULLs are distinct), so it is set here.
  const [existing] = ids.supplierId
    ? await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.restaurantId, ids.restaurantId),
            eq(invoices.supplierId, ids.supplierId),
            eq(invoices.invoiceNumber, invoiceNumber),
            ne(invoices.id, ids.invoiceId),
          ),
        )
        .limit(1)
    : [];
  const duplicateOf = existing?.id ?? null;
  const payload = header.ocrPayload;
  const rows = await db
    .update(invoices)
    .set({
      ...header,
      invoiceNumber: null,
      status: 'parsed',
      ocrPayload: payload
        ? {
            ...payload,
            raw: {
              ...(payload.raw as object),
              duplicateOf: { invoiceId: duplicateOf, invoiceNumber },
            },
          }
        : payload,
    })
    .where(where)
    .returning({ id: invoices.id });
  return rows.length > 0 ? { duplicateOf } : { duplicateOf, written: false };
}

/**
 * Terminal OCR failure: status 'parsed' (= needs a human) with confidence 0 and
 * a machine-readable failure marker in ocr_payload (`raw.ocrFailed`). The
 * receiving UI reads it via receiving.getInvoice → `ocrFailed` and lets the
 * receiver continue against the order. No invoice lines are written, so no
 * ₪ discrepancy is ever computed from a failed read.
 *
 * `forced` names a reason that is not an error: 'ocr_disabled' (the tenant is
 * not on the real-OCR allowlist — nothing was read or metered) and
 * 'scan_url_refused' (the row's URL is not one of our signed scan URLs).
 */
export type OcrFailureReason =
  | 'quota_exceeded'
  | 'extraction_failed'
  | 'ocr_disabled'
  | 'scan_url_refused'
  | 'unsupported_format'
  | 'stalled';

/**
 * Retry or not (ocr-invoice has 2 attempts — packages/queue MAX_ATTEMPTS).
 *
 * Retryable — transient, the same scan may read next time: HTTP 429 / 5xx /
 * 529 (overloaded) from Anthropic or the scan fetch, timeouts and dropped
 * connections, and an answer that did not parse (no JSON / schema mismatch).
 *
 * Terminal — a retry fails the same way and costs another call: quota exceeded,
 * an unsupported or unreadable format (Anthropic 400 on the document, 4xx on the
 * scan fetch — an expired / missing signed URL), and anything unrecognised
 * (spend-safe default). The tenant guard and ocr_disabled never reach here (the
 * guard throws terminal before the read; disabled returns without a call).
 */
export function classifyOcrError(err: unknown): { retryable: boolean; reason?: OcrFailureReason } {
  const e = (err ?? {}) as { name?: string; message?: string; status?: number; code?: string; cause?: unknown };
  const name = e.name ?? '';
  const msg = e.message ?? String(err ?? '');
  if (name === 'QuotaExceededError') return { retryable: false, reason: 'quota_exceeded' };
  const status = typeof e.status === 'number' ? e.status : Number(/\((\d{3})\)/.exec(msg)?.[1] ?? NaN);
  if (status === 429 || status >= 500) return { retryable: true };
  if (/timed? ?out|timeout/i.test(msg) || /Timeout|AbortError/.test(name)) return { retryable: true };
  if (name === 'APIConnectionError' || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i.test(`${msg} ${e.code ?? ''}`)) {
    return { retryable: true };
  }
  if (name === 'ZodError' || name === 'SyntaxError' || /no JSON object found|Unexpected token|JSON/i.test(msg)) return { retryable: true };
  if (status >= 400 && status < 500) return { retryable: false, reason: 'unsupported_format' };
  if (/unsupported|media.?type|could not process image|invalid image/i.test(msg)) return { retryable: false, reason: 'unsupported_format' };
  return { retryable: false, reason: 'extraction_failed' };
}

export async function markOcrFailed(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  err: unknown,
  forced?: OcrFailureReason,
): Promise<void> {
  const reason: OcrFailureReason =
    forced ?? (err instanceof Error && err.name === 'QuotaExceededError' ? 'quota_exceeded' : 'extraction_failed');
  await db
    .update(invoices)
    .set({
      status: 'parsed',
      ocrConfidence: '0',
      // MERGE into the raw already on the row: keys stamped before the read
      // (raw.scanGrId — the receipt the scan was taken on, which the
      // one-receipt-one-invoice resume keys on) survive a failed read. Only
      // ocrFailed / reason are set; a non-object raw is replaced.
      ocrPayload: sql`jsonb_build_object(
        'provider', 'claude_vision',
        'raw', (CASE WHEN jsonb_typeof(${invoices.ocrPayload} -> 'raw') = 'object'
                     THEN ${invoices.ocrPayload} -> 'raw' ELSE '{}'::jsonb END)
               || ${JSON.stringify({ ocrFailed: true, reason })}::jsonb,
        'reconciledAt', ${new Date().toISOString()}::text)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.restaurantId, restaurantId),
        eq(invoices.status, 'ocr_pending'),
      ),
    );
}

/**
 * May the OCR job chain into the match right away? Not while the scan's goods
 * receipt is still being counted (status 'pending'): its gr_lines are empty, so
 * the engine would read every line as short AND over-billed and the leak hero
 * would jump by the whole invoice. receiving.submitReceipt enqueues the match
 * once the count is in. Scans with no receipt (email / WhatsApp / upload) and
 * receipts already submitted match at once.
 *
 * A receiving photo whose job lost its receipt (`scan` given, no grId — an OCR
 * sweep retry of a lost enqueue) must not match blind either: discovery would
 * take a same-supplier sibling PO whose receipt is already closed, and the
 * submit never repairs a run on another receipt. See receiptLostDecision.
 */
export async function ocrAutoMatchDecision(
  db: Database,
  restaurantId: string,
  grId: string | undefined,
  scan?: { invoiceId: string },
): Promise<{ match: boolean; poId?: string }> {
  const { heldFor: _heldFor, ...decision } = await ocrAutoMatchHold(db, restaurantId, grId, scan);
  return decision;
}

/** ocrAutoMatchDecision plus, when held, the receipts whose count it waits for. */
export interface OcrMatchHold {
  match: boolean;
  poId?: string;
  heldFor?: string[];
}

export async function ocrAutoMatchHold(
  db: Database,
  restaurantId: string,
  grId: string | undefined,
  scan?: { invoiceId: string },
): Promise<OcrMatchHold> {
  if (!grId) return scan ? receiptLostDecision(db, restaurantId, scan.invoiceId) : { match: true };
  try {
    // Takes the receipt lock: a submit in flight is waited for (receiving/matchTriggers).
    const state = await db.transaction((tx) => receiptState(tx as unknown as Database, restaurantId, grId));
    // Matched against the order that was counted, not a discovered sibling.
    return state.open ? { match: false, heldFor: [grId] } : { match: true, ...(state.poId ? { poId: state.poId } : {}) };
  } catch (err) {
    console.warn(`[ocr-invoice] receipt check failed for gr=${grId} — matching now`, err);
    return { match: true };
  }
}

/**
 * Record on the invoice the receipts whose count its match waits for:
 * ocr_payload.raw.heldForReceipts (charts awaiting-count.ts reads it — the hero /
 * pay run show "waiting for the count" while one of them is pending and no run
 * exists). Display only: a failure is logged, never fails the OCR job.
 */
export async function markHeldForCount(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  receiptIds: string[],
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE invoices
         SET ocr_payload = jsonb_set(ocr_payload, ${`{raw,${HELD_FOR_RECEIPTS_KEY}}`}::text[], ${JSON.stringify(receiptIds)}::jsonb, true)
       WHERE id = ${invoiceId} AND restaurant_id = ${restaurantId}
         AND jsonb_typeof(ocr_payload -> 'raw') = 'object'`);
  } catch (err) {
    console.warn(`[ocr-invoice] could not record the receipt hold on invoice=${invoiceId}`, err);
  }
}

/**
 * The OCR decision for a scan whose job carries no receipt. A photo scan whose
 * supplier has a receipt being counted, opened shortly before the scan
 * (receiptsBeingCountedForScan — the same rule the leak hero shows as "waiting
 * for the count"), is held: that receipt's submit finds it server-side
 * (invoicesWaitingOnReceipt) and matches it against the receipt's own PO.
 * Each such receipt is read under its lock, so a submit in flight is waited for;
 * if the only one closed meanwhile, the match is pinned to its PO (the submit may
 * have looked before this scan finished reading). Email / WhatsApp / manual
 * scans, and photos with no such receipt, match at once. A failing check matches
 * now (logged), like the receipt check above.
 */
async function receiptLostDecision(db: Database, restaurantId: string, invoiceId: string): Promise<OcrMatchHold> {
  try {
    return await db.transaction(async (raw) => {
      const tx = raw as unknown as Database;
      const res = await tx.execute(
        sql`${receiptsBeingCountedForScan(restaurantId, invoiceId)} ORDER BY g.created_at DESC, g.id`,
      );
      const ids = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])).map((r) =>
        String((r as { id: unknown }).id),
      );
      if (ids.length === 0) return { match: true };
      const states: Array<{ open: boolean; poId: string | null }> = [];
      for (const id of ids) states.push(await receiptState(tx, restaurantId, id));
      const open = ids.filter((_, i) => states[i]!.open);
      if (open.length) return { match: false, heldFor: open };
      const only = states.length === 1 ? states[0]!.poId : null;
      return only ? { match: true, poId: only } : { match: true };
    });
  } catch (err) {
    console.warn(`[ocr-invoice] receipt lookup failed for invoice=${invoiceId} — matching now`, err);
    return { match: true };
  }
}

/** Whether the OCR job may match right away (see ocrAutoMatchDecision). */
export async function ocrMayAutoMatch(
  db: Database,
  restaurantId: string,
  grId: string | undefined,
): Promise<boolean> {
  return (await ocrAutoMatchDecision(db, restaurantId, grId)).match;
}
