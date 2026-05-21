import { matchProductTopN, MockEmbeddingProvider } from '@restomatch/catalog';
import { createDb, eq, invoiceLines, invoices, restaurants } from '@restomatch/db';
import {
  runOcrPipeline,
  StubOcrProvider,
  type CatalogMatcherFn,
  type OcrProvider,
} from '@restomatch/ocr';
import type { InvoiceOcrResult } from '@restomatch/types';
import { makeWorker } from '../queue';

export interface OcrInvoiceJob {
  restaurantId: string;
  invoiceId: string;
  supplierId: string | null;
  imageUrl: string;
  /** When set, the worker bypasses real providers and uses these results. */
  mockProviders?: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult };
}

const embedder = new MockEmbeddingProvider(1536);

function buildProviders(job: OcrInvoiceJob): { documentAi: OcrProvider; claude: OcrProvider } {
  if (job.mockProviders) {
    return {
      documentAi: new StubOcrProvider('document_ai', job.mockProviders.docAi),
      claude: new StubOcrProvider('claude_vision', job.mockProviders.claude),
    };
  }
  // TODO M4-followup: replace with GoogleDocumentAi + ClaudeVision real clients
  // when credentials are provisioned. Until then, the job requires mockProviders.
  throw new Error('OCR providers not configured — provide mockProviders or wire real clients');
}

export function startOcrInvoiceWorker() {
  return makeWorker<OcrInvoiceJob>('ocr-invoice', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const providers = buildProviders(job.data);

    const matcher: CatalogMatcherFn = async (line) => {
      const embedding = await embedder.embed(line.rawDescription);
      const candidates = await matchProductTopN(
        db,
        {
          restaurantId: job.data.restaurantId,
          supplierId: job.data.supplierId,
          rawDescription: line.rawDescription,
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
      .where(eq(invoices.id, job.data.invoiceId));

    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, job.data.invoiceId));
    if (r.lines.length > 0) {
      await db.insert(invoiceLines).values(
        r.lines.map((line) => ({
          invoiceId: job.data.invoiceId,
          productId: line.productId,
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

    return {
      invoiceId: job.data.invoiceId,
      confidence: result.confidence,
      needsHumanReview: result.needsHumanReview,
      conflicts: result.conflicts.length,
      lines: r.lines.length,
    };
  });
}
