import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCES, type InvoiceLineInput, type MatchInput } from '@restomatch/matching';
import {
  buildConsolidatedProposal,
  consolidatedPeriod,
  countsAsLeak,
  deliveryNoteNumberIn,
  periodOfInvoice,
  readConsolidatedRaw,
  type DeliveryNoteData,
  type DeliveryNoteLineData,
} from '../match/consolidated';

/**
 * Pure cross-match (הצלבה) of a consolidated invoice against delivery notes —
 * the engine runs in memory on the per-product fold of the notes.
 */
const CHALLAH = 'p-challah';
const ROLLS = 'p-rolls';
const VAT = 0.18;

let seq = 0;
const noteLine = (productId: string, qty: number, price: number, over: Partial<DeliveryNoteLineData> = {}): DeliveryNoteLineData => {
  seq += 1;
  return {
    grLineId: `grl-${seq}`,
    poLineId: `pol-${seq}`,
    productId,
    supplierSku: null,
    name: productId === CHALLAH ? 'חלה' : 'לחמניות',
    nameEn: productId === CHALLAH ? 'Challah' : 'Rolls',
    unit: 'יח׳',
    qtyOrdered: qty,
    qtyReceived: qty,
    poPrice: price,
    ...over,
  };
};
const note = (grId: string, day: number, lines: DeliveryNoteLineData[], number: string | null = null): DeliveryNoteData => ({
  grId,
  poId: `po-${grId}`,
  number,
  poRef: `PO-${grId}`,
  receivedAt: new Date(Date.UTC(2026, 9, day, 6, 0, 0)),
  lines,
});
const invLine = (productId: string, qty: number, price: number): InvoiceLineInput => {
  seq += 1;
  return { id: `il-${seq}`, productId, qtyBilled: qty, unit: 'יח׳', unitPriceBilled: price, lineTotal: Math.round(qty * price * 100) / 100 };
};
function base(lines: InvoiceLineInput[]): MatchInput {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal * 100, 0)) / 100;
  const vat = Math.round(subtotal * VAT * 100) / 100;
  return {
    invoice: {
      invoiceNumber: 'BR-R-24101',
      invoiceDate: new Date(Date.UTC(2026, 9, 31, 8, 0, 0)),
      supplierId: 'sup-1',
      totalExclVat: subtotal,
      vatAmount: vat,
      totalInclVat: Math.round((subtotal + vat) * 100) / 100,
    },
    poLines: [],
    grLines: [],
    invoiceLines: lines,
    vatRate: VAT,
    tolerances: DEFAULT_TOLERANCES,
  };
}
const propose = (invoice: InvoiceLineInput[], notes: DeliveryNoteData[]) =>
  buildConsolidatedProposal({
    invoiceId: 'inv-1',
    supplierId: 'sup-1',
    periodStart: new Date('2026-09-27T21:00:00Z'),
    periodEnd: new Date('2026-11-02T22:00:00Z'),
    base: base(invoice),
    notes,
  });

// Two delivery notes: challah 10 + rolls 20, then challah 5 — at the PO prices.
const twoNotes = () => [note('gr-1', 5, [noteLine(CHALLAH, 10, 5), noteLine(ROLLS, 20, 2)]), note('gr-2', 12, [noteLine(CHALLAH, 5, 5)])];

