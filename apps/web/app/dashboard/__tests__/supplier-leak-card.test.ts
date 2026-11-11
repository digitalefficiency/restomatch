import { describe, expect, it } from 'vitest';
import {
  israelYmd,
  leakCardWindow,
  toAgorot,
  topLeakLines,
  topTypes,
  type LeakInvoiceLike,
} from '../suppliers/[id]/leak-card-logic';

const line = (id: string, type: string, delta: number, countsAsLeak = true) => ({
  discrepancyId: id,
  type,
  deltaAmount: delta,
  countsAsLeak,
  productName: `פריט ${id}`,
  productNameEn: null,
  lineDescription: null,
  lineDescriptionEn: null,
});

describe('supplier leak card window', () => {
  it('is the last 90 Israel calendar days, today included', () => {
    expect(leakCardWindow(new Date('2026-10-25T08:00:00Z'))).toEqual({ from: '2026-07-28', to: '2026-10-25' });
  });

  it('uses the Israel day, not UTC (23:30 UTC on the 24th is already the 25th)', () => {
    expect(israelYmd(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(leakCardWindow(new Date('2026-10-24T23:30:00Z')).to).toBe('2026-10-25');
  });

  it('crosses a year boundary', () => {
    expect(leakCardWindow(new Date('2027-01-10T10:00:00Z'))).toEqual({ from: '2026-10-13', to: '2027-01-10' });
  });
});

describe('top leak lines', () => {
  const invoices: LeakInvoiceLike[] = [
    { invoiceId: 'i1', invoiceNumber: '100', invoiceDate: '2026-10-01', lines: [line('a', 'PRICE_HIGHER', 12.5), line('b', 'PRICE_LOWER', -40, false)] },
    { invoiceId: 'i2', invoiceNumber: null, invoiceDate: null, lines: [line('c', 'QTY_SHORT', -80.1), line('d', 'PRICE_HIGHER', 3)] },
    { invoiceId: 'i3', invoiceNumber: '7', invoiceDate: '2026-09-02', lines: [line('e', 'DUPLICATE_INVOICE', 30), line('f', 'PRICE_HIGHER', 0), line('g', 'PRICE_HIGHER', 30)] },
  ];

  it('ranks leak lines by |Δ ₪| in agorot and links each to its invoice', () => {
    const top = topLeakLines(invoices, 5);
    expect(top.map((l) => [l.discrepancyId, l.amountAgorot, l.invoiceId])).toEqual([
      ['c', 8010, 'i2'],
      ['e', 3000, 'i3'],
      ['g', 3000, 'i3'],
      ['a', 1250, 'i1'],
      ['d', 300, 'i2'],
    ]);
  });

  it('skips non-leak (info / PRICE_LOWER) and zero lines, and caps at n', () => {
    const top = topLeakLines(invoices, 2);
    expect(top).toHaveLength(2);
    expect(topLeakLines(invoices, 10).some((l) => l.discrepancyId === 'b' || l.discrepancyId === 'f')).toBe(false);
  });
});

describe('top types', () => {
  it('keeps the 3 biggest leaking types', () => {
    const rows = [
      { key: 'PRICE_HIGHER', leakIls: 120 },
      { key: 'QTY_SHORT', leakIls: 300 },
      { key: '', leakIls: 999 },
      { key: 'PRICE_LOWER', leakIls: 0 },
      { key: 'DUPLICATE_INVOICE', leakIls: 80 },
      { key: 'UNIT_MISMATCH', leakIls: 10 },
    ];
    expect(topTypes(rows).map((r) => r.key)).toEqual(['QTY_SHORT', 'PRICE_HIGHER', 'DUPLICATE_INVOICE']);
  });

  it('converts ₪ to integer agorot without float drift', () => {
    expect(toAgorot(0.1 + 0.2)).toBe(30);
    expect(toAgorot(1234.565)).toBe(123457);
  });
});

// ── W2-09c: the basis per type, through the one shared why formatter ─────────
import { whySegments as whyOf, whyText as whyTextOf } from '@/lib/components/flags';
import { leakWhyLabels as leakLabels } from '../leaks/why-labels';
import { topLeakLines as topLines } from '../suppliers/[id]/leak-card-logic';

describe('supplier leak card — the basis per type (W2-09c)', () => {
  const facts = (type: string, extra: Record<string, unknown> = {}) => ({
    type, deltaAmount: 100, expectedValue: 139, actualValue: 149, toleranceUsed: null as string | null,
    qtyBilled: 10, billedUnit: 'ק״ג', poId: 'abcdef12-0000', poRef: null, poDate: '2026-10-14T07:00:00Z', capped: false, unavailable: false, ...extra,
  });
  const line = (type: string, f = facts(type)) => ({
    discrepancyId: type, type, deltaAmount: 100, countsAsLeak: true,
    productName: 'אנטריקוט', productNameEn: null, lineDescription: null, lineDescriptionEn: null, evidence: { facts: f },
  });

  it('topLeakLines keeps each line’s evidence', () => {
    const [top] = topLines([{ invoiceId: 'i', invoiceNumber: '1', invoiceDate: null, lines: [line('PRICE_HIGHER')] }]);
    expect(top!.evidence!.facts.expectedValue).toBe(139);
  });

  it('every leak type renders one basis line with its gap and no unfilled placeholder', () => {
    for (const type of ['PRICE_HIGHER', 'QTY_OVER', 'QTY_SHORT', 'MISSING_ON_INVOICE', 'UNORDERED_ITEM', 'TOTAL_MISMATCH', 'VAT_MISMATCH', 'DUPLICATE_INVOICE']) {
      const text = whyTextOf(whyOf(facts(type), leakLabels('he')));
      expect([type, /\{\w+\}/.test(text), /פער/.test(text)]).toEqual([type, false, true]);
    }
    expect(whyTextOf(whyOf(facts('PRICE_HIGHER'), leakLabels('he')))).toMatch(/^בחשבונית .*149\.00.* × 10 ק״ג · בהזמנה .*139\.00/);
  });

  it('an unverifiable line reads "פירוט לא זמין", never a wrong formula', () => {
    expect(whyTextOf(whyOf(facts('PRICE_HIGHER', { unavailable: true }), leakLabels('he')))).toBe('פירוט לא זמין');
  });
});
