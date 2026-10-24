import { describe, expect, it } from 'vitest';
import { buildProof, PROOF_TOP, type ProofBreakdownInvoice, type ProofHero } from '../leakProof';

const hero: ProofHero = {
  monthStart: '2026-09-30T21:00:00.000Z',
  leakIls: 759.72,
  spendIls: 42263.18,
  leakPct: 0.01797,
  caughtBeforePaymentIls: 296.4,
  recoveredIls: 463.54,
  invoiceCount: 37,
  matchedInvoiceCount: 35,
  invoicesWithLeak: 13,
  pendingLinkCount: 2,
  pendingLinkIls: 2847.1,
};

const line = (id: string, type: string, delta: number, lineId: string | null, counts = true) => ({
  discrepancyId: id,
  type,
  deltaAmount: delta,
  countsAsLeak: counts,
  productName: 'עגבניות',
  productNameEn: 'Tomatoes',
  lineDescription: null,
  lineDescriptionEn: null,
  invoiceLineId: lineId,
});

const inv = (id: string, leak: number, lines: ProofBreakdownInvoice['lines'], pendingLink = false): ProofBreakdownInvoice => ({
  invoiceId: id,
  invoiceNumber: `INV-${id}`,
  invoiceDate: '2026-10-12T00:00:00.000Z',
  status: 'approved',
  supplierName: 'ספק',
  supplierNameEn: 'Supplier',
  totalInclVat: 500,
  leakIls: leak,
  pendingLink,
  lines,
});

describe('buildProof (flag leakProof)', () => {
  const breakdown: ProofBreakdownInvoice[] = [
    inv('a', 120.45, [line('d1', 'PRICE_HIGHER', 80.45, 'l1'), line('d2', 'QTY_SHORT', -40, 'l2'), line('d3', 'PRICE_LOWER', -5, 'l3', false)]),
    inv('b', 500, [line('d4', 'DUPLICATE_INVOICE', 500, null), line('d5', 'PRICE_HIGHER', 30, 'l5')]),
    inv('c', 10, [line('d6', 'TOTAL_MISMATCH', 10, null)]),
    inv('d', 60, [line('d7', 'VAT_MISMATCH', 60, null)]),
    inv('e', 45.5, [line('d8', 'QTY_OVER', 45.5, 'l8')]),
    inv('f', 30, [line('d9', 'PRICE_HIGHER', 30, 'l9'), line('d10', 'QTY_SHORT', 0, 'l10')]),
    inv('p', 0, [], true), // pending, no leak → not a catch
    inv('q', 55, [line('d11', 'VAT_MISMATCH', 55, null)], true), // pending WITH leak → counts like any other
  ];
  const proof = buildProof(hero, breakdown);

  it('passes the hero through untouched (no new ₪ math)', () => {
    expect(proof.hero).toBe(hero);
  });

  it('lists the top 5 catches by capped leak, pending-link invoices with leak included', () => {
    expect(proof.top).toHaveLength(PROOF_TOP);
    expect(proof.top.map((c) => c.invoiceId)).toEqual(['b', 'a', 'd', 'q', 'e']);
    // Each catch amount is the breakdown's own capped leak, to the agora.
    expect(proof.top.map((c) => c.leakIls)).toEqual([500, 120.45, 60, 55, 45.5]);
  });

  it('links line findings to the invoice line and invoice-level findings to the invoice', () => {
    const a = proof.top.find((c) => c.invoiceId === 'a')!;
    expect(a.findings.map((f) => [f.type, f.level, f.href, f.amountIls])).toEqual([
      ['PRICE_HIGHER', 'line', '/dashboard/invoices/a#line-l1', 80.45],
      ['QTY_SHORT', 'line', '/dashboard/invoices/a#line-l2', 40],
    ]);
    const b = proof.top.find((c) => c.invoiceId === 'b')!;
    expect(b.findings[0]).toMatchObject({ type: 'DUPLICATE_INVOICE', level: 'invoice', href: '/dashboard/invoices/b' });
    for (const id of ['d']) {
      expect(proof.top.find((c) => c.invoiceId === id)!.findings.every((f) => f.level === 'invoice' && !f.href.includes('#'))).toBe(true);
    }
  });

  it('does not list ₪0.00 findings', () => {
    const f = buildProof(hero, breakdown.filter((x) => x.invoiceId === 'f')).top[0]!;
    expect(f.findings.map((x) => x.discrepancyId)).toEqual(['d9']);
  });

  it('marks a catch whose findings exceed its leak as capped at the invoice total', () => {
    expect(proof.top.find((c) => c.invoiceId === 'b')!.capped).toBe(true); // 530 > 500
    expect(proof.top.find((c) => c.invoiceId === 'a')!.capped).toBe(false); // 120.45 == 120.45
  });

  it('checks invoicesWithLeak ≤ matched ≤ invoiceCount', () => {
    expect(proof.countsConsistent).toBe(true);
    expect(buildProof({ ...hero, invoicesWithLeak: 36 }, []).countsConsistent).toBe(false);
    expect(buildProof({ ...hero, matchedInvoiceCount: 38 }, []).countsConsistent).toBe(false);
  });

  it('has nothing to list in a month without findings', () => {
    expect(buildProof({ ...hero, leakIls: 0, invoicesWithLeak: 0 }, [inv('p', 0, [], true)]).top).toEqual([]);
  });
});
