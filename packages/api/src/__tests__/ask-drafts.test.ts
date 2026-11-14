import { describe, expect, it } from 'vitest';
import {
  AMOUNT_PLACEHOLDER,
  DRAFT_LABEL,
  EMPTY_STATS,
  acceptanceRate,
  buildDraft,
  hasLlmMoney,
  recordOffered,
  recordOutcome,
  renderDraftBody,
  shouldKill,
  type AcceptanceStats,
  type DraftBasis,
  type DraftOutcome,
} from '../ask/drafts';

/** W3-04b: draft-only AI drafts. ₪ never from the LLM; acceptance kill-switch. Pure, no DB. */
const basis: DraftBasis = { source: 'claims', refs: ['claim-1'], amountAgorot: 24_350 };
const make = (body: string, b = basis) =>
  buildDraft({ id: 'd1', kind: 'creditRequest', basis: b, body, now: 1 });

describe('buildDraft', () => {
  it('labels and keeps the draft draft-only with its basis', () => {
    const r = make(`שלום, נבקש זיכוי על סך ${AMOUNT_PLACEHOLDER} עבור חשבונית 1024.`);
    expect(r).toMatchObject({ ok: true, draft: { id: 'd1', status: 'draft', basis } });
    expect(DRAFT_LABEL.he).toBe('טיוטה של RestoMatch');
  });
  it('refuses any ₪ figure written by the model', () => {
    for (const body of [
      'זיכוי של 243.50 ₪',
      'זיכוי ₪243.50',
      'סך 200 ש"ח',
      'סך 200 ש״ח',
      'credit of ILS 12',
      '12 NIS',
      '50 שקלים',
      '30 אגורות',
    ]) {
      expect(make(body)).toEqual({ ok: false, error: 'llm_money' });
    }
  });
  it('allows plain numbers (invoice numbers, dates, quantities)', () => {
    expect(hasLlmMoney('חשבונית 1024 מ-25.10, 12 ק״ג עגבניות')).toBe(false);
    expect(make('חשבונית 1024 מ-25.10, 12 ק״ג').ok).toBe(true);
  });
  it('needs a basis and an integer, non-negative amount', () => {
    expect(make('טקסט', { ...basis, refs: [] })).toEqual({ ok: false, error: 'no_basis' });
    expect(make('טקסט', { ...basis, amountAgorot: 12.5 })).toEqual({
      ok: false,
      error: 'bad_amount',
    });
    expect(make('טקסט', { ...basis, amountAgorot: -1 })).toEqual({
      ok: false,
      error: 'bad_amount',
    });
    expect(make('   ')).toEqual({ ok: false, error: 'empty' });
    expect(make(`סך ${AMOUNT_PLACEHOLDER}`, { ...basis, amountAgorot: null })).toEqual({
      ok: false,
      error: 'placeholder_without_amount',
    });
  });
  it('the amount is filled from the basis by the caller formatter', () => {
    const r = make(`סך ${AMOUNT_PLACEHOLDER}.`);
    if (!r.ok) throw new Error('expected ok');
    expect(renderDraftBody(r.draft, (a) => `₪${(a / 100).toFixed(2)}`)).toBe('סך ₪243.50.');
  });
});

describe('acceptance kill-switch (<60 %)', () => {
  const run = (outcomes: DraftOutcome[]): AcceptanceStats =>
    outcomes.reduce((s, o) => recordOutcome(recordOffered(s), o), EMPTY_STATS);
  const n = (k: number, o: DraftOutcome) => Array<DraftOutcome>(k).fill(o);

  it('counts edited as used', () => {
    expect(
      acceptanceRate(run([...n(1, 'accepted'), ...n(1, 'edited'), ...n(2, 'discarded')])),
    ).toBe(0.5);
    expect(acceptanceRate(EMPTY_STATS)).toBeNull();
  });
  it('does not fire before 20 decided drafts', () => {
    expect(shouldKill(run(n(19, 'discarded')))).toBe(false);
  });
  it('fires below 60 % and holds at exactly 60 %', () => {
    expect(shouldKill(run([...n(11, 'accepted'), ...n(9, 'discarded')]))).toBe(true); // 55 %
    expect(shouldKill(run([...n(12, 'accepted'), ...n(8, 'discarded')]))).toBe(false); // 60 %
  });
});