describe('buildConsolidatedProposal', () => {
  it('happy path: the invoice bills exactly what the notes delivered → matched, calm', () => {
    const p = propose([invLine(CHALLAH, 15, 5), invLine(ROLLS, 20, 2)], twoNotes());
    expect(p.status).toBe('matched');
    expect(p.deliveryNotes.map((n) => [n.grId, n.status, n.receivedValueIls])).toEqual([
      ['gr-1', 'covered', 90],
      ['gr-2', 'covered', 25],
    ]);
    expect(p.products.map((r) => [r.productId, r.qtyReceived, r.qtyBilled, r.poPrice, r.billedPrice, r.status])).toEqual(
      expect.arrayContaining([
        [CHALLAH, 15, 15, 5, 5, 'ok'],
        [ROLLS, 20, 20, 2, 2, 'ok'],
      ]),
    );
    expect(p.totals).toMatchObject({ deliveryNotesIls: 115, invoiceSubtotalIls: 115, differenceIls: 0, leakIls: 0 });
    expect(p.findings.filter((f) => f.countsAsLeak)).toEqual([]);
  });

  it('one product billed above the PO price → PRICE_HIGHER, ₪ difference on that product', () => {
    const p = propose([invLine(CHALLAH, 15, 5.5), invLine(ROLLS, 20, 2)], twoNotes());
    expect(p.status).toBe('differences');
    const challah = p.products.find((r) => r.productId === CHALLAH)!;
    expect(challah).toMatchObject({ status: 'difference', poPrice: 5, billedPrice: 5.5 });
    expect(challah.deltaIls).toBe(7.5); // ₪0.50 × 15
    expect(p.findings.find((f) => f.countsAsLeak)?.type).toBe('PRICE_HIGHER');
    expect(p.totals).toMatchObject({ deliveryNotesIls: 115, invoiceSubtotalIls: 122.5, differenceIls: 7.5, leakIls: 7.5 });
    // Rolls untouched.
    expect(p.products.find((r) => r.productId === ROLLS)!.status).toBe('ok');
  });

  it('a delivery note missing from the invoice → that note is "not billed"; under-billing is not a leak', () => {
    const p = propose([invLine(CHALLAH, 10, 5), invLine(ROLLS, 20, 2)], twoNotes());
    expect(p.deliveryNotes.map((n) => [n.grId, n.status])).toEqual([
      ['gr-1', 'covered'],
      ['gr-2', 'not_billed'],
    ]);
    expect(p.totals.differenceIls).toBe(-25);
    expect(p.totals.leakIls).toBe(0);
  });

  it('a delivery billed twice (two invoice lines for the same goods) → billed more than delivered, leak at the billed price', () => {
    const p = propose([invLine(CHALLAH, 15, 5), invLine(CHALLAH, 15, 5), invLine(ROLLS, 20, 2)], twoNotes());
    expect(p.status).toBe('differences');
    const challah = p.products.find((r) => r.productId === CHALLAH)!;
    expect(challah).toMatchObject({ qtyReceived: 15, qtyBilled: 30, status: 'difference' });
    expect(challah.deltaIls).toBeGreaterThanOrEqual(75); // the extra 15 × ₪5
    expect(p.totals.differenceIls).toBe(75);
  });

  it('a product billed that no delivery note has → not received, counted', () => {
    const p = propose([invLine(CHALLAH, 15, 5), invLine(ROLLS, 20, 2), invLine('p-cake', 2, 40)], twoNotes());
    const cake = p.products.find((r) => r.productId === 'p-cake')!;
    expect(cake).toMatchObject({ status: 'not_received', qtyReceived: 0, qtyBilled: 2, poPrice: null });
    expect(cake.deltaIls).toBe(80);
    expect(p.totals.leakIls).toBe(80);
  });

  it('a partly billed note: billed qty is allocated to the notes oldest first', () => {
    const p = propose([invLine(CHALLAH, 12, 5), invLine(ROLLS, 20, 2)], twoNotes());
    expect(p.deliveryNotes.map((n) => [n.grId, n.status])).toEqual([
      ['gr-1', 'covered'],
      ['gr-2', 'partly'],
    ]);
  });

  it('the leak is capped at the invoice total (the hero’s per-invoice rule)', () => {
    const p = propose([invLine(CHALLAH, 1, 1)], [note('gr-x', 3, [noteLine(ROLLS, 1, 1)])]);
    // Billed challah never delivered (₪1) + … can never exceed ₪1.18 incl. VAT.
    expect(p.totals.leakIls).toBeLessThanOrEqual(p.totals.invoiceTotalInclVat);
  });

  it('no delivery notes in the period → nothing to cross-match (calm), the engine is not asked to invent one', () => {
    const p = propose([invLine(CHALLAH, 15, 5)], []);
    expect(p.status).toBe('no_delivery_notes');
    expect(p.deliveryNotes).toEqual([]);
    expect(p.products[0]).toMatchObject({ status: 'not_received' });
  });
});

