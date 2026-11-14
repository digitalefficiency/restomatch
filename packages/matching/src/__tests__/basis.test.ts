import { describe, expect, it } from 'vitest';
import { basisDeltaAmount, runMatch } from '../engine';
import type { Discrepancy, MatchInput } from '../index';
import { grLine, input, invoiceHeader, invoiceLine, poLine } from './fixtures';

/**
 * G-15: every engine discrepancy carries a typed `basis`, and the basis
 * arithmetic reproduces |Δ| to the agora. Fixtures are read-only builders; the
 * leak canary is untouched.
 */

const agorot = (ils: number) => Math.round(ils * 100);

function assertBasis(out: { discrepancies: Discrepancy[] }) {
  for (const d of out.discrepancies) {
    expect(d.basis, `${d.type} has a basis`).toBeDefined();
    expect(agorot(basisDeltaAmount(d.basis!)), `${d.type} basis = |Δ|`).toBe(agorot(Math.abs(d.deltaAmount)));
  }
}

const find = (out: { discrepancies: Discrepancy[] }, type: Discrepancy['type']) => {
  const d = out.discrepancies.find((x) => x.type === type);
  expect(d, type).toBeDefined();
  return d!;
};

describe('basis: PO price', () => {
  it('PRICE_HIGHER vs PO → source po, |billed − expected| × billed qty', () => {
    const po = poLine({ id: 'po-b1', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 9.37, lineTotal: 93.7 })],
        invoice: invoiceHeader({ totalExclVat: 93.7, vatAmount: 15.93, totalInclVat: 109.63 }),
      }),
    );
    const d = find(out, 'PRICE_HIGHER');
    expect(d.basis).toMatchObject({
      source: 'po',
      formula: 'price_x_qty',
      qtyOrdered: 10,
      qtyReceived: 10,
      qtyBilled: 10,
      qtyUsed: 10,
      unitPriceUsed: 9.37,
      referencePrice: 8,
      unitFactor: 1,
      threshold: { pct: 0.02, abs: 5, units: null },
    });
    expect(agorot(d.deltaAmount)).toBe(1370);
    assertBasis(out);
  });

  it('PRICE_LOWER carries the same basis shape (info, no leak)', () => {
    const po = poLine({ id: 'po-b2', qtyOrdered: 10, unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 8, lineTotal: 80 })],
      }),
    );
    expect(find(out, 'PRICE_LOWER').basis).toMatchObject({ source: 'po', referencePrice: 10, unitPriceUsed: 8 });
    assertBasis(out);
  });
});

describe('basis: baseline p90', () => {
  it('no PO price, billed over p90 → source baseline_p90, (billed − p90) × qty', () => {
    const po = poLine({ id: 'po-b3', productId: 'tomato', qtyOrdered: 5, unitPriceExpected: null });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, productId: 'tomato', qtyReceived: 5 })],
        invoiceLines: [invoiceLine({ productId: 'tomato', qtyBilled: 5, unitPriceBilled: 12.4, lineTotal: 62 })],
        invoice: invoiceHeader({ totalExclVat: 62, vatAmount: 10.54, totalInclVat: 72.54 }),
        baselines: { tomato: { p50: 9, p90: 10.15 } },
      }),
    );
    const d = find(out, 'PRICE_HIGHER');
    expect(d.basis).toMatchObject({
      source: 'baseline_p90',
      formula: 'price_x_qty',
      referencePrice: 10.15,
      unitPriceUsed: 12.4,
      qtyUsed: 5,
    });
    expect(agorot(d.deltaAmount)).toBe(1125);
    assertBasis(out);
  });
});

