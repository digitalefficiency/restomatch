import { describe, expect, it } from 'vitest';
import { answerBody, computeAnswer, contactNumbers, lineAgorot, recordedDiff, type PortalLine } from '../logic';

const LINES: PortalLine[] = [
  { id: 'a', name: 'עגבניות', sku: null, qtyOrdered: 10, unit: 'kg', unitPrice: 6.5, agreed: true },
  { id: 'b', name: 'שמן זית', sku: 'OL-1', qtyOrdered: 4, unit: 'l', unitPrice: 13.9, agreed: false },
  { id: 'c', name: 'בזיליקום', sku: null, qtyOrdered: 2, unit: 'unit', unitPrice: null, agreed: false },
];
const asOrdered = () => ({
  qty: Object.fromEntries(LINES.map((l) => [l.id, String(l.qtyOrdered)])),
  price: Object.fromEntries(LINES.map((l) => [l.id, l.unitPrice == null ? '' : String(l.unitPrice)])),
});

describe('supplier answer (auth-02): a marked change is never dropped', () => {
  it('no edits → 0 changes, and the answer body equals the order', () => {
    const { qty, price } = asOrdered();
    const a = computeAnswer(LINES, qty, price, '');
    expect(a.changeCount).toBe(0);
    expect(a.diff).toEqual([]);
    expect(a.invalid).toBe(false);
  });

  it('a shortage is counted, summarised and carried by the primary (answer) body', () => {
    const { qty, price } = asOrdered();
    qty.a = '6';
    const a = computeAnswer(LINES, qty, price, '');
    expect(a.changeCount).toBe(1);
    expect(a.diff).toEqual([{ kind: 'short', lineId: 'a', name: 'עגבניות', qty: 6, ordered: 10, unit: 'kg' }]);
    const body = answerBody('answer', a, '');
    expect(body.lines.find((l) => l.poLineId === 'a')?.qtyAvailable).toBe(6);
  });

  it('0 is "out of stock"; a new price and a note each count as a change', () => {
    const { qty, price } = asOrdered();
    qty.b = '0';
    price.a = '7,20';
    const a = computeAnswer(LINES, qty, price, ' יגיע מחר ');
    expect(a.diff.map((d) => d.kind)).toEqual(['price', 'out']);
    expect(a.changeCount).toBe(3);
    expect(answerBody('answer', a, ' יגיע מחר ').note).toBe('יגיע מחר');
  });

  it('only the explicit "as ordered" choice sends no lines — and it still carries the note', () => {
    const { qty, price } = asOrdered();
    qty.a = '6';
    const a = computeAnswer(LINES, qty, price, ' יגיע מחר ');
    expect(a.lineChangeCount).toBe(1);
    expect(answerBody('asIs', a, ' יגיע מחר ')).toEqual({ lines: [], note: 'יגיע מחר' });
    expect(answerBody('asIs', a, '')).toEqual({ lines: [], note: null });
  });

  it('the answer body gives every line an explicit quantity (the server refuses partial answers)', () => {
    const { qty, price } = asOrdered();
    qty.a = '6';
    const body = answerBody('answer', computeAnswer(LINES, qty, price, ''), '');
    expect(body.lines.map((l) => l.poLineId)).toEqual(LINES.map((l) => l.id));
    expect(body.lines.every((l) => l.qtyAvailable !== null)).toBe(true);
  });

  it('flags invalid fields instead of guessing', () => {
    const { qty, price } = asOrdered();
    qty.a = '6kg';
    price.b = 'abc';
    const a = computeAnswer(LINES, qty, price, '');
    expect(a.invalid).toBe(true);
    expect(a.rows[0]!.qtyBad).toBe(true);
    expect(a.rows[1]!.priceBad).toBe(true);
  });
});

describe('portal ₪ totals (auth-16)', () => {
  it('rounds qty × price half-up once, in integer agorot', () => {
    expect(lineAgorot(10, 6.5)).toBe(6500);
    expect(lineAgorot(1.005, 1)).toBe(101); // 100.5 agorot → 101
    expect(lineAgorot(3, 0.3333)).toBe(100); // 99.99 agorot → 100
    expect(lineAgorot(1_000_000, 10_000_000)).toBe(1_000_000 * 10_000_000 * 100);
  });

  it('the order total is the sum of the visible line totals; unpriced lines are excluded and counted', () => {
    const { qty, price } = asOrdered();
    const a = computeAnswer(LINES, qty, price, '');
    expect(a.orderTotalAgorot).toBe(6500 + 5560);
    expect(a.orderTotalAgorot).toBe(a.rows.reduce((s, r) => s + (r.orderAgorot ?? 0), 0));
    expect(a.unpriced).toBe(1);
    qty.a = '6';
    expect(computeAnswer(LINES, qty, price, '').answerTotalAgorot).toBe(3900 + 5560);
  });
});

describe('recorded answer + contact', () => {
  it('turns a stored answer back into the same diff', () => {
    expect(
      recordedDiff(LINES, [
        { poLineId: 'a', qtyAvailable: 6, proposedUnitPrice: null },
        { poLineId: 'b', qtyAvailable: 0, proposedUnitPrice: 14.2 },
        { poLineId: 'zzz', qtyAvailable: 1, proposedUnitPrice: null },
      ]).map((d) => d.kind),
    ).toEqual(['short', 'out', 'price']);
  });

  it('normalises an Israeli phone for tel: and wa.me, or hides the buttons', () => {
    expect(contactNumbers('050-123-4567')).toEqual({ tel: '+972501234567', wa: '972501234567' });
    expect(contactNumbers('+972 3 555 1234')).toEqual({ tel: '+97235551234', wa: '97235551234' });
    expect(contactNumbers('12')).toBeNull();
    expect(contactNumbers(null)).toBeNull();
  });
});
