import { describe, expect, it } from 'vitest';
import type { ReconciliationLine, ReconciliationResult } from '@/app/showcase/receiver/_mock';
import { asOrderedPatch, lineKey, MISSING_PATCH, DAMAGED_PATCH, type LineMark } from '@/app/showcase/receiver/_state';
import {
  billedBeside,
  dockGaps,
  farNote,
  gapNote,
  isAsOrdered,
  mainAction,
  needsCloseCheck,
  orderedForCount,
  qtyAgrees,
  rowNote,
  rowState,
} from '../_dock';

/** The engine's defaults (packages/matching DEFAULT_TOLERANCES): ±3 % and 1 unit. */
const TOL = { qtyPercent: 0.03, qtyAbsolute: 1 };

function line(over: Partial<ReconciliationLine> & { id: string }): ReconciliationLine {
  const { id, ...rest } = over;
  return {
    invoiceLineIndex: null,
    poLineId: id,
    productId: null,
    productName: `פריט ${id}`,
    poQty: 10,
    poUnit: 'ק״ג',
    invoiceQty: null,
    invoiceUnit: null,
    poUnitPrice: null,
    invoiceUnitPrice: null,
    status: 'pending_review',
    deltaIls: 0,
    ...rest,
  };
}

function fresh(l: ReconciliationLine): LineMark {
  return {
    poLineId: l.poLineId,
    invoiceLineIndex: l.invoiceLineIndex,
    productId: l.productId,
    productName: l.productName,
    qtyReceived: l.poQty ?? 0,
    qtyRejected: 0,
    condition: 'ok',
    touched: false,
  };
}

const counted = (l: ReconciliationLine, patch: Partial<LineMark>, method: LineMark['method'] = 'per_line'): LineMark => ({
  ...fresh(l),
  ...patch,
  touched: true,
  method,
});

function result(lines: ReconciliationLine[]): ReconciliationResult {
  return {
    invoiceMeta: { invoiceNumber: '', invoiceDate: '', totalInclVat: 0, ocrConfidence: 0, noInvoice: true },
    matchedSupplierId: 's',
    matchedPoIds: ['p'],
    lines,
    summary: { matchedCount: 0, qtyDiffCount: 0, priceDiffCount: 0, unorderedCount: 0, missingCount: 0, overallConfidence: 0, headlineDelta: 0 },
  };
}

const marksOf = (pairs: [ReconciliationLine, LineMark][]): Record<string, LineMark> => Object.fromEntries(pairs.map(([l, m]) => [lineKey(l), m]));

