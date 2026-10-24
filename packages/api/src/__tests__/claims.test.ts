import { describe, expect, it } from 'vitest';
import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { claimableLines, sumClaims, vatBasisOf } from '../lib/claims';
import { payRunStatusOf } from '../routers/payRun';

/**
 * The claimable-line rule moved out of apps/web/app/dashboard/leaks/claims/page.tsx
 * into lib/claims.ts (shared with the pay run). `referenceLetterLines` is the
 * page's loop as it was before the move, verbatim in substance: the helper must
 * give the same lines and the same ₪ on every invoice.
 */
const REF_CLAIMABLE = new Set(['open', 'escalated', 'accepted']);
function referenceLetterLines(inv: LeakBreakdownInvoice): Array<{ id: string; amount: number }> {
  const out: Array<{ id: string; amount: number }> = [];
  if (inv.pendingLink || inv.status === 'paid') return out;
  let invClaimed = 0;
  for (const l of inv.lines) {
    if (!l.countsAsLeak || !REF_CLAIMABLE.has(l.resolutionStatus)) continue;
    const amount = Math.min(Math.abs(l.deltaAmount), Math.max(0, inv.leakIls - invClaimed));
    if (amount <= 0) continue;
    invClaimed += amount;
    out.push({ id: l.discrepancyId, amount });
  }
  return out;
}

const TYPES = ['PRICE_HIGHER', 'QTY_SHORT', 'QTY_OVER', 'DUPLICATE_INVOICE', 'VAT_MISMATCH', 'PRICE_LOWER', 'TOTAL_MISMATCH'];
const STATUSES = ['open', 'escalated', 'accepted', 'rejected', 'resolved'];

function line(over: Partial<LeakBreakdownLine> & { discrepancyId: string }): LeakBreakdownLine {
  return {
    type: 'PRICE_HIGHER',
    severity: 'warn',
    resolutionStatus: 'open',
    deltaAmount: 10,
    expected: null,
    actual: null,
    countsAsLeak: true,
    productId: null,
    poLineId: null,
    invoiceLineId: null,
    productName: null,
    productNameEn: null,
    lineDescription: null,
    lineDescriptionEn: null,
    ...over,
  };
}
function invoice(over: Partial<LeakBreakdownInvoice> = {}): LeakBreakdownInvoice {
  return {
    invoiceId: 'i',
    invoiceNumber: 'N-1',
    invoiceDate: '2026-10-20T00:00:00.000Z',
    status: 'matched',
    supplierName: 'ספק',
    supplierNameEn: null,
    totalInclVat: 1000,
    leakIls: 100,
    pendingLink: false,
    lines: [],
    ...over,
  };
}

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('claimableLines — no behaviour change vs the claims letters', () => {
  it('matches the pre-extraction loop on 2,000 random invoices, line by line and to the agora', () => {
    const r = rng(20261025);
    for (let k = 0; k < 2000; k++) {
      const n = Math.floor(r() * 6);
      const lines = Array.from({ length: n }, (_, j) => {
        const type = TYPES[Math.floor(r() * TYPES.length)]!;
        return line({
          discrepancyId: `d${j}`,
          type,
          resolutionStatus: STATUSES[Math.floor(r() * STATUSES.length)]!,
          deltaAmount: Math.round((r() * 400 - 50) * 100) / 100,
          countsAsLeak: type !== 'PRICE_LOWER' && r() > 0.1,
        });
      });
      const inv = invoice({
        lines,
        leakIls: Math.round(r() * 500 * 100) / 100,
        status: r() > 0.85 ? 'paid' : 'matched',
        pendingLink: r() > 0.9,
      });
      const ref = referenceLetterLines(inv);
      const got = claimableLines(inv);
      expect(got.map((g) => ({ id: g.line.discrepancyId, amount: g.amount }))).toEqual(ref);
      expect(sumClaims(got)).toBe(Math.round(ref.reduce((s, l) => s + l.amount, 0) * 100) / 100);
    }
  });

  it('caps per invoice in breakdown order', () => {
    const inv = invoice({
      leakIls: 50,
      lines: [line({ discrepancyId: 'a', deltaAmount: 40 }), line({ discrepancyId: 'b', deltaAmount: -30 })],
    });
    expect(claimableLines(inv).map((c) => [c.line.discrepancyId, c.amount])).toEqual([
      ['a', 40],
      ['b', 10],
    ]);
  });

  it('labels the VAT basis of each amount', () => {
    expect(vatBasisOf('DUPLICATE_INVOICE')).toBe('incl');
    expect(vatBasisOf('VAT_MISMATCH')).toBe('vat');
    expect(vatBasisOf('PRICE_HIGHER')).toBe('excl');
    expect(vatBasisOf('TOTAL_MISMATCH')).toBe('excl');
  });
});

