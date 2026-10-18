import { describe, expect, it } from 'vitest';
import { runMatch } from '../engine';
import { grLine, input, invoiceHeader, invoiceLine, poLine } from './fixtures';

/**
 * Regression tests for the client-ready money-engine fixes (S3):
 *  • M2 — several partial goods receipts against one PO line are SUMMED.
 *  • M3 — the baseline check never double-counts an overcharge the PO check
 *         already flagged, and compares unit-normalized prices.
 *  • short + billed-anyway — missing units that the invoice still bills are
 *    counted once (QTY_OVER block), not twice (QTY_SHORT + QTY_OVER).
 */

const agorot = (ils: number) => Math.round(ils * 100);

describe('M2: partial deliveries are summed per PO line', () => {
  it('two partial GRs that add up to the order → no QTY_SHORT, no leak', () => {
    const po = poLine({ id: 'po-m2', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [
          grLine({ poLineId: po.id, qtyReceived: 6 }),
          grLine({ poLineId: po.id, qtyReceived: 4 }),
        ],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 8, lineTotal: 80 })],
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
      }),
    );
    expect(out.discrepancies).toEqual([]);
    expect(out.status).toBe('clean');
    expect(out.totalDiscrepancyAmount).toBe(0);
  });

  it('two partial GRs that still fall short → QTY_SHORT on the true remainder only', () => {
    const po = poLine({ id: 'po-m2b', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [
          grLine({ poLineId: po.id, qtyReceived: 5 }),
          grLine({ poLineId: po.id, qtyReceived: 3 }),
        ],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 8, unitPriceBilled: 8, lineTotal: 64 })],
        invoice: invoiceHeader({ totalExclVat: 64, vatAmount: 10.88, totalInclVat: 74.88 }),
      }),
    );
    expect(out.discrepancies.map((d) => d.type)).toEqual(['QTY_SHORT']);
    expect(out.discrepancies[0]!.actual).toBe(8);
    expect(agorot(out.totalDiscrepancyAmount)).toBe(1600); // 2 × ₪8
  });

  it('billing the full order against two partials that sum to it is not QTY_OVER', () => {
    const po = poLine({ id: 'po-m2c', qtyOrdered: 20, unitPriceExpected: 5 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [
          grLine({ poLineId: po.id, qtyReceived: 12 }),
          grLine({ poLineId: po.id, qtyReceived: 8 }),
        ],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 20, unitPriceBilled: 5, lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 17, totalInclVat: 117 }),
      }),
    );
    expect(out.discrepancies.some((d) => d.type === 'QTY_OVER')).toBe(false);
  });
});

describe('short delivery that is billed anyway is counted once', () => {
  it('ordered 10, received 8, billed 10 → ₪16 leak (not ₪32)', () => {
    const po = poLine({ id: 'po-ov', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 8 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 8, lineTotal: 80 })],
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
      }),
    );
    const types = out.discrepancies.map((d) => d.type).sort();
    // Both facts are still reported (short delivery + billed-not-received)…
    expect(types).toEqual(['QTY_OVER', 'QTY_SHORT']);
    // …but the 2 missing units are money once: the billed-not-received block.
    const short = out.discrepancies.find((d) => d.type === 'QTY_SHORT')!;
    const over = out.discrepancies.find((d) => d.type === 'QTY_OVER')!;
    expect(short.deltaAmount).toBe(0);
    expect(agorot(over.deltaAmount)).toBe(1600);
    expect(agorot(out.totalDiscrepancyAmount)).toBe(1600);
    expect(out.status).toBe('blocked');
  });

  it('ordered 10, received 6, billed 8 → ₪16 billed-not-received + ₪16 un-billed shortfall', () => {
    const po = poLine({ id: 'po-ov2', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 6 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 8, unitPriceBilled: 8, lineTotal: 64 })],
        invoice: invoiceHeader({ totalExclVat: 64, vatAmount: 10.88, totalInclVat: 74.88 }),
      }),
    );
    const short = out.discrepancies.find((d) => d.type === 'QTY_SHORT')!;
    const over = out.discrepancies.find((d) => d.type === 'QTY_OVER')!;
    expect(agorot(over.deltaAmount)).toBe(1600); // 2 billed-not-received × ₪8
    expect(agorot(short.deltaAmount)).toBe(1600); // 2 never-billed × ₪8
    expect(agorot(out.totalDiscrepancyAmount)).toBe(3200); // 4 missing units × ₪8
  });
});

describe('M3: baseline check never double-counts', () => {
  it('PO check already flags PRICE_HIGHER → baseline adds nothing on top', () => {
    const po = poLine({ id: 'po-b1', qtyOrdered: 10, unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 10, lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 17, totalInclVat: 117 }),
        baselines: { [po.productId!]: { p50: 8, p90: 8.5 } },
      }),
    );
    const highers = out.discrepancies.filter((d) => d.type === 'PRICE_HIGHER');
    expect(highers).toHaveLength(1);
    expect(agorot(out.totalDiscrepancyAmount)).toBe(2000); // (10−8) × 10, once
  });

  it('PO without an expected price still gets the baseline check', () => {
    const po = poLine({ id: 'po-b2', qtyOrdered: 10, unitPriceExpected: null });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 10, lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 17, totalInclVat: 117 }),
        baselines: { [po.productId!]: { p50: 8, p90: 9 } },
      }),
    );
    expect(out.discrepancies.map((d) => d.type)).toEqual(['PRICE_HIGHER']);
    expect(agorot(out.totalDiscrepancyAmount)).toBe(1000); // (10−9) × 10
  });

  it('baseline compares the unit-normalized price (invoice in g, baseline per kg)', () => {
    // 10 kg ordered, no PO price; invoice bills 10,000 g @ ₪0.0095/g = ₪9.50/kg.
    // Baseline p90 is ₪10/kg → within baseline, no discrepancy. Before the fix
    // the raw per-g price was compared (and per-g qty used), mis-firing.
    const po = poLine({ id: 'po-b3', qtyOrdered: 10, unit: 'kg', unitPriceExpected: null });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [
          invoiceLine({ productId: po.productId, qtyBilled: 10000, unit: 'g', unitPriceBilled: 0.0095, lineTotal: 95 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 95, vatAmount: 16.15, totalInclVat: 111.15 }),
        baselines: { [po.productId!]: { p50: 9, p90: 10 } },
      }),
    );
    expect(out.discrepancies).toEqual([]);
  });

  it('baseline over-p90 in grams is priced in PO units', () => {
    // ₪0.012/g = ₪12/kg vs p90 ₪10/kg → (12−10) × 10 kg = ₪20.
    const po = poLine({ id: 'po-b4', qtyOrdered: 10, unit: 'kg', unitPriceExpected: null });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [
          invoiceLine({ productId: po.productId, qtyBilled: 10000, unit: 'g', unitPriceBilled: 0.012, lineTotal: 120 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 120, vatAmount: 20.4, totalInclVat: 140.4 }),
        baselines: { [po.productId!]: { p50: 9, p90: 10 } },
      }),
    );
    expect(out.discrepancies.map((d) => d.type)).toEqual(['PRICE_HIGHER']);
    expect(agorot(out.totalDiscrepancyAmount)).toBe(2000);
  });
});