describe('buildConsolidatedProposal — an itemized ריכוז (one line per delivery note × product)', () => {
  const MILK = 'p-milk';
  const EGGS = 'p-eggs';
  const MILK_QTY = [24, 30, 18, 24, 30, 24, 24, 30];
  // The demo's GD-M shape: 8 drops of milk (₪6.40) + eggs (₪34), each its own note
  // `ת.מ. 6103x`; the invoice bills each note on its own lines.
  const scenario = (overcharge: { note: number; price: number } | null) => {
    const notes = MILK_QTY.map((q, i) =>
      note(`gr-${i}`, 3 + i * 3, [noteLine(MILK, q, 6.4), noteLine(EGGS, i % 2 ? 3 : 2, 34)], String(61036 + i)),
    );
    const lines: InvoiceLineInput[] = [];
    const lineNotes = new Map<string, string>();
    MILK_QTY.forEach((q, i) => {
      const milk = invLine(MILK, q, overcharge?.note === i ? overcharge.price : 6.4);
      const eggs = invLine(EGGS, i % 2 ? 3 : 2, 34);
      lines.push(milk, eggs);
      lineNotes.set(milk.id, String(61036 + i));
      lineNotes.set(eggs.id, String(61036 + i));
    });
    return { notes, lines, lineNotes };
  };
  const proposeItemized = (s: ReturnType<typeof scenario>) =>
    buildConsolidatedProposal({
      invoiceId: 'inv-gd',
      supplierId: 'sup-gd',
      periodStart: new Date('2026-08-31T21:00:00Z'),
      periodEnd: new Date('2026-09-30T21:00:00Z'),
      base: base(s.lines),
      notes: s.notes,
      invoiceLineNotes: s.lineNotes,
    });

  it('billed exactly as delivered → matched, every note covered, no finding at all', () => {
    const p = proposeItemized(scenario(null));
    expect(p.status).toBe('matched');
    expect(p.findings).toEqual([]);
    expect(p.deliveryNotes.every((n) => n.status === 'covered' && n.deltaIls === 0)).toBe(true);
    expect(p.totals.differenceIls).toBe(0);
  });

  it('milk 24 L at ₪7.90 instead of ₪6.40 on ONE note → exactly ₪36.00, on that note, nothing else fires', () => {
    const p = proposeItemized(scenario({ note: 0, price: 7.9 }));
    expect(p.status).toBe('differences');
    expect(p.findings.map((f) => [f.type, f.deltaAmount, f.deliveryNoteNumber, f.countsAsLeak])).toEqual([
      ['PRICE_HIGHER', 36, '61036', true],
    ]);
    expect(p.totals).toMatchObject({ leakIls: 36, differenceIls: 36 });
    expect(p.deliveryNotes.map((n) => [n.number, n.deltaIls])).toEqual(MILK_QTY.map((_, i) => [String(61036 + i), i === 0 ? 36 : 0]));
    const milk = p.products.find((r) => r.productId === MILK)!;
    expect(milk).toMatchObject({ status: 'difference', deltaIls: 36, poPrice: 6.4, qtyReceived: 204, qtyBilled: 204 });
    expect(p.products.find((r) => r.productId === EGGS)!.status).toBe('ok');
  });

  it('a line naming a note that is not a candidate falls back to the pool (no orphan pairing)', () => {
    const s = scenario(null);
    s.lineNotes.set(s.lines[0]!.id, '99999');
    const p = proposeItemized(s);
    // Note 61036 stays itemized (its eggs line names it); its unpaired milk line and the
    // pooled milk line are ordered after every paired one, so they still pair: billed as delivered.
    expect(p.status).toBe('matched');
    expect(p.findings.filter((f) => f.countsAsLeak)).toEqual([]);
  });
});