describe('dock count rows (DS3-05)', () => {
  const a = line({ id: 'a' });
  const unordered = line({ id: 'u', poLineId: null, poQty: null, invoiceLineIndex: 0, invoiceQty: 6 });

  it('a row nobody counted is open and says what was ordered — never what was billed', () => {
    expect(rowState(a, fresh(a))).toBe('open');
    expect(rowNote(a, fresh(a))).toEqual({ kind: 'ordered', ordered: 10, damaged: false });
    expect(rowState(unordered, undefined)).toBe('open');
    expect(rowNote(unordered, undefined)).toEqual({ kind: 'notOrdered' });
  });

  it('the tick (as ordered) is ok and adds nothing; a bulk mark says it was not counted one by one', () => {
    const m = counted(a, asOrderedPatch(a));
    expect(isAsOrdered(a, m)).toBe(true);
    expect(rowState(a, m)).toBe('ok');
    expect(rowNote(a, m)).toBeNull();
    const bulk = counted(a, asOrderedPatch(a), 'bulk_as_ordered');
    expect(rowNote(a, bulk)).toEqual({ kind: 'bulk' });
  });

  it('a count inside the engine tolerance is as ordered (28 of 28.5 kg); outside it is a gap (8 of 10)', () => {
    const p = line({ id: 'p', poQty: 28.5 });
    expect(qtyAgrees(p, 28, TOL)).toBe(true);
    expect(qtyAgrees(p, 28, undefined)).toBe(false);
    expect(rowState(p, counted(p, { qtyReceived: 28 }), TOL)).toBe('ok');
    expect(rowState(a, counted(a, { qtyReceived: 8 }), TOL)).toBe('gap');
    // Small orders still flag: 2 of 3 units is 1 unit off but 33 %.
    const s = line({ id: 's', poQty: 3, poUnit: 'יח׳' });
    expect(rowState(s, counted(s, { qtyReceived: 2 }), TOL)).toBe('gap');
  });

  it('a gap row says "חסר", "הגיע פגום" or what was ordered (the count sits at the row end)', () => {
    expect(rowNote(a, counted(a, MISSING_PATCH), TOL)).toEqual({ kind: 'missing' });
    expect(rowNote(a, counted(a, { ...asOrderedPatch(a), ...DAMAGED_PATCH }), TOL)).toEqual({ kind: 'damaged' });
    expect(rowNote(a, counted(a, { qtyReceived: 6 }), TOL)).toEqual({ kind: 'ordered', ordered: 10, damaged: false });
    expect(rowNote(a, counted(a, { qtyReceived: 6, ...DAMAGED_PATCH }), TOL)).toEqual({ kind: 'ordered', ordered: 10, damaged: true });
    expect(rowState(a, counted(a, { ...asOrderedPatch(a), ...DAMAGED_PATCH }), TOL)).toBe('gap');
  });

  it('an item not on the order: arrived is a gap, did not arrive leaves nothing to say', () => {
    expect(rowState(unordered, counted(unordered, { qtyReceived: 4 }))).toBe('gap');
    expect(rowNote(unordered, counted(unordered, { qtyReceived: 4 }))).toEqual({ kind: 'notOrdered' });
    expect(rowState(unordered, counted(unordered, MISSING_PATCH))).toBe('ok');
    expect(rowNote(unordered, counted(unordered, MISSING_PATCH))).toBeNull();
    expect(isAsOrdered(unordered, counted(unordered, { qtyReceived: 6 }))).toBe(false);
  });

  it('shows the billed quantity beside the order only when the invoice says something else', () => {
    expect(billedBeside(a)).toBeNull();
    expect(billedBeside(line({ id: 'b', invoiceQty: 10 }))).toBeNull();
    expect(billedBeside(line({ id: 'c', invoiceQty: 12 }))).toBe(12);
    expect(billedBeside(unordered)).toBe(6);
  });

  it('puts the lines that need eyes first, keeping their order', () => {
    const x = line({ id: 'x' });
    const y = line({ id: 'y', status: 'qty_diff' });
    const z = line({ id: 'z', status: 'unordered' });
    expect(orderedForCount([x, y, z]).map((l) => l.poLineId)).toEqual(['y', 'z', 'x']);
  });
});

describe('the quantity sheet note (DS3-05)', () => {
  const p = line({ id: 'p', poQty: 28.5 });

  it('says nothing inside the tolerance, for 0 or with no number', () => {
    expect(farNote(p, 28.5, TOL)).toBeNull();
    expect(farNote(p, 28, TOL)).toBeNull();
    expect(farNote(p, 0, TOL)).toBeNull();
    expect(farNote(p, null, TOL)).toBeNull();
    expect(farNote(p, 24, undefined)).toBeNull();
    expect(farNote(line({ id: 'u', poLineId: null, poQty: null }), 4, TOL)).toBeNull();
  });

  it('says how far a number is from the order, and "more than double" above 2×', () => {
    const n = farNote(p, 24, TOL);
    expect(n?.kind).toBe('pct');
    expect(n && n.kind === 'pct' ? Math.round(n.pct * 100) : 0).toBe(16);
    expect(farNote(p, 60, TOL)).toEqual({ kind: 'double', ordered: 28.5 });
  });
});

