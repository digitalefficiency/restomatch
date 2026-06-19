import { meterOcrScan } from '@restomatch/api';
import { matchProductTopN, MockEmbeddingProvider } from '@restomatch/catalog';
import { and, createDb, eq, invoiceLines, invoices, restaurants } from '@restomatch/db';
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
  // ClaudeVision instance to BOTH provider slots. The reconciler treats two
  // identical extractions as full agreement (no conflicts → high confidence),
  // which is the intended single-provider behaviour for the pilot.
  const claude = new ClaudeVision({ apiKey, model: process.env.OCR_CLAUDE_MODEL });
  return { documentAi: claude, claude };
}

export function startOcrInvoiceWorker() {
  return makeWorker<OcrInvoiceJob>('ocr-invoice', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    // Tenant guard: job payloads are not a trust boundary — verify the invoice
    // belongs to the payload's restaurant, and take supplierId from the verified
    // row rather than the payload.
    const [invoice] = await db
      .select({ id: invoices.id, supplierId: invoices.supplierId })
      .from(invoices)
      .where(
        and(eq(invoices.id, job.data.invoiceId), eq(invoices.restaurantId, job.data.restaurantId)),
      )
      .limit(1);
    if (!invoice) {
      throw new Error(
        `[ocr-invoice] invoice=${job.data.invoiceId} not found in restaurant=${job.data.restaurantId} — refusing to process`,
      );
    }

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
    await db
      .update(invoices)
      .set({
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
      })
      .where(
        and(eq(invoices.id, job.data.invoiceId), eq(invoices.restaurantId, job.data.restaurantId)),
      );

    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, job.data.invoiceId));
    if (r.lines.length > 0) {
      await db.insert(invoiceLines).values(
        r.lines.map((line) => ({
          invoiceId: job.data.invoiceId,
          productId: line.productId,
          supplierSku: line.sku ?? null,
          rawDescription: line.rawDescription,
          qtyBilled: line.qty.toString(),
          unit: line.unit,
          unitPriceBilled: line.unitPrice.toString(),
          lineTotal: line.lineTotal.toString(),
          vatRate: line.vatRate?.toString() ?? null,
          ocrConfidenceLine: line.confidence?.toString() ?? null,
        })),
      );
    }

    console.log(
      `[ocr-invoice] restaurant=${job.data.restaurantId} invoice=${job.data.invoiceId} ` +
        `confidence=${result.confidence.toFixed(2)} conflicts=${result.conflicts.length} ` +
        `lines=${r.lines.length} needsReview=${result.needsHumanReview}`,
    );

    // Chain into the 3-way PO↔invoice match when OCR is confident enough to
    // auto-proceed. Low-confidence (parsed / needs-review) invoices wait for a
    // human to confirm product matches first (match.runForInvoice on demand).
    // A queue failure must never break the OCR persistence above.
    if (!result.needsHumanReview) {
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
      needsHumanReview: result.needsHumanReview,
      conflicts: result.conflicts.length,
      lines: r.lines.length,
    };
  });
}