describe('buildConsolidatedProposal — #95 review (P0)', () => {
  const MILK = 'p-milk';
  const EGGS = 'p-eggs';
  const QTY = [24, 30, 18, 24, 30, 24, 24, 30];
  const itemized = (opts: { overcharge?: boolean; dropNote?: number; under?: boolean } = {}) => {
    const notes = QTY.map((q, i) => note(`gr-${i}`, 3 + i * 3, [noteLine(MILK, q, 6.4), noteLine(EGGS, 2, 34)], String(61036 + i)));
    const lines: InvoiceLineInput[] = [];
    const lineNotes = new Map<string, string>();
    QTY.forEach((q, i) => {
      if (opts.dropNote === i) return;
      const price = opts.overcharge && i === 0 ? 7.9 : opts.under && i === 1 ? 6.0 : 6.4;
      for (const l of [invLine(MILK, q, price), invLine(EGGS, 2, 34)]) {
        lines.push(l);
        lineNotes.set(l.id, String(61036 + i));
      }
    });
    return buildConsolidatedProposal({
      invoiceId: 'inv-gd',
      supplierId: 'sup-gd',
      periodStart: new Date('2026-08-31T21:00:00Z'),
      periodEnd: new Date('2026-09-30T21:00:00Z'),
      base: base(lines),
      notes,
      invoiceLineNotes: lineNotes,
    });
  };

  it('a delivered note the invoice does not bill is under-billing, not leak — the ₪36 stays ₪36', () => {
    const p = itemized({ overcharge: true, dropNote: 7 });
    expect(p.totals.leakIls).toBe(36);
    expect(p.findings.filter((f) => f.countsAsLeak).map((f) => [f.type, f.deltaAmount, f.deliveryNoteNumber])).toEqual([
      ['PRICE_HIGHER', 36, '61036'],
    ]);
    expect(p.findings.some((f) => f.type === 'MISSING_ON_INVOICE' && !f.countsAsLeak)).toBe(true);
    expect(p.deliveryNotes.find((n) => n.number === '61043')).toMatchObject({ status: 'not_billed', deltaIls: 0 });
    expect(p.totals.differenceIls).toBeLessThan(0); // billed less than delivered overall
  });

  it('a note billed BELOW its PO price is never leak (negative Δ)', () => {
    const p = itemized({ under: true });
    expect(p.findings.filter((f) => f.countsAsLeak)).toEqual([]);
    expect(p.totals.leakIls).toBe(0);
    // Whatever the type: a Δ that is not positive never counts.
    expect(countsAsLeak({ type: 'TOTAL_MISMATCH', severity: 'block', deltaAmount: -5 })).toBe(false);
    expect(countsAsLeak({ type: 'MISSING_ON_INVOICE', severity: 'block', deltaAmount: 64 })).toBe(false);
  });

  it('PO prices keep 4 decimals through the fold (₪2.385 × 100 = ₪238.50, not ₪238.00)', () => {
    const p = buildConsolidatedProposal({
      invoiceId: 'inv-4',
      supplierId: 'sup',
      periodStart: new Date('2026-09-27T21:00:00Z'),
      periodEnd: new Date('2026-11-02T22:00:00Z'),
      base: base([{ id: 'il-4', productId: CHALLAH, qtyBilled: 100, unit: 'יח׳', unitPriceBilled: 2.385, lineTotal: 238.5 }]),
      notes: [note('gr-4', 5, [noteLine(CHALLAH, 100, 2.385)])],
    });
    expect(p.deliveryNotes[0]!.receivedValueIls).toBe(238.5);
    expect(p.products[0]!.poPrice).toBe(2.385);
    expect(p.totals).toMatchObject({ differenceIls: 0, leakIls: 0 });
    expect(p.status).toBe('matched');
  });

  it('pooled notes compare AMOUNTS: 1.6% over a monthly average is still ₪3.00 billed above the notes', () => {
    // Three un-numbered drops of 10 at ₪6.40, billed as one line of 30 at ₪6.50 —
    // under the engine's 2% per-unit tolerance, but ₪3.00 more than delivered.
    const notes = [1, 2, 3].map((i) => note(`gr-p${i}`, i * 5, [noteLine(CHALLAH, 10, 6.4)]));
    const p = propose([invLine(CHALLAH, 30, 6.5)], notes);
    expect(p.findings.filter((f) => f.countsAsLeak).map((f) => [f.type, f.deltaAmount])).toEqual([['PRICE_HIGHER', 3]]);
    expect(p.totals).toMatchObject({ differenceIls: 3, leakIls: 3 });
    expect(p.status).toBe('differences');
  });

  it('never "matched" while the invoice bills more than the notes are worth', () => {
    const notes = [note('gr-x', 5, [noteLine(CHALLAH, 10, 6.4)])];
    // ₪0.01 over on the subtotal (no line-level finding can explain it).
    const b = base([invLine(CHALLAH, 10, 6.4)]);
    b.invoice.totalExclVat = 64.01;
    const p = buildConsolidatedProposal({ invoiceId: 'i', supplierId: 's', periodStart: new Date(), periodEnd: new Date(), base: b, notes });
    expect(p.totals.differenceIls).toBe(0.01);
    expect(p.status).toBe('differences');
  });

  it('units convert through the fold and the per-note allocation (note in kg, invoice in g)', () => {
    const p = propose(
      [{ id: 'il-g', productId: CHALLAH, qtyBilled: 2000, unit: 'g', unitPriceBilled: 0.01, lineTotal: 20 }],
      [note('gr-kg', 5, [noteLine(CHALLAH, 2, 10, { unit: 'kg' })])],
    );
    expect(p.deliveryNotes[0]).toMatchObject({ status: 'covered', receivedValueIls: 20 });
    expect(p.products[0]).toMatchObject({ qtyReceived: 2, qtyBilled: 2, status: 'ok' });
    expect(p.status).toBe('matched');
  });
});

