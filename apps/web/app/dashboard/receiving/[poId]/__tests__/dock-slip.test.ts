import { describe, expect, it } from 'vitest';
import type { ReconciliationLine } from '@/app/showcase/receiver/_mock';
import { lineKey, type LineMark } from '@/app/showcase/receiver/_state';
import { buildSlipLines, issueMessageKey, lineIssues, needsSlip, slipBullet, slipNote, sumIls, type EngineSlipLine } from '../_dockSlip';

const line = (o: Partial<ReconciliationLine>): ReconciliationLine => ({
  invoiceLineIndex: 0,
  poLineId: 'pl1',
  productId: 'p1',
  productName: 'עגבניות שרי',
  productNameEn: 'Cherry tomatoes',
  poQty: 15,
  poUnit: 'ק״ג',
  invoiceQty: 15,
  invoiceUnit: 'ק״ג',
  poUnitPrice: 12.96,
  invoiceUnitPrice: 12.96,
  status: 'matched',
  deltaIls: 0,
  ...o,
});
const mark = (o: Partial<LineMark>): LineMark => ({
  poLineId: 'pl1',
  invoiceLineIndex: 0,
  productId: 'p1',
  productName: 'עגבניות שרי',
  qtyReceived: 15,
  qtyRejected: 0,
  condition: 'ok',
  touched: true,
  ...o,
});
const engine = (o: Partial<EngineSlipLine>): EngineSlipLine => ({
  discrepancyId: 'd1',
  type: 'QTY_SHORT',
  poLineId: 'pl1',
  productId: 'p1',
  productName: 'עגבניות שרי',
  productNameEn: 'Cherry tomatoes',
  lineDescription: null,
  lineDescriptionEn: null,
  expected: 15,
  actual: 13,
  amountIls: 25.92,
  ...o,
});

describe('dock slip — issues from what the receiver recorded', () => {
  it('a clean line has no issue and no slip', () => {
    expect(lineIssues(line({}), mark({}))).toEqual([]);
    expect(needsSlip(buildSlipLines([line({})], { [lineKey(line({}))]: mark({}) }, []), null)).toBe(false);
  });
  it('short, rejected, over-priced, billed-but-not-received and unordered', () => {
    expect(lineIssues(line({}), mark({ qtyReceived: 13 }))).toEqual(['short', 'billedNotReceived']);
    expect(lineIssues(line({}), mark({ qtyRejected: 2, condition: 'rejected' }))).toEqual(['rejected']);
    expect(lineIssues(line({ invoiceUnitPrice: 14 }), mark({}))).toEqual(['overPrice']);
    expect(lineIssues(line({ poLineId: null, poQty: null, poUnitPrice: null }), mark({ poLineId: null }))).toEqual([
      'unordered',
    ]);
  });
  it('"חסר" (missing) is short, never "rejected / damaged" — even with an old rejected condition', () => {
    const missing = mark({ qtyReceived: 0, qtyRejected: 0, condition: 'ok', rejectReason: 'missing' });
    expect(lineIssues(line({}), missing)).toEqual(['short', 'billedNotReceived']);
    expect(lineIssues(line({}), { ...missing, condition: 'rejected' })).not.toContain('rejected');
    const [l] = buildSlipLines([line({})], { [lineKey(line({}))]: missing }, []);
    expect(l!.rejected).toBe(0);
    expect(l!.issues).toEqual(['short', 'billedNotReceived']);
  });
  it('invoice = order = 10, 8 arrived: the slip says short (the leak RCV-01 could not record)', () => {
    const l = line({ poQty: 10, invoiceQty: 10 });
    expect(lineIssues(l, mark({ qtyReceived: 8 }))).toEqual(['short', 'billedNotReceived']);
  });
  it('a possible duplicate alone is enough for a slip', () => {
    expect(needsSlip([], '1234')).toBe(true);
  });
});

