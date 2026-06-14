import { describe, expect, it } from 'vitest';
import { runMatch } from '../engine';
import { grLine, input, invoiceHeader, invoiceLine, poLine } from './fixtures';

/**
 * LEAK CANARY — the numbers-canary.
 *
 * This is the regression net around the one number the business sells: the ₪
 * leak. It feeds a fixed, hand-computed PO + GR + Invoice scenario through the
 * real `runMatch` engine and asserts the leak to the AGORA (integer-exact),
 * plus the exact discrepancy set. Money is quantized to integer agorot inside
 * the engine, so the assertion is `Math.round(total * 100) === <agorot>` — any
 * drift in the engine's money math (float creep, a tolerance change, a reshuffle
 * of discrepancy types) fails this test and, in the deploy pipeline, the deploy.
 *
 * If you change the matching engine and this test goes red, do NOT just update
 * the expected number — re-derive it by hand and make sure the change is
 * intended. This file is on the immutability list (AGENTS.md): human-PR only.
 */
describe('leak canary [leak-canary]', () => {
  it('headline scenario: short delivery + inflated price → ₪32.00 leak, exact', () => {
    // PO: 10 ק״ג ordered @ ₪8.00.  GR: only 8 received (short by 2).
    // Invoice: bills the 8 received but @ ₪10.00 (25% over the expected ₪8.00).
    //   QTY_SHORT  (warn) : |10-8| × ₪8.00 expected      = ₪16.00
    //   PRICE_HIGHER(block): |10-8| × 8 billed qty        = ₪16.00
    //   total leak                                        = ₪32.00 = 3200 agorot
    const po = poLine({ id: 'po-canary', qtyOrdered: 10, unitPriceExpected: 8.0 });
    const scenario = input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 8 })],
      invoiceLines: [
        invoiceLine({ productId: po.productId, qtyBilled: 8, unitPriceBilled: 10.0, lineTotal: 80 }),
      ],
      // header consistent with the billed lines so TOTAL/VAT do not also fire
      invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
    });

    const out = runMatch(scenario);

    const EXPECTED_LEAK_AGOROT = 3200; // ₪32.00
    expect(Math.round(out.totalDiscrepancyAmount * 100)).toBe(EXPECTED_LEAK_AGOROT);
    expect(out.discrepancies.map((d) => d.type).sort()).toEqual(['PRICE_HIGHER', 'QTY_SHORT']);
    expect(out.status).toBe('blocked');
  });

  it('scale-4 price quantizes to the agora: ₪8.1234 → ₪5.63 leak, exact', () => {
    // Exercises the price×qty rounding boundary: a NUMERIC(12,4) unit price.
    //   PRICE_HIGHER: (10.0 - 8.1234) × 3 = 5.6298 → rounds half-up to ₪5.63
    const po = poLine({ id: 'po-frac', qtyOrdered: 3, unitPriceExpected: 8.1234 });
    const scenario = input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 3 })],
      invoiceLines: [
        invoiceLine({ productId: po.productId, qtyBilled: 3, unitPriceBilled: 10.0, lineTotal: 30 }),
      ],
      invoice: invoiceHeader({ totalExclVat: 30, vatAmount: 5.1, totalInclVat: 35.1 }),
    });

    const out = runMatch(scenario);

    const EXPECTED_LEAK_AGOROT = 563; // ₪5.63 (5.6298 rounded to the agora)
    expect(Math.round(out.totalDiscrepancyAmount * 100)).toBe(EXPECTED_LEAK_AGOROT);
    expect(out.discrepancies.map((d) => d.type)).toEqual(['PRICE_HIGHER']);
  });

  it('the leak figure is always agora-clean (no sub-agora float dust)', () => {
    const po = poLine({ id: 'po-clean', qtyOrdered: 7, unitPriceExpected: 3.3333 });
    const scenario = input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 5 })],
      invoiceLines: [
        invoiceLine({ productId: po.productId, qtyBilled: 5, unitPriceBilled: 4.1111, lineTotal: 20.5555 }),
      ],
      invoice: invoiceHeader({ totalExclVat: 20.56, vatAmount: 3.5, totalInclVat: 24.06 }),
    });
    const out = runMatch(scenario);
    // total × 100 must be an integer (within float epsilon) — i.e. the leak is
    // expressible exactly in agorot, which is what makes the canary deterministic.
    const agorot = out.totalDiscrepancyAmount * 100;
    expect(Math.abs(agorot - Math.round(agorot))).toBeLessThan(1e-6);
  });
});