describe('basis: unit-converted (kg↔g)', () => {
  it('PO in kg, invoice in g → unitFactor 0.001, normalized price and qty', () => {
    const po = poLine({ id: 'po-b4', unit: 'kg', qtyOrdered: 2, unitPriceExpected: 40 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 2 })],
        // 2000 g @ ₪0.05/g = ₪50/kg vs ₪40/kg expected
        invoiceLines: [invoiceLine({ productId: po.productId, unit: 'g', qtyBilled: 2000, unitPriceBilled: 0.05, lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 17, totalInclVat: 117 }),
      }),
    );
    const d = find(out, 'PRICE_HIGHER');
    expect(d.basis!.unitFactor).toBe(0.001);
    expect(d.basis!.qtyBilled).toBeCloseTo(2, 9);
    expect(d.basis!.unitPriceUsed).toBeCloseTo(50, 9);
    expect(d.basis!.referencePrice).toBe(40);
    expect(agorot(d.deltaAmount)).toBe(2000);
    assertBasis(out);
  });

  it('non-convertible units → UNIT_MISMATCH with formula none, unitFactor null', () => {
    const po = poLine({ id: 'po-b5', unit: 'kg', qtyOrdered: 2, unitPriceExpected: 40 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 2 })],
        invoiceLines: [invoiceLine({ productId: po.productId, unit: 'ml', qtyBilled: 2, unitPriceBilled: 40, lineTotal: 80 })],
      }),
    );
    expect(find(out, 'UNIT_MISMATCH').basis).toMatchObject({ source: 'none', formula: 'none', unitFactor: null });
    assertBasis(out);
  });
});

describe('basis: QTY_SHORT overlap with QTY_OVER', () => {
  it('short 4, billed 2 not received → QTY_SHORT counts 2 un-billed units, overlap 2', () => {
    const po = poLine({ id: 'po-b6', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 6 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 8, unitPriceBilled: 8, lineTotal: 64 })],
        invoice: invoiceHeader({ totalExclVat: 64, vatAmount: 10.88, totalInclVat: 74.88 }),
      }),
    );
    const short = find(out, 'QTY_SHORT');
    expect(short.basis).toMatchObject({
      source: 'gr',
      formula: 'unit_x_qty',
      qtyOrdered: 10,
      qtyReceived: 6,
      qtyBilled: 8,
      qtyUsed: 2,
      overlapUnits: 2,
      unitPriceUsed: 8,
    });
    const over = find(out, 'QTY_OVER');
    expect(over.basis).toMatchObject({ source: 'gr', qtyReceived: 6, qtyBilled: 8, qtyUsed: 2, unitPriceUsed: 8 });
    expect(agorot(short.deltaAmount) + agorot(over.deltaAmount)).toBe(3200);
    assertBasis(out);
  });
});