describe('payRunStatusOf', () => {
  it('no finding at all ⇒ can pay', () => {
    expect(payRunStatusOf(null)).toEqual({ status: 'pay', duplicate: false, duplicateIls: 0, claims: [], pendingIls: 0, creditIls: 0 });
  });
  it('an open or escalated leak finding holds the invoice', () => {
    for (const st of ['open', 'escalated']) {
      const s = payRunStatusOf(invoice({ lines: [line({ discrepancyId: 'a', resolutionStatus: st, deltaAmount: 30 })] }));
      expect(s).toMatchObject({ status: 'hold', pendingIls: 30, creditIls: 0 });
    }
  });
  it('only accepted claims ⇒ ask for a credit of exactly the letters amount', () => {
    const inv = invoice({
      leakIls: 50,
      lines: [
        line({ discrepancyId: 'a', resolutionStatus: 'accepted', deltaAmount: 40 }),
        line({ discrepancyId: 'b', resolutionStatus: 'accepted', deltaAmount: 30 }),
        line({ discrepancyId: 'c', resolutionStatus: 'rejected', deltaAmount: 99 }),
      ],
    });
    const s = payRunStatusOf(inv);
    expect(s.status).toBe('claim');
    expect(s.creditIls).toBe(50);
    expect(s.creditIls).toBe(sumClaims(referenceLetterLines(inv)));
  });
  it('an open finding whose ₪ the cap already used still holds (never "can pay" by omission)', () => {
    const inv = invoice({
      leakIls: 40,
      lines: [
        line({ discrepancyId: 'a', resolutionStatus: 'accepted', deltaAmount: 40 }),
        line({ discrepancyId: 'b', resolutionStatus: 'open', deltaAmount: 20 }),
      ],
    });
    expect(payRunStatusOf(inv)).toMatchObject({ status: 'hold', creditIls: 40, pendingIls: 0 });
  });
  it('an invoice waiting for its PO link is held, calmly, with nothing to claim', () => {
    expect(payRunStatusOf(invoice({ pendingLink: true, leakIls: 0 }))).toMatchObject({ status: 'hold', claims: [] });
  });
  it('an unpaid duplicate copy is held ("don\'t pay this copy"), never a credit to ask for', () => {
    for (const st of ['open', 'accepted']) {
      const s = payRunStatusOf(
        invoice({ leakIls: 1170, lines: [line({ discrepancyId: 'dup', type: 'DUPLICATE_INVOICE', severity: 'block', resolutionStatus: st, deltaAmount: 1170 })] }),
      );
      expect(s).toMatchObject({ status: 'hold', duplicate: true, duplicateIls: 1170, creditIls: 0, pendingIls: 0 });
      expect(s.claims[0]).toMatchObject({ basis: 'incl' });
    }
    // A duplicate the team waived ("not a duplicate") does not hold.
    const waived = payRunStatusOf(
      invoice({ lines: [line({ discrepancyId: 'dup', type: 'DUPLICATE_INVOICE', resolutionStatus: 'rejected', deltaAmount: 1170 })] }),
    );
    expect(waived).toMatchObject({ status: 'pay', duplicate: false });
  });

  it('waived / resolved lines do not hold and are not claimed', () => {
    const s = payRunStatusOf(
      invoice({ lines: [line({ discrepancyId: 'a', resolutionStatus: 'rejected' }), line({ discrepancyId: 'b', resolutionStatus: 'resolved' })] }),
    );
    expect(s).toMatchObject({ status: 'pay', claims: [], creditIls: 0 });
  });
});
