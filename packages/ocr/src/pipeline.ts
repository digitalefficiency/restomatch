import { reconcile } from './reconciler';
import {
  DEFAULT_REVIEW_THRESHOLD,
  type ImageSource,
  type OcrPipelineOptions,
  type OcrPipelineResult,
  type ProductCandidate,
  type ResolvedInvoiceLine,
} from './types';

/**
 * Orchestrate the full OCR pipeline:
 *   1. Run both providers in parallel.
 *   2. Reconcile their outputs (field-by-field with tolerance).
 *   3. Optionally enrich each line with product candidates from the catalog.
 *   4. Compute overall confidence and human-review flag.
 *
 * The pipeline is pure (no DB or HTTP) — callers wire up providers and the
 * catalog matcher via dependency injection. Production uses Google Document AI
 * + Claude Vision; tests/dev use StubOcrProvider.
 */
export async function runOcrPipeline(
  image: ImageSource,
  options: OcrPipelineOptions,
): Promise<OcrPipelineResult> {
  const [documentAi, claude] = await Promise.all([
    options.documentAi.extract(image),
    options.claude.extract(image),
  ]);

  const { result: reconciledInvoice, conflicts, confidence } = reconcile(documentAi, claude);

  if (options.catalogMatcher) {
    const matcher = options.catalogMatcher;
    const enriched: ResolvedInvoiceLine[] = await Promise.all(
      reconciledInvoice.lines.map(async (line) => enrichLine(line, matcher)),
    );
    reconciledInvoice.lines = enriched;
  }

  const reviewThreshold = options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  const matcherWasUsed = options.catalogMatcher !== undefined;
  const needsHumanReview =
    confidence < reviewThreshold ||
    (matcherWasUsed && hasUnresolvedLines(reconciledInvoice));

  return {
    primary: claude,
    reconciled: reconciledInvoice,
    providers: { documentAi, claude },
    confidence,
    needsHumanReview,
    conflicts,
  };
}

async function enrichLine(
  line: ResolvedInvoiceLine,
  matcher: (line: ResolvedInvoiceLine) => Promise<ProductCandidate[]>,
): Promise<ResolvedInvoiceLine> {
  const candidates = await matcher(line);
  const best = candidates[0];
  // High-confidence single candidate → auto-link. Otherwise leave productId null
  // and surface candidates for human review.
  const productId = best && best.confidence >= 0.95 ? best.productId : null;
  return { ...line, productId, productCandidates: candidates };
}

function hasUnresolvedLines(invoice: { lines: ResolvedInvoiceLine[] }): boolean {
  return invoice.lines.some((l) => l.productId === null && l.productCandidates.length === 0);
}