describe('basis: the other types', () => {
  it('MISSING_ON_INVOICE, UNORDERED_ITEM, TOTAL_MISMATCH, VAT_MISMATCH', () => {
    const po1 = poLine({ id: 'po-b7', productId: 'a', qtyOrdered: 3, unitPriceExpected: 7.5 });
    const po2 = poLine({ id: 'po-b8', productId: 'b', qtyOrdered: 2, unitPriceExpected: 5 });
    const out = runMatch(
      input({
        poLines: [po1, po2],
        grLines: [grLine({ poLineId: po1.id, productId: 'a', qtyReceived: 3 })],
        invoiceLines: [
          invoiceLine({ productId: 'a', qtyBilled: 3, unitPriceBilled: 7.5, lineTotal: 22.5 }),
          invoiceLine({ productId: 'zzz', qtyBilled: 1, unitPriceBilled: 19.99, lineTotal: 19.99 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 50, vatAmount: 7.0, totalInclVat: 57 }),
      }),
    );
    expect(find(out, 'MISSING_ON_INVOICE').basis).toMatchObject({ source: 'po', qtyUsed: 2, unitPriceUsed: 5, qtyBilled: 0 });
    expect(find(out, 'UNORDERED_ITEM').basis).toMatchObject({ source: 'invoice_line', formula: 'amount', actualAmount: 19.99 });
    expect(find(out, 'TOTAL_MISMATCH').basis).toMatchObject({
      source: 'invoice_total',
      formula: 'amount_diff',
      actualAmount: 50,
      referenceAmount: 42.49,
      threshold: { abs: 0.1 },
    });
    expect(find(out, 'VAT_MISMATCH').basis).toMatchObject({
      source: 'vat_rate',
      formula: 'amount_diff',
      actualAmount: 7,
      referenceAmount: 8.5,
      vatRate: 0.17,
    });
    assertBasis(out);
  });

  it('DUPLICATE_INVOICE, UNORDERED_ARRIVAL, DATE_ANOMALY', () => {
    const out = runMatch(
      input({
        invoiceLines: [invoiceLine({ lineTotal: 80 })],
        knownInvoiceNumbers: new Set(['INV-1001']),
        expectedDeliveryDate: new Date('2026-04-01T00:00:00Z'),
      }),
    );
    expect(find(out, 'DUPLICATE_INVOICE').basis).toMatchObject({ source: 'invoice_total', formula: 'amount', actualAmount: 93.6 });
    expect(find(out, 'UNORDERED_ARRIVAL').basis).toMatchObject({ source: 'invoice_total', formula: 'amount' });
    expect(find(out, 'DATE_ANOMALY').basis).toMatchObject({ source: 'none', formula: 'none' });
    assertBasis(out);
  });
});

describe('basis: property sweep (deterministic)', () => {
  it('basis reproduces |Δ| to the agora over 400 generated invoices', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const r4 = (x: number) => Math.round(x * 10000) / 10000;
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      const n = 1 + Math.floor(rnd() * 4);
      const poLines = [];
      const grLines = [];
      const invoiceLines = [];
      for (let k = 0; k < n; k++) {
        const pid = `p${k}`;
        const unit = pick(['kg', 'ק״ג', 'l']);
        const price = r4(1 + rnd() * 60);
        const qty = Math.round((1 + rnd() * 30) * 100) / 100;
        const po = poLine({ id: `po-${i}-${k}`, productId: pid, unit, qtyOrdered: qty, unitPriceExpected: rnd() < 0.15 ? null : price });
        poLines.push(po);
        if (rnd() < 0.9) grLines.push(grLine({ poLineId: po.id, productId: pid, qtyReceived: Math.max(0, qty - Math.floor(rnd() * 4)) }));
        if (rnd() < 0.85) {
          const toG = unit === 'kg' && rnd() < 0.3;
          const billedQty = Math.max(0.5, qty + Math.floor(rnd() * 5) - 2);
          const billedPrice = r4(price * (0.85 + rnd() * 0.4));
          invoiceLines.push(
            invoiceLine({
              productId: pid,
              unit: toG ? 'g' : unit,
              qtyBilled: toG ? billedQty * 1000 : billedQty,
              unitPriceBilled: toG ? billedPrice / 1000 : billedPrice,
              lineTotal: Math.round(billedQty * billedPrice * 100) / 100,
            }),
          );
        }
      }
      if (rnd() < 0.2) invoiceLines.push(invoiceLine({ productId: 'extra', qtyBilled: 2, unitPriceBilled: 3.33, lineTotal: 6.66 }));
      const sub = Math.round(invoiceLines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100 + (rnd() < 0.2 ? 1.23 : 0);
      const vat = Math.round(sub * 0.17 * 100) / 100 + (rnd() < 0.2 ? 0.5 : 0);
      const m: MatchInput = input({
        poLines,
        grLines,
        invoiceLines,
        invoice: invoiceHeader({ totalExclVat: sub, vatAmount: vat, totalInclVat: Math.round((sub + vat) * 100) / 100 }),
        baselines: rnd() < 0.5 ? { p0: { p50: 10, p90: 20 }, p1: { p50: 5, p90: 9 } } : undefined,
      });
      const out = runMatch(m);
      seen += out.discrepancies.length;
      assertBasis(out);
      // Σ basis = the leak figure, to the agora
      const fromBasis = out.discrepancies.reduce((s, d) => s + agorot(basisDeltaAmount(d.basis!)), 0);
      expect(fromBasis).toBe(agorot(out.totalDiscrepancyAmount));
    }
    expect(seen).toBeGreaterThan(400);
  });
});
