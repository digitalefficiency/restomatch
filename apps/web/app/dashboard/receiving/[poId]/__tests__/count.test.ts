import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UNCOUNTED,
  bulkAsOrdered,
  fromGrLine,
  grLineIsCounted,
  pickSpotCheck,
  readMethod,
  spotCountMatches,
  toGrLine,
  type LineCount,
} from '../_count';

const TOL = { qtyPercent: 0.03, qtyAbsolute: 1 };

describe('count model — a count is evidence, never the invoice', () => {
  it('imports nothing from the showcase state and never reads an invoice quantity', () => {
    const src = readFileSync(join(__dirname, '..', '_count.ts'), 'utf8');
    expect(src).not.toMatch(/showcase\/receiver\/_state|from '\.\.?\/.*_state'/);
    expect(src).not.toMatch(/invoiceQty|qtyBilled/);
  });

  it('a fresh gr_line (startReceipt) is uncounted — whatever the invoice says', () => {
    expect(fromGrLine({ qtyReceived: '0', qtyRejected: '0', rejectReason: null, conditionNotes: null }, 10)).toEqual(UNCOUNTED);
    expect(fromGrLine(undefined, 10)).toEqual(UNCOUNTED);
  });

  it('a saved 0 with reason "missing" restores as missing (0 received, nothing rejected)', () => {
    expect(fromGrLine({ qtyReceived: '0', qtyRejected: '0', rejectReason: 'missing' }, 10)).toEqual({
      kind: 'counted', qtyReceived: 0, qtyRejected: 0, outcome: 'missing', method: 'per_line',
    });
  });

  it('round-trips every outcome and method through the gr_line row', () => {
    const cases: LineCount[] = [
      { kind: 'counted', qtyReceived: 8, qtyRejected: 0, outcome: 'counted', method: 'per_line' },
      { kind: 'counted', qtyReceived: 10, qtyRejected: 0, outcome: 'as_ordered', method: 'per_line' },
      { kind: 'counted', qtyReceived: 0, qtyRejected: 0, outcome: 'missing', method: 'per_line' },
      { kind: 'counted', qtyReceived: 4, qtyRejected: 0, outcome: 'damaged', method: 'per_line' },
      { kind: 'counted', qtyReceived: 10, qtyRejected: 0, outcome: 'as_ordered', method: 'spot_check' },
      bulkAsOrdered(10),
      UNCOUNTED,
    ];
    for (const c of cases) {
      const row = toGrLine(c);
      // The server prefixes damaged notes with "damaged: " — the method must survive it.
      const stored = row.condition === 'damaged' ? { ...row, conditionNotes: `damaged: ${row.conditionNotes ?? ''}`.trim() } : row;
      expect(fromGrLine(stored, 10)).toEqual(c);
    }
  });

  it('"missing" never writes a rejection', () => {
    expect(toGrLine({ kind: 'counted', qtyReceived: 3, qtyRejected: 2, outcome: 'missing', method: 'per_line' })).toEqual({
      qtyReceived: 0, qtyRejected: 0, rejectReason: 'missing', condition: 'ok',
    });
  });

  it('bulk "as ordered" is recorded as such (condition_notes until G-03), and still counts as resolved', () => {
    const row = toGrLine(bulkAsOrdered(12));
    expect(row).toMatchObject({ qtyReceived: 12, qtyRejected: 0, condition: 'ok', conditionNotes: 'count:bulk_as_ordered' });
    expect(readMethod(row.conditionNotes)).toBe('bulk_as_ordered');
    expect(grLineIsCounted(row)).toBe(true);
    // Even a bulk line whose order was 0 is not mistaken for "not counted".
    expect(grLineIsCounted(toGrLine(bulkAsOrdered(0)))).toBe(true);
    expect(grLineIsCounted(toGrLine(UNCOUNTED))).toBe(false);
  });

  it('keeps what a person wrote in the notes next to the method', () => {
    expect(toGrLine(bulkAsOrdered(5), 'קרטון רטוב').conditionNotes).toBe('קרטון רטוב count:bulk_as_ordered');
    expect(toGrLine({ kind: 'counted', qtyReceived: 5, qtyRejected: 0, outcome: 'counted', method: 'per_line' }, 'x count:bulk_as_ordered').conditionNotes).toBe('x');
  });
});

describe('spot check before a bulk "as ordered"', () => {
  it('picks two distinct lines at random, or all of them when fewer', () => {
    const picked = pickSpotCheck(['a', 'b', 'c', 'd'], 2, () => 0);
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
    expect(pickSpotCheck(['a'], 2)).toEqual(['a']);
    // Different random draws reach different lines.
    const seen = new Set<string>();
    for (const r of [0, 0.3, 0.6, 0.99]) for (const x of pickSpotCheck(['a', 'b', 'c', 'd'], 2, () => r)) seen.add(x);
    expect(seen.size).toBeGreaterThan(2);
  });

  it('a blind count matches the order the way the engine calls a quantity clean', () => {
    expect(spotCountMatches(10, 10, TOL)).toBe(true);
    expect(spotCountMatches(9, 10, TOL)).toBe(false); // 10% short
    expect(spotCountMatches(11.7, 12, TOL)).toBe(true); // 2.5% on a weighed line
    expect(spotCountMatches(11.5, 12, TOL)).toBe(false);
    expect(spotCountMatches(9, 10, undefined)).toBe(false);
  });
});

