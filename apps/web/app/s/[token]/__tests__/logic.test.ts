import { describe, expect, it } from 'vitest';
import { buildAnswer, computeAnswer, contactNumbers, isOwnAnswer, lineAgorot, parseQty, parseUnitPrice, recordedDiff, type PortalLine } from '../logic';

const LINES: PortalLine[] = [
  { id: 'a', name: 'עגבניות', sku: null, qtyOrdered: 10, unit: 'kg', unitPrice: 6.5, agreed: true },
  { id: 'b', name: 'שמן זית', sku: 'OL-1', qtyOrdered: 4, unit: 'l', unitPrice: 13.9, agreed: false },
  { id: 'c', name: 'בזיליקום', sku: null, qtyOrdered: 2, unit: 'unit', unitPrice: null, agreed: false },
];
const asOrdered = () => ({
  qty: Object.fromEntries(LINES.map((l) => [l.id, String(l.qtyOrdered)])),
  price: Object.fromEntries(LINES.map((l) => [l.id, l.unitPrice == null ? '' : String(l.unitPrice)])),
});
const build = (qty: Record<string, string>, price: Record<string, string>, note = '') =>
  buildAnswer({ lines: LINES, linesVersion: 'v1', qtyText: qty, priceText: price, note });
const everyLineAsOrdered = LINES.map((l) => ({ poLineId: l.id, qtyAvailable: l.qtyOrdered, proposedUnitPrice: null }));

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
    const b = build(qty, price);
    expect(b).toMatchObject({ primary: 'with_changes', intent: 'with_changes', count: 1 });
    expect(b.body.intent).toBe('with_changes');
    expect(b.body.lines.find((l) => l.poLineId === 'a')?.qtyAvailable).toBe(6);
  });

  it('0 is "out of stock"; a new price and a note each count as a change', () => {
    const { qty, price } = asOrdered();
    qty.b = '0';
    price.a = '7,20';
    const a = computeAnswer(LINES, qty, price, ' יגיע מחר ');
    expect(a.diff.map((d) => d.kind)).toEqual(['price', 'out']);
    expect(a.changeCount).toBe(3);
    expect(build(qty, price, ' יגיע מחר ').body.note).toBe('יגיע מחר');
  });

  it('G-10: the explicit "as ordered" choice sends EVERY line at its ordered qty, intent as_ordered — and still carries the note', () => {
    const { qty, price } = asOrdered();
    qty.a = '6';
    const b = build(qty, price, ' יגיע מחר ');
    expect(b.discardCount).toBe(1);
    expect(b.asOrderedBody).toEqual({ intent: 'as_ordered', linesVersion: 'v1', lines: everyLineAsOrdered, note: 'יגיע מחר' });
    expect(build(qty, price).asOrderedBody).toEqual({ intent: 'as_ordered', linesVersion: 'v1', lines: everyLineAsOrdered, note: null });
  });

  it('G-10: no edits → the primary is as_ordered and its body is every line, never `lines: []`', () => {
    const { qty, price } = asOrdered();
    const b = build(qty, price);
    expect(b).toMatchObject({ primary: 'as_ordered', intent: 'as_ordered', count: 0, diff: [] });
    expect(b.body).toEqual({ intent: 'as_ordered', linesVersion: 'v1', lines: everyLineAsOrdered, note: null });
    expect(build(qty, price, 'x').body.linesVersion).toBe('v1');
  });

  it('G-10 review #6: a ₪0 order line\'s prefilled "0" is unchanged, not invalid — the primary stays as_ordered', () => {
    const zero: PortalLine[] = [...LINES, { id: 'z', name: 'דוגמית', sku: null, qtyOrdered: 1, unit: 'unit', unitPrice: 0, agreed: false }];
    const qty = { ...asOrdered().qty, z: '1' };
    const price = { ...asOrdered().price, z: '0' };
    const b = buildAnswer({ lines: zero, linesVersion: 'v', qtyText: qty, priceText: price, note: '' });
    expect(b).toMatchObject({ primary: 'as_ordered', count: 0 });
    expect(b.answer.rows.find((r) => r.line.id === 'z')).toMatchObject({ priceBad: false, priceChanged: false, price: null });
    // a real shortage on the same form is still carried by the primary
    const short = buildAnswer({ lines: zero, linesVersion: 'v', qtyText: { ...qty, a: '6' }, priceText: price, note: '' });
    expect(short).toMatchObject({ primary: 'with_changes', count: 1 });
    expect(short.body.lines.find((l) => l.poLineId === 'z')).toEqual({ poLineId: 'z', qtyAvailable: 1, proposedUnitPrice: null });
    // "8,5" for an 8.5 line is the same price too
    const same = buildAnswer({ lines: zero, linesVersion: 'v', qtyText: qty, priceText: { ...price, a: '6,50' }, note: '' });
    expect(same.primary).toBe('as_ordered');
  });

  it('G-10 review #5: a value above the server bounds is invalid inline (never a 400)', () => {
    const { qty, price } = asOrdered();
    const limits = { maxQty: 1_000_000, maxPrice: 10_000_000 };
    qty.a = '1000001';
    const big = buildAnswer({ lines: LINES, linesVersion: 'v', limits, qtyText: qty, priceText: price, note: '' });
    expect(big.primary).toBe('invalid');
    expect(big.answer.rows[0]!.qtyBad).toBe(true);
    qty.a = '1000000';
    price.b = '10000001';
    const pricey = buildAnswer({ lines: LINES, linesVersion: 'v', limits, qtyText: qty, priceText: price, note: '' });
    expect(pricey.answer.rows[0]!.qtyBad).toBe(false);
    expect(pricey.answer.rows[1]!.priceBad).toBe(true);
    expect(parseQty('1000001', 1_000_000)).toBeNull();
    expect(parseUnitPrice('10,000,000', 10_000_000)).toBe(10_000_000);
  });

  it('G-10 buildAnswer table: 0 / 1 / many changes, out of stock, note only, invalid', () => {
    const cases: Array<{ name: string; edit: (q: Record<string, string>, p: Record<string, string>) => void; note?: string; primary: string; count: number }> = [
      { name: 'none', edit: () => {}, primary: 'as_ordered', count: 0 },
      { name: 'one shortage', edit: (q) => (q.a = '6'), primary: 'with_changes', count: 1 },
      { name: 'many', edit: (q, p) => { q.a = '6'; q.b = '0'; p.a = '7'; }, primary: 'with_changes', count: 2 },
      { name: 'out of stock', edit: (q) => (q.b = '0'), primary: 'with_changes', count: 1 },
      { name: 'note only', edit: () => {}, note: 'בלי שקית', primary: 'with_changes', count: 1 },
      { name: 'invalid qty', edit: (q) => (q.a = '6kg'), primary: 'invalid', count: 1 },
      { name: 'empty qty', edit: (q) => (q.a = ''), primary: 'invalid', count: 1 },
    ];
    for (const c of cases) {
      const { qty, price } = asOrdered();
      c.edit(qty, price);
      const b = build(qty, price, c.note ?? '');
      expect({ name: c.name, primary: b.primary, count: b.count }).toEqual({ name: c.name, primary: c.primary, count: c.count });
      expect(b.body.lines).toHaveLength(LINES.length);
      if (b.primary !== 'invalid') expect(b.body.lines.every((l) => l.qtyAvailable !== null)).toBe(true);
    }
  });

  it('G-10 parsing (parseNumberInput): qty "0,250" → 0.25, price "1,250" → 1250; ambiguous or junk → null', () => {
    expect(parseQty('0,250')).toBe(0.25);
    expect(parseQty('7,5')).toBe(7.5);
    expect(parseQty('0')).toBe(0);
    expect(parseQty('1,250')).toBeNull();
    expect(parseQty('-1')).toBeNull();
    expect(parseQty('')).toBeNull();
    expect(parseUnitPrice('1,250')).toBe(1250);
    expect(parseUnitPrice('9,25')).toBe(9.25);
    expect(parseUnitPrice('₪ 12.5')).toBe(12.5);
    expect(parseUnitPrice('0')).toBeNull();
    expect(parseUnitPrice('abc')).toBeNull();
  });

  it('the answer body gives every line an explicit quantity (the server refuses partial answers)', () => {
    const { qty, price } = asOrdered();
    qty.a = '6';
    const body = build(qty, price).body;
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

describe('review findings (W1-09 correctness pass)', () => {
  it('an invalid edit with no other change blocks the send — never "confirm as is"', () => {
    const { qty, price } = asOrdered();
    qty.a = '6 ק"ג';
    const a = build(qty, price);
    expect(a.primary).toBe('invalid');
    expect(a.count).toBe(1);
    price.b = 'abc';
    qty.a = '10';
    expect(build(qty, price).primary).toBe('invalid');
    expect(build(asOrdered().qty, asOrdered().price).primary).toBe('as_ordered');
  });

  it('the answer total covers the same lines as the order total and the line totals', () => {
    const { qty, price } = asOrdered();
    price.c = '3'; // the supplier prices a line the order had no price for
    const a = computeAnswer(LINES, qty, price, '');
    expect(a.answerTotalAgorot).toBe(a.orderTotalAgorot);
    expect(a.unpriced).toBe(1);
  });

  it('a 409 on the supplier\'s own retried answer is recognised as theirs', () => {
    const { qty, price } = asOrdered();
    qty.a = '6';
    const body = build(qty, price, 'מחר').body;
    expect(isOwnAnswer(LINES, body, { lines: [{ poLineId: 'a', qtyAvailable: 6, proposedUnitPrice: null }], note: 'מחר' })).toBe(true);
    expect(isOwnAnswer(LINES, body, { lines: [{ poLineId: 'a', qtyAvailable: 5, proposedUnitPrice: null }], note: 'מחר' })).toBe(false);
    expect(isOwnAnswer(LINES, body, { lines: [{ poLineId: 'a', qtyAvailable: 6, proposedUnitPrice: null }], note: null })).toBe(false);
    // the as-ordered body (every line, no differences) matches the stored `lines: []`
    expect(isOwnAnswer(LINES, build(asOrdered().qty, asOrdered().price).body, { lines: [], note: null })).toBe(true);
  });
});