describe('dock slip — ₪ only from the engine', () => {
  it('a flagged line without an engine discrepancy shows quantities only (no client-side ₪)', () => {
    const [l] = buildSlipLines([line({ deltaIls: 99 })], { [lineKey(line({}))]: mark({ qtyReceived: 13 }) }, []);
    expect(l!.amountIls).toBeNull();
    expect(l!.issues).toContain('short');
  });
  it('attaches each engine amount to its PO line once; unmatched engine findings get their own row', () => {
    const lines = buildSlipLines(
      [line({}), line({ poLineId: 'pl2', productId: 'p2', productName: 'מלפפון' })],
      { [lineKey(line({}))]: mark({ qtyReceived: 13 }), [lineKey(line({ poLineId: 'pl2' }))]: mark({ poLineId: 'pl2', productId: 'p2' }) },
      [
        engine({}),
        engine({ discrepancyId: 'd2', type: 'PRICE_HIGHER', amountIls: 10.05 }),
        engine({ discrepancyId: 'd3', type: 'DUPLICATE_INVOICE', poLineId: null, productId: null, productName: null, amountIls: 4.1 }),
      ],
    );
    expect(lines.map((l) => l.key)).toEqual([lineKey(line({})), 'engine-d3']);
    expect(lines[0]!.amountIls).toBe(35.97);
    expect(lines[0]!.engineTypes).toEqual(['QTY_SHORT', 'PRICE_HIGHER']);
    expect(lines[1]!.amountIls).toBe(4.1);
    expect(sumIls(lines.map((l) => l.amountIls ?? 0))).toBe(40.07);
  });
  it('an unordered invoice line is matched to the engine by product', () => {
    const [l] = buildSlipLines(
      [line({ poLineId: null, poQty: null, poUnitPrice: null, invoiceLineIndex: 3, productId: 'p9', productName: 'שמנת' })],
      {},
      [engine({ poLineId: null, productId: 'p9', type: 'UNORDERED_ITEM', amountIls: 72 })],
    );
    expect(l!.issues).toContain('unordered');
    expect(l!.amountIls).toBe(72);
  });
  it('sums in agorot (no float drift)', () => {
    expect(sumIls([0.1, 0.2])).toBe(0.3);
    expect(sumIls([194.4, 0.01, 12.96])).toBe(207.37);
  });
});

describe('dock slip — shared text', () => {
  it('an item line reads "name: issues — ₪"', () => {
    expect(slipBullet('עגבניות', ['חסר 2', 'מחיר גבוה'], '₪25.00')).toBe('• עגבניות: חסר 2; מחיר גבוה — ₪25.00');
  });
  it('an invoice-level finding (no item name) has no empty "• :" prefix', () => {
    expect(slipBullet('', ['אי־התאמה במע״מ'], '₪4.10')).toBe('• אי־התאמה במע״מ — ₪4.10');
  });
  it('no engine ₪ → no amount', () => {
    expect(slipBullet('מלפפון', ['חסר 1'], null)).toBe('• מלפפון: חסר 1');
  });
});

describe('dock slip — no ₪ before the engine', () => {
  it('an over-price line quotes no price until the post-count run is in', () => {
    expect(issueMessageKey('overPrice', false)).toBe('overPriceNoAmount');
    expect(issueMessageKey('overPrice', true)).toBe('overPrice');
    expect(issueMessageKey('short', false)).toBe('short');
  });
});

describe('dock slip — status note', () => {
  const e = (o: Partial<{ receiptClosed: boolean; ready: boolean; holdReason: string | null }>) => ({
    receiptClosed: true,
    ready: false,
    holdReason: null,
    ...o,
  });
  it('receipt open → "after close"; ready or no invoice → nothing', () => {
    expect(slipNote(e({ receiptClosed: false }), true, false)).toBe('afterClose');
    expect(slipNote(e({ ready: true }), true, false)).toBeNull();
    expect(slipNote(e({}), false, false)).toBeNull();
  });
  it('a held re-match says so at once — no spinner, no "will follow"', () => {
    expect(slipNote(e({ holdReason: 'awaiting_review' }), true, false)).toBe('held');
    expect(slipNote(e({ holdReason: 'settled' }), true, true)).toBe('held');
  });
  it('otherwise the spinner, then the calm "slow" note', () => {
    expect(slipNote(e({}), true, false)).toBe('computing');
    expect(slipNote(e({}), true, true)).toBe('slow');
  });
  it('engine findings alone (VAT / total / duplicate) are enough for a slip', () => {
    const lines = buildSlipLines([], {}, [
      { discrepancyId: 'v', type: 'VAT_MISMATCH', poLineId: null, productId: null, productName: null, productNameEn: null, lineDescription: null, lineDescriptionEn: null, expected: null, actual: null, amountIls: 12.5 },
    ]);
    expect(needsSlip(lines, null)).toBe(true);
  });
});
