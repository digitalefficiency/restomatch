/**
 * AI drafts (W3-04b, independent of AU-06). A draft is text RestoMatch
 * suggests (a credit-request letter, a supplier message, an order note) and a
 * person sends or discards. Draft-only: building one never sends, writes a
 * claim or moves money; the tool that creates it returns the draft's id.
 *
 * Money rule (AGENTS.md, owner): ₪ always comes from the engine or
 * `lib/claims`, never from the LLM. So the model's text may not contain an
 * amount at all. It writes the `{{amount}}` placeholder, and the web fills it
 * from `basis.amountAgorot` through `formatIls()` at display. Text that carries
 * its own ₪ figure is refused (`llm_money`), not cleaned up.
 */

export const DRAFT_LABEL = { he: 'טיוטה של RestoMatch', en: 'RestoMatch draft' } as const;
export const AMOUNT_PLACEHOLDER = '{{amount}}';

export type DraftKind = 'creditRequest' | 'supplierMessage' | 'orderNote';

export interface DraftBasis {
  /** Where the facts come from: the matching engine or `lib/claims`. */
  source: 'engine' | 'claims';
  /** Discrepancy / claim / order ids the draft is about (≥1). */
  refs: readonly string[];
  /** Integer agorot from the source, or null for a draft with no amount. */
  amountAgorot: number | null;
}

export interface Draft {
  id: string;
  kind: DraftKind;
  status: 'draft';
  basis: DraftBasis;
  /** Model text with at most the `{{amount}}` placeholder; no ₪ of its own. */
  body: string;
  createdAt: number;
}

export type DraftError =
  | 'no_basis'
  | 'bad_amount'
  | 'llm_money'
  | 'placeholder_without_amount'
  | 'empty';

/**
 * A money figure written by the model: a number next to ₪ / ש"ח / NIS / ILS /
 * שקל (either side), or the word "אגורות". Plain numbers (dates, quantities,
 * invoice numbers) are fine.
 */
const MONEY_RE =
  /(?:₪|ש["״]ח|\bNIS\b|\bILS\b|שקל(?:ים)?)\s*[-+]?\d|\d[\d,.]*\s*(?:₪|ש["״]ח|\bNIS\b|\bILS\b|שקל(?:ים)?|אגורות)/i;

export function hasLlmMoney(text: string): boolean {
  return MONEY_RE.test(text.split(AMOUNT_PLACEHOLDER).join(' '));
}

export function buildDraft(input: {
  id: string;
  kind: DraftKind;
  basis: DraftBasis;
  body: string;
  now: number;
}): { ok: true; draft: Draft } | { ok: false; error: DraftError } {
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'empty' };
  if (input.basis.refs.length === 0) return { ok: false, error: 'no_basis' };
  const a = input.basis.amountAgorot;
  if (a !== null && (!Number.isSafeInteger(a) || a < 0)) return { ok: false, error: 'bad_amount' };
  if (hasLlmMoney(body)) return { ok: false, error: 'llm_money' };
  if (a === null && body.includes(AMOUNT_PLACEHOLDER))
    return { ok: false, error: 'placeholder_without_amount' };
  return {
    ok: true,
    draft: {
      id: input.id,
      kind: input.kind,
      status: 'draft',
      basis: { source: input.basis.source, refs: [...input.basis.refs], amountAgorot: a },
      body,
      createdAt: input.now,
    },
  };
}

/** Fill the placeholder at display time with the caller's formatter (web: `formatIls`). */
export function renderDraftBody(draft: Draft, formatAgorot: (agorot: number) => string): string {
  if (draft.basis.amountAgorot === null) return draft.body;
  return draft.body.split(AMOUNT_PLACEHOLDER).join(formatAgorot(draft.basis.amountAgorot));
}
