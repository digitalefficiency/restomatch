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
 * G-08 · the link policy, declared STRUCTURALLY (this package does not depend on
 * `@restomatch/catalog`; the worker injects catalog's `decideLink`, which fits).
 */
export type OcrLinkProvenance = 'human' | 'exactKey' | 'newProduct' | 'guess' | 'legacy';
export type OcrLinkCandidate = ProductCandidate & { provenance?: OcrLinkProvenance };
export interface OcrLinkDecision {
  decision: 'auto' | 'review' | 'new';
  productId: string | null;
}
export type OcrLinkDecider = (
  candidates: OcrLinkCandidate[],
  row: { unitPack: 'match' | 'mismatch' | 'unknown' },
) => OcrLinkDecision;

export interface OcrPipelineRunOptions extends OcrPipelineOptions {
  /**
   * The shared link policy (`decideLink` from `@restomatch/catalog`). OCR lines
   * carry no unit, so it is called with `unitPack: 'unknown'` — only exact keys
   * auto-link. Absent → `defaultOcrLinkDecider`, the provable exact-key subset.
   */
  decideLink?: OcrLinkDecider;
}

/**
 * Why the pipeline held an invoice for a person (G-08). 'unlinked' = the link
 * policy left at least one line without a product (a question to a person):
 * the engine pairs only by product / SKU, so matching such an invoice would
 * report the ordered line MISSING and the billed line UNORDERED — a false leak.
 */
export type OcrReviewReason = 'confidence' | 'lowLines' | 'unlinked';

export interface OcrPipelineRunResult extends OcrPipelineResult {
  /** Every reason the invoice waits for a person (empty ⇔ needsHumanReview false). */
  reviewReasons: OcrReviewReason[];
  /** Lines the policy left without a product (0 without a catalog matcher). */
  unlinkedLines: number;
}

/** Interim encoding (G-08): 0.999 = exact key / new product, 1.000 = a person. */
const EXACT_ALIAS_MIN_CONFIDENCE = 0.999;

/**
 * Default when no policy is injected: auto-link ONLY what is provably an exact
 * key — a barcode, a SKU/alias hit whose stored confidence is ≥ 0.999 (a
 * person's or an exact-key link) and is not marked a guess, or a name the
 * matcher marked `exactKey` (identical normalized name, same supplier). A name match
 * (embedding / fuzzy), however confident, stays unlinked for review. Every
 * 'auto' here is also 'auto' under `decideLink` (parity-tested in the api).
 */
export const defaultOcrLinkDecider: OcrLinkDecider = (candidates) => {
  const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
  if (!best) return { decision: 'new', productId: null };
  const guessed = best.provenance === 'guess' || best.provenance === 'legacy';
  const exact =
    !guessed &&
    (best.matchedBy === 'barcode' ||
      ((best.matchedBy === 'sku' || best.matchedBy === 'alias') &&
        best.confidence >= EXACT_ALIAS_MIN_CONFIDENCE) ||
      // An identical same-supplier name the matcher marked as an exact key.
      (best.provenance === 'exactKey' && best.confidence >= EXACT_ALIAS_MIN_CONFIDENCE));
  return exact ? { decision: 'auto', productId: best.productId } : { decision: 'review', productId: null };
};

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
  options: OcrPipelineRunOptions,
): Promise<OcrPipelineRunResult> {
  // M11: a single-provider deployment wires the SAME instance into both slots
  // (Document AI not yet live). Call it once — two identical paid extractions
  // added cost and latency but no information (the reconciler sees full
  // agreement either way).
  const [documentAi, claude] =
    options.documentAi === options.claude
      ? await options.claude.extract(image).then((r) => [r, r] as const)
      : await Promise.all([options.documentAi.extract(image), options.claude.extract(image)]);

  const { result: reconciledInvoice, conflicts, confidence } = reconcile(documentAi, claude);

  if (options.catalogMatcher) {
    const matcher = options.catalogMatcher;
    const decide = options.decideLink ?? defaultOcrLinkDecider;
    const enriched: ResolvedInvoiceLine[] = await Promise.all(
      reconciledInvoice.lines.map(async (line) => enrichLine(line, matcher, decide)),
    );
    reconciledInvoice.lines = enriched;
  }

  const reviewThreshold = options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  const matcherWasUsed = options.catalogMatcher !== undefined;
  // G-08: ANY line the policy left unlinked holds the invoice — not only lines
  // with no candidate at all. A 'review' line has candidates but no product.
  const unlinkedLines = matcherWasUsed ? countUnlinkedLines(reconciledInvoice) : 0;
  const reviewReasons: OcrReviewReason[] = [];
  if (confidence < reviewThreshold) reviewReasons.push('confidence');
  if (hasLowConfidenceLines(reconciledInvoice)) reviewReasons.push('lowLines');
  if (unlinkedLines > 0) reviewReasons.push('unlinked');
  const needsHumanReview = reviewReasons.length > 0;

  return {
    primary: claude,
    reconciled: reconciledInvoice,
    providers: { documentAi, claude },
    confidence,
    needsHumanReview,
    conflicts,
    reviewReasons,
    unlinkedLines,
  };
}

async function enrichLine(
  line: ResolvedInvoiceLine,
  matcher: (line: ResolvedInvoiceLine) => Promise<ProductCandidate[]>,
  decide: OcrLinkDecider,
): Promise<ResolvedInvoiceLine> {
  const candidates = await matcher(line);
  // G-08: one link policy. OCR has no unit for the line → 'unknown'. Anything
  // not 'auto' keeps productId null and surfaces the candidates for review.
  const d = decide(candidates, { unitPack: 'unknown' });
  const productId = d.decision === 'auto' ? d.productId : null;
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

function countUnlinkedLines(invoice: { lines: ResolvedInvoiceLine[] }): number {
  return invoice.lines.filter((l) => l.productId === null).length;
}