describe('readConsolidatedRaw / periodOfInvoice / deliveryNoteNumberIn', () => {
  it('reads the consolidated payload; anything else is not one', () => {
    expect(
      readConsolidatedRaw({
        raw: { kind: 'consolidated', periodStart: '2026-09-01', periodEnd: '2026-09-30', deliveryNotes: [{ number: '61036' }, { number: 61037 }, { number: 'x' }, {}] },
      }),
    ).toEqual({ periodStart: '2026-09-01', periodEnd: '2026-09-30', deliveryNoteNumbers: ['61036', '61037'] });
    expect(readConsolidatedRaw({ raw: { kind: 'invoice' } })).toBeNull();
    expect(readConsolidatedRaw(null)).toBeNull();
    expect(readConsolidatedRaw({ raw: { kind: 'consolidated', periodStart: 'Sept' } })).toEqual({
      periodStart: null,
      periodEnd: null,
      deliveryNoteNumbers: [],
    });
  });

  it("an invoice dated Oct 1 for September bills September (its stated period), not October", () => {
    const at = new Date('2026-10-01T08:00:00Z');
    const p = periodOfInvoice(at, readConsolidatedRaw({ raw: { kind: 'consolidated', periodStart: '2026-09-01', periodEnd: '2026-09-30' } }));
    expect(p.start.toISOString()).toBe('2026-08-31T21:00:00.000Z'); // Sept 1 00:00 Israel (UTC+3)
    expect(p.end.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // Oct 1 00:00 Israel — end exclusive
    // No stated period → the invoice date's month ± 3 days.
    expect(periodOfInvoice(at, null).start.toISOString()).toBe(consolidatedPeriod(at).start.toISOString());
  });

  it('finds a delivery-note number in a line description (Hebrew or English)', () => {
    expect(deliveryNoteNumberIn('ת.מ. 61036 · חלב 3%')).toBe('61036');
    expect(deliveryNoteNumberIn('ת.מ 8801 לחמניות')).toBe('8801');
    expect(deliveryNoteNumberIn('DN 61036 · Milk 3%')).toBe('61036');
    expect(deliveryNoteNumberIn('חלב 3% 24 ליטר')).toBeNull();
    expect(deliveryNoteNumberIn(null)).toBeNull();
  });
});

describe('consolidatedPeriod (Asia/Jerusalem month, ±3 days)', () => {
  it('mid-October (summer time, UTC+3)', () => {
    const p = consolidatedPeriod(new Date('2026-10-15T09:00:00Z'));
    expect(p.monthStart.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // Oct 1 00:00 IL
    expect(p.monthEnd.toISOString()).toBe('2026-10-31T22:00:00.000Z'); // Nov 1 00:00 IL (winter, UTC+2)
    expect(p.start.toISOString()).toBe('2026-09-27T21:00:00.000Z'); // Sep 28
    expect(p.end.toISOString()).toBe('2026-11-03T22:00:00.000Z'); // Nov 4
  });

  it('00:30 on Nov 1 in Israel is November, though it is still Oct 31 in UTC', () => {
    const p = consolidatedPeriod(new Date('2026-10-31T22:30:00Z'));
    expect(p.monthStart.toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(p.start.toISOString()).toBe('2026-10-28T22:00:00.000Z'); // Oct 29 00:00 IL
    expect(p.end.toISOString()).toBe('2026-12-03T22:00:00.000Z'); // Dec 4 00:00 IL
  });

  it('23:30 on Oct 31 in Israel is still October', () => {
    const p = consolidatedPeriod(new Date('2026-10-31T21:30:00Z'));
    expect(p.monthStart.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });
});