describe('the one button at the bottom (DS3-05)', () => {
  const a = line({ id: 'a' });
  const b = line({ id: 'b' });
  const c = line({ id: 'c' });
  const u = line({ id: 'u', poLineId: null, poQty: null, invoiceLineIndex: 0 });
  const r = result([a, b, c]);

  it('nothing counted: everything arrived (N)', () => {
    expect(mainAction({ result: r, marks: marksOf([[a, fresh(a)], [b, fresh(b)], [c, fresh(c)]]), spotMismatch: false, closing: false })).toEqual({ kind: 'all', count: 3 });
  });

  it('some counted: mark the rest (N)', () => {
    const marks = marksOf([[a, counted(a, asOrderedPatch(a))], [b, fresh(b)], [c, fresh(c)]]);
    expect(mainAction({ result: r, marks, spotMismatch: false, closing: false })).toEqual({ kind: 'rest', count: 2 });
  });

  it('every line resolved: close; while closing: closing', () => {
    const marks = marksOf([[a, counted(a, asOrderedPatch(a))], [b, counted(b, MISSING_PATCH)], [c, counted(c, { qtyReceived: 4 })]]);
    expect(mainAction({ result: r, marks, spotMismatch: false, closing: false })).toEqual({ kind: 'close' });
    expect(mainAction({ result: r, marks, spotMismatch: false, closing: true })).toEqual({ kind: 'closing' });
  });

  it('after a spot check found a difference no bulk is offered: the close waits for every line', () => {
    const marks = marksOf([[a, counted(a, { qtyReceived: 4 }, 'spot_check')], [b, fresh(b)], [c, fresh(c)]]);
    expect(mainAction({ result: r, marks, spotMismatch: true, closing: false })).toEqual({ kind: 'wait', remaining: 2 });
  });

  it('only an item that is not on the order left: "as ordered" says nothing about it, so the close waits', () => {
    const r2 = result([a, u]);
    const marks = marksOf([[a, counted(a, asOrderedPatch(a))], [u, { ...fresh(u), qtyReceived: 0 }]]);
    expect(mainAction({ result: r2, marks, spotMismatch: false, closing: false })).toEqual({ kind: 'wait', remaining: 1 });
  });
});

describe('the check before closing and the end screen (DS3-05)', () => {
  const a = line({ id: 'a' });
  const b = line({ id: 'b', poQty: 28.5 });
  const c = line({ id: 'c', poQty: 6, poUnit: 'יח׳' });
  const u = line({ id: 'u', poLineId: null, poQty: null, invoiceLineIndex: 0, invoiceQty: 3 });

  it('a clean receipt has no gaps — even with a count inside the tolerance or a bulk mark', () => {
    const r = result([a, b]);
    const marks = marksOf([[a, counted(a, asOrderedPatch(a), 'bulk_as_ordered')], [b, counted(b, { qtyReceived: 28 }, 'spot_check')]]);
    expect(dockGaps(r, marks, TOL)).toEqual([]);
  });

  it('names missing, short, over, damaged and an item that arrived without an order, in the count order', () => {
    const r = result([a, b, c, u]);
    const marks = marksOf([
      [a, counted(a, MISSING_PATCH)],
      [b, counted(b, { qtyReceived: 24, ...DAMAGED_PATCH })],
      [c, counted(c, { qtyReceived: 8 })],
      [u, counted(u, { qtyReceived: 3 })],
    ]);
    expect(dockGaps(r, marks, TOL).map((g) => [g.key, g.note])).toEqual([
      [lineKey(a), { kind: 'missing' }],
      [lineKey(b), { kind: 'short', got: 24, ordered: 28.5, damaged: true }],
      [lineKey(c), { kind: 'over', got: 8, ordered: 6, damaged: false }],
      [lineKey(u), { kind: 'unordered', got: 3 }],
    ]);
    expect(gapNote(a, counted(a, { ...asOrderedPatch(a), ...DAMAGED_PATCH }), TOL)).toEqual({ kind: 'damaged' });
  });

  it('what was billed is not a dock gap: only the count against the order', () => {
    const billedMore = line({ id: 'x', invoiceQty: 12, status: 'qty_diff' });
    const r = result([billedMore]);
    expect(dockGaps(r, marksOf([[billedMore, counted(billedMore, asOrderedPatch(billedMore))]]), TOL)).toEqual([]);
  });

  it('lines nobody counted, or an item not on the order that did not arrive, are not gaps', () => {
    const r = result([a, u]);
    expect(dockGaps(r, marksOf([[a, fresh(a)], [u, counted(u, MISSING_PATCH)]]), TOL)).toEqual([]);
    expect(dockGaps(null, {}, TOL)).toEqual([]);
  });

  it('a clean receipt closes in one tap; a gap shows the check; no photo is asked only when the count comes first', () => {
    expect(needsCloseCheck({ gaps: 0, photographed: false, countFirst: false })).toBe(false);
    expect(needsCloseCheck({ gaps: 0, photographed: true, countFirst: true })).toBe(false);
    expect(needsCloseCheck({ gaps: 1, photographed: true, countFirst: false })).toBe(true);
    expect(needsCloseCheck({ gaps: 0, photographed: false, countFirst: true })).toBe(true);
  });
});
