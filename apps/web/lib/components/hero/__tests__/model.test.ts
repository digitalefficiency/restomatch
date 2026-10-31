import { describe, expect, it } from 'vitest';
import { daySpan, heroDelta, leakHeroState, showsPct } from '..';

const base = { leakIls: 0, spendIls: 0, leakPct: null, invoiceCount: 0, matchedInvoiceCount: 0, pendingLinkCount: 0 };

describe('leakHeroState — typed states, never ₪0 for "no data"', () => {
  it('no invoices at all → noData', () => expect(leakHeroState(base)).toBe('noData'));
  it('matched invoices, no leak → clean (T3)', () => expect(leakHeroState({ ...base, matchedInvoiceCount: 12, invoiceCount: 12 })).toBe('clean'));
  it('only consolidated invoices waiting for a link → pendingOnly (T4)', () =>
    expect(leakHeroState({ ...base, invoiceCount: 2, pendingLinkCount: 2 })).toBe('pendingOnly'));
  it('any leak → leak (T1)', () => expect(leakHeroState({ ...base, leakIls: 0.01, matchedInvoiceCount: 1 })).toBe('leak'));
});

describe('showsPct — a thin base shows ₪ without %', () => {
  it('fewer than 5 checked invoices → no %', () =>
    expect(showsPct({ ...base, leakIls: 50, spendIls: 2000, leakPct: 0.025, matchedInvoiceCount: 4 })).toBe(false));
  it('5+ checked invoices with spend → %', () =>
    expect(showsPct({ ...base, leakIls: 760, spendIls: 42263, leakPct: 0.018, matchedInvoiceCount: 35 })).toBe(true));
});

describe('heroDelta — same day-span comparison', () => {
  it('lab: ₪760 now vs ₪942 in Sep 1–25 → down ₪182 (−19%)', () => {
    const d = heroDelta({ leakIls: 759.54 }, { leakIls: 941.54, invoiceCount: 30, matchedInvoiceCount: 30 })!;
    expect(d.direction).toBe('down');
    expect(d.amountIls).toBe(182);
    expect(Math.round(d.pct! * 100)).toBe(-19);
  });
  it('agorot-exact difference (no float drift)', () => {
    expect(heroDelta({ leakIls: 0.3 }, { leakIls: 0.1, invoiceCount: 9, matchedInvoiceCount: 9 })!.amountIls).toBe(0.2);
  });
  it('up and same', () => {
    expect(heroDelta({ leakIls: 120 }, { leakIls: 100, invoiceCount: 9, matchedInvoiceCount: 9 })).toMatchObject({ direction: 'up', amountIls: 20, pct: 0.2 });
    expect(heroDelta({ leakIls: 100 }, { leakIls: 100, invoiceCount: 9, matchedInvoiceCount: 9 })).toMatchObject({ direction: 'same', amountIls: 0 });
  });
  it('no invoices in the previous span → null (nothing honest to compare)', () => {
    expect(heroDelta({ leakIls: 100 }, { leakIls: 0, invoiceCount: 0, matchedInvoiceCount: 0 })).toBeNull();
    expect(heroDelta({ leakIls: 100 }, null)).toBeNull();
  });
  it('thin or zero previous leak keeps the ₪ but drops the %', () => {
    expect(heroDelta({ leakIls: 60 }, { leakIls: 20, invoiceCount: 3, matchedInvoiceCount: 3 })).toMatchObject({ amountIls: 40, pct: null });
    expect(heroDelta({ leakIls: 60 }, { leakIls: 0, invoiceCount: 9, matchedInvoiceCount: 9 })).toMatchObject({ direction: 'up', pct: null });
  });
});

describe('daySpan', () => {
  it('[Sep 1, Sep 26) local → first and last local day', () => {
    const { from, to } = daySpan('2026-08-31T21:00:00.000Z', '2026-09-25T21:00:00.000Z');
    const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short' }).format(d);
    expect(day(from)).toBe('1 Sept');
    expect(day(to)).toBe('25 Sept');
  });
});
