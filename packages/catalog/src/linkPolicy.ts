/**
 * G-08 · ONE product-link policy, shared by the catalog import, OCR and order
 * capture: a guess never becomes certainty.
 *
 * PURE — no db import, structural types only — so `@restomatch/ocr` (which does
 * not depend on this package) can satisfy `decideLink` structurally and receive
 * it by injection.
 *
 * Decision table (leak-economist signs it in the PR):
 *
 * | top candidate                                                    | unitPack  | decision |
 * |------------------------------------------------------------------|-----------|----------|
 * | none, or confidence < REVIEW_FLOOR (0.6)                         | any       | new      |
 * | exact key: matchedBy sku/barcode, or an alias whose provenance   | match /   | auto     |
 * |   is human/exactKey/newProduct (never a guess/legacy provenance) | unknown   |          |
 * | exact key                                                        | mismatch  | review   |
 * | confidence ≥ AUTO_LINK_MIN (0.95), not an exact key              | match     | auto     |
 * | confidence ≥ AUTO_LINK_MIN, not an exact key                     | unknown   | review (UNKNOWN_UNIT) |
 * | confidence ≥ AUTO_LINK_MIN, not an exact key                     | mismatch  | review   |
 * | REVIEW_FLOOR ≤ confidence < AUTO_LINK_MIN, not an exact key      | any       | review (MEDIUM_CONFIDENCE …) |
 *
 * A `review` decision never carries a productId: the row stays unlinked and the
 * top ≤3 candidates are offered as suggestions to a person.
 */

/** Confidence at/above which a non-exact candidate may auto-link — with a matching unit and pack only. */
export const AUTO_LINK_MIN = 0.95;
/** Below this the top candidate is not even a suggestion: create a new product. */
export const REVIEW_FLOOR = 0.6;
/** Interim encoding: a PERSON linked it (mapping.confirm, the review, a catalog edit). */
export const HUMAN_CONFIDENCE = 1;
/** Interim encoding: a machine link proven by an exact key, or a product made from this very row. */
export const MACHINE_MAX_CONFIDENCE = 0.999;
/** Interim encoding: a guess is stored at or below this, never as certainty. */
export const GUESS_MAX_CONFIDENCE = 0.9;
/** At most this many suggestions are returned. */
export const MAX_SUGGESTIONS = 3;

/**
 * Where a link came from.
 *   human      — a person confirmed it                         (interim: 1.000)
 *   exactKey   — an exact supplier key (SKU / barcode)         (interim: 0.999)
 *   newProduct — a product made from this very row             (interim: 0.999)
 *   guess      — a name match (embedding / fuzzy) a machine made (interim: ≤ 0.900)
 *   legacy     — a machine link stored before this policy      (interim: 0.901–0.998)
 */
export type LinkProvenance = 'human' | 'exactKey' | 'newProduct' | 'guess' | 'legacy';

/** Provenances strong enough to auto-resolve future lines. */
export type ConfirmedProvenance = 'human' | 'exactKey' | 'newProduct';

export type LinkMatchedBy = 'sku' | 'alias' | 'barcode' | 'embedding' | 'fuzzy';

export interface LinkCandidate {
  productId: string;
  canonicalName: string;
  confidence: number;
  matchedBy: LinkMatchedBy;
  provenance?: LinkProvenance;
}

/** Why a candidate needs a person ("בדיקה") instead of an automatic link. */
export type ReviewReason = 'MEDIUM_CONFIDENCE' | 'UNIT_MISMATCH' | 'PACK_MISMATCH' | 'UNKNOWN_UNIT';

export type UnitPackFit = 'match' | 'mismatch' | 'unknown';

export interface LinkRow {
  /** Does the row's unit and pack fit the candidate product? OCR has no unit: 'unknown'. */
  unitPack: UnitPackFit;
  /** Which part mismatched, when unitPack = 'mismatch' (defaults to UNIT_MISMATCH). */
  mismatch?: ReadonlyArray<'UNIT_MISMATCH' | 'PACK_MISMATCH'>;
}

export type LinkDecisionKind = 'auto' | 'review' | 'new';

export interface LinkDecision<C extends LinkCandidate = LinkCandidate> {
  decision: LinkDecisionKind;
  /** Set only for 'auto'. A review row is never linked. */
  productId: string | null;
  /** Empty for 'auto' and 'new'. */
  reasons: ReviewReason[];
  /** Top ≤3 candidates, best first, one per product. */
  suggestions: C[];
}

const CONFIRMED: ReadonlySet<LinkProvenance> = new Set(['human', 'exactKey', 'newProduct']);

