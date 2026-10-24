import { fillEnglishNames, meterOcrScan } from '@restomatch/api';
import { matchProductTopN, MockEmbeddingProvider } from '@restomatch/catalog';
import { and, eq, invoiceLines, invoices, ne, restaurants, type Database } from '@restomatch/db';
import {
  ClaudeVision,
  runOcrPipeline,
  StubOcrProvider,
  type CatalogMatcherFn,
  type OcrProvider,
} from '@restomatch/ocr';
import { enqueueMatchInvoice } from '@restomatch/queue';
import type { OcrInvoiceJob } from '@restomatch/types';
import { makeWorker } from '../queue';
import { jobDb } from '../db';
import { findJobInvoice } from './findJobInvoice';

export type { OcrInvoiceJob };

const embedder = new MockEmbeddingProvider(1536);

function buildProviders(job: OcrInvoiceJob): { documentAi: OcrProvider; claude: OcrProvider } {
  if (job.mockProviders) {
    return {
      documentAi: new StubOcrProvider('document_ai', job.mockProviders.docAi),
      claude: new StubOcrProvider('claude_vision', job.mockProviders.claude),
    };
  }
  // CREDENTIAL GATE (AGENTS.md): a real provider is constructed ONLY when an
  // ANTHROPIC_API_KEY is present. With no key we fail loudly rather than running
  // an un-isolated real ingest — keep ingest on mockProviders until keys AND
  // Supabase/RLS are live (Phase-6, human intake).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('OCR providers not configured — provide mockProviders or set ANTHROPIC_API_KEY');
  }

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
  });
  return { documentAi: claude, claude };
}

export function startOcrInvoiceWorker() {
  return makeWorker<OcrInvoiceJob>('ocr-invoice', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = jobDb(url);

    // Tenant guard: job payloads are not a trust boundary — verify the invoice
    // belongs to the payload's restaurant, and take supplierId from the verified
    // row rather than the payload. Re-read briefly first: the producer enqueues
    // before its transaction commits the row.
    const invoice = await findJobInvoice(db, job.data.restaurantId, job.data.invoiceId);
    if (!invoice) {
      throw new Error(
        `[ocr-invoice] invoice=${job.data.invoiceId} not found in restaurant=${job.data.restaurantId} — refusing to process`,
      );
    }

    try {
      // Authoritative usage metering — counts the scan and enforces the plan's
      // monthly OCR cap here at the worker (race-safe), so the limit can't be
      // bypassed by enqueuing jobs directly. No-op for restaurants without a
      // billing account (implicit trial). Throws QuotaExceededError when over cap.
      await meterOcrScan(db, job.data.restaurantId);

      const providers = buildProviders(job.data);

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

      const result = await runOcrPipeline(job.data.imageUrl, {
        ...providers,
        catalogMatcher: matcher,
        ...(reviewThreshold !== undefined ? { reviewThreshold } : {}),
      });

      const r = result.reconciled;
      const { duplicateOf } = await writeOcrHeader(
        db,
        {
          restaurantId: job.data.restaurantId,
          invoiceId: job.data.invoiceId,
          supplierId: invoice.supplierId,
        },
        {
          invoiceNumber: r.invoiceNumber ?? null,
          invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null,
          totalExclVat: r.totals.subtotal?.toString() ?? null,
          vatAmount: r.totals.vat?.toString() ?? null,
          totalInclVat: r.totals.total?.toString() ?? null,
          allocationNumber: r.allocationNumber ?? null,
          ocrPayload: {
            provider: 'reconciled',
            raw: result,
            reconciledAt: new Date().toISOString(),
          },
          ocrConfidence: result.confidence.toString(),
          status: result.needsHumanReview ? 'parsed' : 'matched',
        },
      );
      // A number already on file holds the invoice for a human (no auto-match).
      const needsHumanReview = result.needsHumanReview || duplicateOf !== undefined;

      await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, job.data.invoiceId));
      if (r.lines.length > 0) {
        await db.insert(invoiceLines).values(
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

      // Fill any English the extraction didn't carry (stub / Document AI lines)
      // plus the linked products' name_en — glossary first, Claude only when
      // keyed. Display-only; a failure here must never fail the OCR job.
      try {
        await fillEnglishNames(db, job.data.restaurantId, { invoiceId: job.data.invoiceId });
      } catch (err) {
        console.warn(`[ocr-invoice] English fill failed for invoice=${job.data.invoiceId}`, err);
      }

      console.log(
        `[ocr-invoice] restaurant=${job.data.restaurantId} invoice=${job.data.invoiceId} ` +
          `confidence=${result.confidence.toFixed(2)} conflicts=${result.conflicts.length} ` +
          `lines=${r.lines.length} needsReview=${needsHumanReview}` +
          (duplicateOf !== undefined ? ` duplicateOf=${duplicateOf ?? 'unknown'}` : ''),
      );

      // Chain into the 3-way PO↔invoice match when OCR is confident enough to
      // auto-proceed. Low-confidence (parsed / needs-review) invoices wait for a
      // human to confirm product matches first (match.runForInvoice on demand).
      // A queue failure must never break the OCR persistence above.
      if (!needsHumanReview) {
        try {
          await enqueueMatchInvoice({
            restaurantId: job.data.restaurantId,
            invoiceId: job.data.invoiceId,
          });
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
      const raw = job as { attemptsMade?: number; opts?: { attempts?: number } };
      if ((raw.attemptsMade ?? 0) + 1 >= (raw.opts?.attempts ?? 1)) {
        await markOcrFailed(db, job.data.restaurantId, job.data.invoiceId, err).catch((e) =>
          console.error(`[ocr-invoice] could not mark invoice=${job.data.invoiceId} failed`, e),
        );
      }
      throw err;
    }
  });
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
): Promise<{ duplicateOf?: string | null }> {
  const where = and(eq(invoices.id, ids.invoiceId), eq(invoices.restaurantId, ids.restaurantId));
  // Blank → NULL: the prompt allows '' for an unreadable number, and '' is a
  // value to the unique index (a second blank collides); NULLs never do.
  const invoiceNumber = header.invoiceNumber?.trim() || null;
  header = { ...header, invoiceNumber };
  try {
    await db.update(invoices).set(header).where(where);
    return {};
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
  await db
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
    .where(where);
  return { duplicateOf };
}

/**
 * Terminal OCR failure: status 'parsed' (= needs a human) with confidence 0 and
 * a machine-readable failure marker in ocr_payload (`raw.ocrFailed`). The
 * receiving UI reads it via receiving.getInvoice → `ocrFailed` and lets the
 * receiver continue against the order. No invoice lines are written, so no
 * ₪ discrepancy is ever computed from a failed read.
 */
export async function markOcrFailed(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  err: unknown,
): Promise<void> {
  const reason =
    err instanceof Error && err.name === 'QuotaExceededError'
      ? 'quota_exceeded'
      : 'extraction_failed';
  await db
    .update(invoices)
    .set({
      status: 'parsed',
      ocrConfidence: '0',
      ocrPayload: {
        provider: 'claude_vision',
        raw: { ocrFailed: true, reason },
        reconciledAt: new Date().toISOString(),
      },
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
