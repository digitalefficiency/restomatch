import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../engine';
import { DEFAULT_TOLERANCES, grLine, input, invoiceHeader, invoiceLine, poLine } from './fixtures';

/** Build a single-line scenario where qty matches and price is parametrized */
function priceScenario(expected: number, actual: number) {
  const po = poLine({ id: 'po-1', qtyOrdered: 10, unitPriceExpected: expected });
  const subtotal = actual * 10;
  return input({
    poLines: [po],
    grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
    invoiceLines: [invoiceLine({ qtyBilled: 10, unitPriceBilled: actual, lineTotal: subtotal })],
    invoice: invoiceHeader({
      totalExclVat: subtotal,
      vatAmount: subtotal * 0.17,
      totalInclVat: subtotal * 1.17,
    }),
  });
}

function qtyScenario(ordered: number, received: number) {
  const po = poLine({ id: 'po-1', qtyOrdered: ordered, unitPriceExpected: 10 });
  const subtotal = received * 10;
  return input({
    poLines: [po],
    grLines: [grLine({ poLineId: po.id, qtyReceived: received })],
    invoiceLines: [
      invoiceLine({ qtyBilled: received, unitPriceBilled: 10, lineTotal: subtotal }),
    ],
    invoice: invoiceHeader({
      totalExclVat: subtotal,
      vatAmount: subtotal * 0.17,
      totalInclVat: subtotal * 1.17,
    }),
  });
}

describe('runMatch — properties', () => {
  it('totalDiscrepancyAmount is always non-negative', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1000, noNaN: true }),
        fc.double({ min: 0.01, max: 1000, noNaN: true }),
        (expected, actual) => {
          const out = runMatch(priceScenario(expected, actual));
          expect(out.totalDiscrepancyAmount).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exact-match price never produces a price discrepancy', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1000, noNaN: true }), (price) => {
        const out = runMatch(priceScenario(price, price));
        const priceDiscrepancies = out.discrepancies.filter(
          (d) => d.type === 'PRICE_HIGHER' || d.type === 'PRICE_LOWER',
        );
        expect(priceDiscrepancies).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });

  it('price diff above blockPricePercent always yields block when PRICE_HIGHER', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 1000, noNaN: true }),
        fc.double({ min: 0.15, max: 5, noNaN: true }),
        (expected, multiplier) => {
          // actual >= 1.15× expected ⇒ pct ≥ 15% > blockPricePercent (10%)
          const actual = expected * (1 + multiplier);
          const out = runMatch(priceScenario(expected, actual));
          const higher = out.discrepancies.filter((d) => d.type === 'PRICE_HIGHER');
          expect(higher.length).toBeGreaterThan(0);
          expect(higher.every((d) => d.severity === 'block')).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('PRICE_LOWER is always info severity (price drop is good for restaurant)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 1000, noNaN: true }),
        fc.double({ min: 0.05, max: 0.9, noNaN: true }),
        (expected, dropPct) => {
          const actual = expected * (1 - dropPct);
          const out = runMatch(priceScenario(expected, actual));
          const lower = out.discrepancies.filter((d) => d.type === 'PRICE_LOWER');
          expect(lower.every((d) => d.severity === 'info')).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('clean scenario has no discrepancies and status=clean', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100, noNaN: true }),
        fc.integer({ min: 1, max: 50 }),
        (price, qty) => {
          const po = poLine({ id: 'po-1', qtyOrdered: qty, unitPriceExpected: price });
          const subtotal = price * qty;
          const out = runMatch(
            input({
              poLines: [po],
              grLines: [grLine({ poLineId: po.id, qtyReceived: qty })],
              invoiceLines: [
                invoiceLine({ qtyBilled: qty, unitPriceBilled: price, lineTotal: subtotal }),
              ],
              invoice: invoiceHeader({
                totalExclVat: subtotal,
                vatAmount: subtotal * 0.17,
                totalInclVat: subtotal * 1.17,
              }),
            }),
          );
          expect(out.status).toBe('clean');
          expect(out.discrepancies).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('qty above 10% deviation always produces a discrepancy', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 500 }),
        fc.double({ min: 0.11, max: 0.9, noNaN: true }),
        fc.boolean(),
        (ordered, deviationPct, isShort) => {
          const delta = Math.ceil(ordered * deviationPct);
          const received = isShort ? ordered - delta : ordered + delta;
          if (received <= 0) return;
          const out = runMatch(qtyScenario(ordered, received));
          const qtyDisc = out.discrepancies.filter(
            (d) => d.type === 'QTY_SHORT' || d.type === 'QTY_OVER',
          );
          expect(qtyDisc.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('duplicate invoice always blocks regardless of other content', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 3, maxLength: 30 }), (invoiceNumber) => {
        const known = new Set([invoiceNumber]);
        const out = runMatch(
          input({
            poLines: [],
            grLines: [],
            invoiceLines: [invoiceLine({ lineTotal: 100 })],
            invoice: invoiceHeader({
              invoiceNumber,
              totalExclVat: 100,
              vatAmount: 17,
              totalInclVat: 117,
            }),
            knownInvoiceNumbers: known,
          }),
        );
        expect(out.status).toBe('blocked');
        expect(out.discrepancies.some((d) => d.type === 'DUPLICATE_INVOICE')).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('overall status monotonically reflects severity tiers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100, noNaN: true }),
        fc.double({ min: 0.001, max: 1.0, noNaN: true }),
        (expected, deltaPct) => {
          const actual = expected * (1 + deltaPct);
          const out = runMatch(priceScenario(expected, actual));
          const hasBlock = out.discrepancies.some((d) => d.severity === 'block');
          const hasWarn = out.discrepancies.some((d) => d.severity === 'warn');
          const hasInfo = out.discrepancies.some((d) => d.severity === 'info');
          if (hasBlock) {
            expect(out.status).toBe('blocked');
          } else if (hasWarn) {
            expect(out.status).toBe('major');
          } else if (hasInfo) {
            expect(out.status).toBe('minor');
          } else {
            expect(out.status).toBe('clean');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tolerances are respected: tighter percent never reduces discrepancy count', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 200, noNaN: true }),
        fc.double({ min: 0.02, max: 0.3, noNaN: true }),
        (expected, deltaPct) => {
          const actual = expected * (1 + deltaPct);
          const looseOut = runMatch({
            ...priceScenario(expected, actual),
            tolerances: { ...DEFAULT_TOLERANCES, pricePercent: 0.05, priceAbsolute: 10 },
          });
          const strictOut = runMatch({
            ...priceScenario(expected, actual),
            tolerances: { ...DEFAULT_TOLERANCES, pricePercent: 0.005, priceAbsolute: 0.5 },
          });
          expect(strictOut.discrepancies.length).toBeGreaterThanOrEqual(
            looseOut.discrepancies.length,
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});