describe('bulk "as ordered" in the Delivery Check', () => {
  // Imported here (not in _count.ts): the UI marks live in the showcase state.
  const mk = async () => import('@/app/showcase/receiver/_state');
  const lines = ['a', 'b', 'c', 'd'].map((id, i) => ({
    invoiceLineIndex: null,
    poLineId: id,
    productId: id,
    productName: id,
    poQty: 10 + i,
    poUnit: 'יח׳',
    invoiceQty: null,
    invoiceUnit: null,
    poUnitPrice: 5,
    invoiceUnitPrice: null,
    status: 'pending_review' as const,
    deltaIls: 0,
  }));
  const result = {
    invoiceMeta: { invoiceNumber: '—', invoiceDate: '', totalInclVat: 0, ocrConfidence: 1, noInvoice: true },
    matchedSupplierId: 's',
    matchedPoIds: ['po'],
    lines,
    summary: { matchedCount: 0, qtyDiffCount: 0, priceDiffCount: 0, unorderedCount: 0, missingCount: 0, pendingCount: 4, overallConfidence: 1, headlineDelta: 0 },
  };
  const fresh = (): Record<string, import('@/app/showcase/receiver/_state').LineMark> =>
    Object.fromEntries(
      lines.map((l) => [`po-${l.poLineId}`, { poLineId: l.poLineId, invoiceLineIndex: null, productId: l.productId, productName: l.productName, qtyReceived: l.poQty, qtyRejected: 0, condition: 'ok' as const, touched: false }]),
    );

  it('"mark the rest" records the PO qty with method bulk_as_ordered', async () => {
    const { markRestAsOrdered } = await mk();
    const { next } = markRestAsOrdered(result, fresh());
    expect(Object.values(next).every((m) => m.touched && m.method === 'bulk_as_ordered')).toBe(true);
    expect(toGrLine(fromGrLine(toGrLine(bulkAsOrdered(next['po-a']!.qtyReceived)), 10)).conditionNotes).toBe('count:bulk_as_ordered');
  });

  it('a spot check that agrees records the two blind counts, then bulks the rest', async () => {
    const { confirmSpotCheck } = await mk();
    const r = confirmSpotCheck(result, fresh(), { 'po-a': 10, 'po-c': 12 }, TOL);
    expect(r.mismatched).toEqual([]);
    expect(r.next['po-a']).toMatchObject({ qtyReceived: 10, touched: true, method: 'spot_check' });
    expect(r.next['po-c']).toMatchObject({ qtyReceived: 12, touched: true, method: 'spot_check' });
    expect(r.next['po-b']).toMatchObject({ qtyReceived: 11, touched: true, method: 'bulk_as_ordered' });
    expect(r.next['po-d']).toMatchObject({ qtyReceived: 13, touched: true, method: 'bulk_as_ordered' });
    expect(Object.keys(r.previous).sort()).toEqual(['po-a', 'po-b', 'po-c', 'po-d']);
  });

  it('a spot check that disagrees records the counts and bulks NOTHING (count the rest one by one)', async () => {
    const { confirmSpotCheck } = await mk();
    const r = confirmSpotCheck(result, fresh(), { 'po-a': 8, 'po-c': 12 }, TOL);
    expect(r.mismatched).toEqual(['po-a']);
    expect(r.next['po-a']).toMatchObject({ qtyReceived: 8, touched: true, method: 'spot_check' });
    expect(r.next['po-b']!.touched).toBe(false);
    expect(r.next['po-d']!.touched).toBe(false);
  });

  it('a bulk never overwrites a line that has ANY count — an unconfirmed weighed count included', async () => {
    const { confirmSpotCheck, markRestAsOrdered, unresolvedOrderLines } = await mk();
    const marks = fresh();
    // 8 typed on an order of 13, waiting for the tolerance confirm.
    marks['po-d'] = { ...marks['po-d']!, qtyReceived: 8, touched: false, unconfirmed: true };
    expect(unresolvedOrderLines(result, marks).map((l) => l.poLineId)).toEqual(['a', 'b', 'c']);
    expect(markRestAsOrdered(result, marks).next['po-d']).toMatchObject({ qtyReceived: 8, touched: false, unconfirmed: true });
    const r = confirmSpotCheck(result, marks, { 'po-a': 10, 'po-b': 11 }, TOL);
    expect(r.next['po-d']).toMatchObject({ qtyReceived: 8, touched: false, unconfirmed: true });
    expect(r.previous['po-d']).toBeUndefined();
  });

  it('a spot count of 0 is "missing", not a rejection, and is a mismatch', async () => {
    const { confirmSpotCheck } = await mk();
    const r = confirmSpotCheck(result, fresh(), { 'po-b': 0, 'po-d': 13 }, TOL);
    expect(r.mismatched).toEqual(['po-b']);
    expect(r.next['po-b']).toMatchObject({ qtyReceived: 0, qtyRejected: 0, rejectReason: 'missing', method: 'spot_check' });
  });
});

describe('evidence is never a signed URL', () => {
  it('the Delivery Check writes no signature_url and no line photos (a signed URL expires and is the invoice, not proof)', async () => {
    const dir = join(__dirname, '..');
    for (const f of ['wizard.tsx', '_fieldHooks.ts', '_adapters.ts', '_count.ts']) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/signatureUrl\s*:/);
      expect(src, f).not.toMatch(/\bphotos\s*:/);
    }
    const { grLineForMark } = await import('../_adapters');
    const row = grLineForMark({
      poLineId: 'p', invoiceLineIndex: null, productId: null, productName: 'x', qtyReceived: 3, qtyRejected: 0, condition: 'ok', touched: true,
    });
    expect(Object.keys(row).sort()).toEqual(['condition', 'qtyReceived', 'qtyRejected']);
  });
});
