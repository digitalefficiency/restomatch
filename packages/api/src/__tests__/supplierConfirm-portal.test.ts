import { describe, expect, it } from 'vitest';
import {
  EDIT_WINDOW_MS,
  canEditAnswer,
  editWindowEndsAt,
  pickPortalLocale,
  toResponseLines,
  validatePortalAnswer,
  type OrderLineRef,
} from '../supplierConfirm/portal';

/** W3-09 · supplier portal 2.0 answer validation (pure). */
const order: OrderLineRef[] = [
  { id: 'l1', qtyOrdered: 10, unitPrice: 6.5 },
  { id: 'l2', qtyOrdered: 4, unitPrice: 12 },
  { id: 'l3', qtyOrdered: 2, unitPrice: null },
];
const now = new Date('2026-10-25T07:00:00Z');

describe('pickPortalLocale', () => {
  it('he / ar / ru, Hebrew by default', () => {
    expect(pickPortalLocale('ar')).toBe('ar');
    expect(pickPortalLocale(null, 'ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(pickPortalLocale('en', 'fr')).toBe('he');
    expect(pickPortalLocale(undefined)).toBe('he');
  });
});

describe('10-minute edit window', () => {
  const at = new Date('2026-10-25T07:00:00Z');
  it('editable up to 10 minutes, then locked', () => {
    expect(canEditAnswer(at, new Date(at.getTime() + EDIT_WINDOW_MS))).toBe(true);
    expect(canEditAnswer(at, new Date(at.getTime() + EDIT_WINDOW_MS + 1))).toBe(false);
    expect(canEditAnswer(at, new Date(at.getTime() - 1))).toBe(false);
    expect(editWindowEndsAt(at).toISOString()).toBe('2026-10-25T07:10:00.000Z');
  });
});

describe('validatePortalAnswer', () => {
  it('all ✓ (or untouched) → confirmed', () => {
    const r = validatePortalAnswer(order, { lines: [{ poLineId: 'l1', kind: 'ok' }], window: { kind: 'confirm' } }, now);
    expect(r.ok && r.answer.status).toBe('confirmed');
    expect(r.ok && r.answer.lines).toHaveLength(3);
  });

  it('a shortage must be below the ordered quantity', () => {
    expect(validatePortalAnswer(order, { lines: [{ poLineId: 'l1', kind: 'shortage', qtyAvailable: 7 }] }, now)).toMatchObject({
      ok: true,
      answer: { status: 'changes' },
    });
    for (const q of [10, 11, -1, Number.NaN]) {
      expect(validatePortalAnswer(order, { lines: [{ poLineId: 'l1', kind: 'shortage', qtyAvailable: q }] }, now)).toMatchObject({
        ok: false,
        error: 'BAD_QTY',
      });
    }
  });

  it('a substitution needs a product and a positive price', () => {
    const good = validatePortalAnswer(order, { lines: [{ poLineId: 'l2', kind: 'substitution', productName: ' עגבניות שרי ', unitPrice: 14.25 }] }, now);
    expect(good.ok && good.answer.lines.find((l) => l.poLineId === 'l2')).toEqual({
      poLineId: 'l2',
      kind: 'substitution',
      productName: 'עגבניות שרי',
      unitPrice: 14.25,
      qty: null,
    });
    expect(validatePortalAnswer(order, { lines: [{ poLineId: 'l2', kind: 'substitution', productName: '  ', unitPrice: 3 }] }, now)).toMatchObject({ error: 'BAD_PRODUCT' });
    expect(validatePortalAnswer(order, { lines: [{ poLineId: 'l2', kind: 'substitution', productName: 'x', unitPrice: 0 }] }, now)).toMatchObject({ error: 'BAD_PRICE' });
  });

  it('refuses a foreign or duplicated line', () => {
    expect(validatePortalAnswer(order, { lines: [{ poLineId: 'other-po-line', kind: 'ok' }] }, now)).toMatchObject({ error: 'BAD_LINE' });
    expect(
      validatePortalAnswer(order, { lines: [{ poLineId: 'l1', kind: 'ok' }, { poLineId: 'l1', kind: 'ok' }] }, now),
    ).toMatchObject({ error: 'DUPLICATE_LINE' });
  });

  it('a window proposal: start < end, ≤ 24 h, not in the past → changes', () => {
    const ok = validatePortalAnswer(
      order,
      { lines: [], window: { kind: 'propose', start: new Date('2026-10-26T05:00:00Z'), end: new Date('2026-10-26T07:00:00Z') } },
      now,
    );
    expect(ok.ok && ok.answer.status).toBe('changes');
    const bad = [
      { start: new Date('2026-10-26T07:00:00Z'), end: new Date('2026-10-26T05:00:00Z') },
      { start: new Date('2026-10-26T05:00:00Z'), end: new Date('2026-10-27T06:00:00Z') },
      { start: new Date('2026-10-24T05:00:00Z'), end: new Date('2026-10-24T07:00:00Z') },
      { start: new Date('nope'), end: new Date('2026-10-26T07:00:00Z') },
    ];
    for (const w of bad) {
      expect(validatePortalAnswer(order, { lines: [], window: { kind: 'propose', ...w } }, now)).toMatchObject({ error: 'BAD_WINDOW' });
    }
  });

  it('a note alone makes it "changes"', () => {
    const r = validatePortalAnswer(order, { lines: [], note: '  נגיע בצהריים  ' }, now);
    expect(r.ok && r.answer).toMatchObject({ status: 'changes', note: 'נגיע בצהריים' });
  });
});

describe('toResponseLines (fold to the stored wave-1 shape)', () => {
  it('a shortage keeps its qty; a substitution is never read as "as ordered"', () => {
    const r = validatePortalAnswer(
      order,
      {
        lines: [
          { poLineId: 'l1', kind: 'shortage', qtyAvailable: 6 },
          { poLineId: 'l2', kind: 'substitution', productName: 'אחר', unitPrice: 10 },
        ],
      },
      now,
    );
    if (!r.ok) throw new Error('expected ok');
    expect(toResponseLines(order, r.answer)).toEqual([
      { poLineId: 'l1', qtyAvailable: 6, proposedUnitPrice: null },
      { poLineId: 'l2', qtyAvailable: 0, proposedUnitPrice: null },
    ]);
  });
});