/**
 * Exact key: SKU/barcode; an alias a person / exact key / new product made; or
 * a name candidate the matcher marked `exactKey` because its normalized name is
 * IDENTICAL to the line's, for the SAME supplier (owner decision 31.10). Never a guess.
 */
export function isExactKey(c: LinkCandidate): boolean {
  if (c.provenance === 'guess' || c.provenance === 'legacy') return false;
  if (c.matchedBy === 'sku' || c.matchedBy === 'barcode') return true;
  return c.provenance !== undefined && CONFIRMED.has(c.provenance);
}

/**
 * The name normalization for the identical-name exact key: trim, lower-case,
 * one space, Hebrew gershayim/geresh folded to ASCII quotes. Nothing fuzzier —
 * "פלפל אדום חריף" is NOT "פלפל אדום", and a word swap is not identical.
 */
export function normalizeLinkName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[\u05F4\u201C\u201D]/g, '"')
    .replace(/[\u05F3\u2018\u2019]/g, "'")
    .replace(LINK_WS_RE, ' ')
    .replace(/^ | $/g, '')
    .toLowerCase();
}

/**
 * The ONE whitespace set for link names, shared by `normalizeLinkName` (JS) and
 * `normNameSql` (Postgres): JS `\s` spelled out, so NBSP (U+00A0), figure /
 * narrow spaces (U+2007, U+202F) and the BOM (U+FEFF) fold the same way on
 * both sides — Postgres `[[:space:]]` under C.UTF-8 does not include them.
 */
export const LINK_WS_CLASS = '[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+';
const LINK_WS_RE = new RegExp(LINK_WS_CLASS, 'g');

/** Best first (stable on ties), one entry per product, at most MAX_SUGGESTIONS. */
export function rankSuggestions<C extends LinkCandidate>(candidates: readonly C[]): C[] {
  const sorted = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.confidence - a.c.confidence || a.i - b.i)
    .map((x) => x.c);
  const seen = new Set<string>();
  const out: C[] = [];
  for (const c of sorted) {
    if (seen.has(c.productId)) continue;
    seen.add(c.productId);
    out.push(c);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/** The one link policy. See the decision table at the top of this file. */
export function decideLink<C extends LinkCandidate>(
  candidates: readonly C[],
  row: LinkRow,
): LinkDecision<C> {
  const suggestions = rankSuggestions(candidates);
  const top = suggestions[0];
  if (!top || !(top.confidence >= REVIEW_FLOOR)) {
    return { decision: 'new', productId: null, reasons: [], suggestions };
  }
  const reasons: ReviewReason[] = [];
  const exact = isExactKey(top);
  if (!exact && top.confidence < AUTO_LINK_MIN) reasons.push('MEDIUM_CONFIDENCE');
  if (row.unitPack === 'mismatch') {
    reasons.push(...(row.mismatch && row.mismatch.length > 0 ? row.mismatch : (['UNIT_MISMATCH'] as const)));
  } else if (row.unitPack === 'unknown' && !exact && reasons.length === 0) {
    reasons.push('UNKNOWN_UNIT');
  }
  if (reasons.length === 0) {
    return { decision: 'auto', productId: top.productId, reasons, suggestions };
  }
  return { decision: 'review', productId: null, reasons, suggestions };
}

/**
 * THE provenance reader. Prefers the `source` column (G-03, `product_aliases.source`)
 * when the row carries it; until that column is deployed it reads the interim
 * confidence encoding. The G-03 cut-over is: select `source` in the callers.
 */
export function aliasProvenance(row: {
  confidence: string | number | null | undefined;
  source?: string | null;
}): LinkProvenance {
  if (row.source != null) {
    switch (row.source) {
      case 'human':
        return 'human';
      case 'exact_key':
        return 'exactKey';
      case 'new_product':
        return 'newProduct';
      case 'import_guess':
        return 'guess';
      default:
        return 'legacy';
    }
  }
  // Interim: numeric(4,3) arrives as a string. A missing value predates the
  // column default and is treated as an unknown legacy link.
  if (row.confidence == null || row.confidence === '') return 'legacy';
  const c = Math.round(Number(row.confidence) * 1000);
  if (!Number.isFinite(c)) return 'legacy';
  if (c >= 1000) return 'human';
  if (c === Math.round(MACHINE_MAX_CONFIDENCE * 1000)) return 'exactKey';
  if (c <= Math.round(GUESS_MAX_CONFIDENCE * 1000)) return 'guess';
  return 'legacy';
}

/** The interim confidence written for a provenance (`numeric(4,3)` string). */
export function provenanceConfidence(provenance: ConfirmedProvenance): string {
  return (provenance === 'human' ? HUMAN_CONFIDENCE : MACHINE_MAX_CONFIDENCE).toFixed(3);
}
