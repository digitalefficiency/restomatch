import { checkInvoice } from './checks';
import type { InvoiceExtractionV2 } from './providers/invoiceSchema';
import { reconcile } from './reconciler';
import {
  DEFAULT_REVIEW_THRESHOLD,
  LINE_REVIEW_THRESHOLD,
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
 *   4. Run the arithmetic gate (./checks): a read that doesn't add up, a bad
 *      ח״פ or a partial/hand-corrected document goes to a person.
 *   5. Compute overall confidence and human-review flag.
 *
 * The pipeline is pure (no DB or HTTP) — callers wire up providers and the
 * catalog matcher via dependency injection. Production uses Google Document AI
 * + Claude Vision; tests/dev use StubOcrProvider.
 */
export async function runOcrPipeline(
  image: ImageSource,
  options: OcrPipelineOptions,
): Promise<OcrPipelineResult> {
  // M11: a single-provider deployment wires the SAME instance into both slots
  // (Document AI not yet live). Call it once — two identical paid extractions
  // added cost and latency but no information (the reconciler sees full
  // agreement either way).
  const singleProvider = options.documentAi === options.claude;
  const [documentAi, claude] =
    singleProvider
      ? await options.claude.extract(image).then((r) => [r, r] as const)
      : await Promise.all([options.documentAi.extract(image), options.claude.extract(image)]);

  const reconciledResult = reconcile(documentAi, claude);
  const { result: reconciledInvoice, conflicts } = reconciledResult;

  // v2 document-level fields come from the Claude read (the reconciler only
  // compares the canonical fields); the gate runs on the reconciled numbers.
  const v2 = claude as Partial<InvoiceExtractionV2>;
  Object.assign(reconciledInvoice, {
    ...pick(v2, [
      'documentKind',
      'buyer',
      'deliveryNotes',
      'periodStart',
      'periodEnd',
      'invoiceDiscount',
      'continuesOnAnotherPage',
      'handwrittenCorrection',
    ]),
  });
  if (v2.totals?.vatRate !== undefined) reconciledInvoice.totals.vatRate = v2.totals.vatRate;
  const checks = checkInvoice(reconciledInvoice, {
    expectedSupplierBusinessId: options.expectedSupplierBusinessId,
  });

  // Single provider: there is nothing to reconcile, so "agreement" said 1.0 and
  // the owner's threshold never fired. Use the model's own confidence, capped by
  // the gate.
  const confidence = singleProvider
    ? Math.min(claude.confidence ?? 1, checks.score)
    : Math.min(reconciledResult.confidence, checks.score);
  reconciledInvoice.confidence = confidence;

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
    !checks.passed ||
    confidence < reviewThreshold ||
    hasLowConfidenceLines(reconciledInvoice) ||
    (matcherWasUsed && hasUnresolvedLines(reconciledInvoice));

  return {
    primary: claude,
    reconciled: reconciledInvoice,
    providers: { documentAi, claude },
    confidence,
    needsHumanReview,
    conflicts,
    checks,
  };
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
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

/**
 * A line the provider could not read (EN-3: unreadable qty/price zero-filled at
 * confidence ≤ 0.2) must never reach the matching engine unreviewed — a 0 qty or
 * price there would be counted as a ₪ leak that never happened.
 */
function hasLowConfidenceLines(invoice: { lines: ResolvedInvoiceLine[] }): boolean {
  return invoice.lines.some((l) => l.confidence !== undefined && l.confidence < LINE_REVIEW_THRESHOLD);
}

function hasUnresolvedLines(invoice: { lines: ResolvedInvoiceLine[] }): boolean {
  return invoice.lines.some((l) => l.productId === null && l.productCandidates.length === 0);
}
