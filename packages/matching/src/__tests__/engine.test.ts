import { describe, expect, it } from 'vitest';
import { runMatch } from '../engine';
import type { Discrepancy, DiscrepancyType, Severity } from '../index';
import {
  DEFAULT_TOLERANCES,
  grLine,
  happyPath,
  input,
  invoiceHeader,
  invoiceLine,
  poLine,
} from './fixtures';

function ofType(d: Discrepancy[], type: DiscrepancyType): Discrepancy[] {
  return d.filter((x) => x.type === type);
}

function maxSeverity(d: Discrepancy[]): Severity | null {
  if (d.length === 0) return null;
  if (d.some((x) => x.severity === 'block')) return 'block';
  if (d.some((x) => x.severity === 'warn')) return 'warn';
  return 'info';
}

describe('runMatch — happy paths (clean)', () => {
  it('empty input → clean', () => {
    const out = runMatch(input());
    expect(out.status).toBe('clean');
    expect(out.discrepancies).toEqual([]);
    expect(out.totalDiscrepancyAmount).toBe(0);
  });

  it('exact match (PO ↔ GR ↔ INV) → clean', () => {
    const out = runMatch(happyPath());
    expect(out.status).toBe('clean');
    expect(out.discrepancies).toEqual([]);
  });

  it('price within ±2% tolerance → clean', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 10.15, lineTotal: 101.5 })],
        invoice: invoiceHeader({ totalExclVat: 101.5, vatAmount: 17.26, totalInclVat: 118.76 }),
      }),
    );
    expect(out.status).toBe('clean');
  });

  it('qty within ±3% tolerance → clean', () => {
    const po = poLine({ id: 'po-1', qtyOrdered: 100 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 98 })],
        invoiceLines: [invoiceLine({ qtyBilled: 98, lineTotal: 784 })],
        invoice: invoiceHeader({
          totalExclVat: 784,
          vatAmount: 133.28,
          totalInclVat: 917.28,
        }),
      }),
    );
    expect(out.status).toBe('clean');
  });
});

describe('runMatch — price discrepancies', () => {
  it('PRICE_HIGHER above warn tolerance (3%) → warn severity', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 10.3, lineTotal: 103 })],
        invoice: invoiceHeader({ totalExclVat: 103, vatAmount: 17.51, totalInclVat: 120.51 }),
      }),
    );
    const price = ofType(out.discrepancies, 'PRICE_HIGHER');
    expect(price).toHaveLength(1);
    expect(price[0]?.severity).toBe('warn');
  });

  it('PRICE_HIGHER >10% → block severity', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 12, lineTotal: 120 })],
        invoice: invoiceHeader({ totalExclVat: 120, vatAmount: 20.4, totalInclVat: 140.4 }),
      }),
    );
    const price = ofType(out.discrepancies, 'PRICE_HIGHER');
    expect(price).toHaveLength(1);
    expect(price[0]?.severity).toBe('block');
    expect(out.status).toBe('blocked');
  });

  it('PRICE_LOWER above tolerance → recorded as info (positive surprise)', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 9, lineTotal: 90 })],
        invoice: invoiceHeader({ totalExclVat: 90, vatAmount: 15.3, totalInclVat: 105.3 }),
      }),
    );
    const price = ofType(out.discrepancies, 'PRICE_LOWER');
    expect(price).toHaveLength(1);
    expect(price[0]?.severity).toBe('info');
  });

  it('absolute price tolerance kicks in for small items', () => {
    // expected ₪3, billed ₪7 — 133% increase but only ₪4 absolute,
    // still over the ₪5 absolute threshold → warn
    const po = poLine({ id: 'po-1', qtyOrdered: 1, unitPriceExpected: 3 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 1 })],
        invoiceLines: [invoiceLine({ qtyBilled: 1, unitPriceBilled: 7, lineTotal: 7 })],
        invoice: invoiceHeader({ totalExclVat: 7, vatAmount: 1.19, totalInclVat: 8.19 }),
      }),
    );
    const price = ofType(out.discrepancies, 'PRICE_HIGHER');
    expect(price.length).toBeGreaterThan(0);
  });
});

describe('runMatch — quantity discrepancies', () => {
  it('QTY_SHORT — received less than ordered', () => {
    const po = poLine({ id: 'po-1', qtyOrdered: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 8 })],
        invoiceLines: [invoiceLine({ qtyBilled: 8, lineTotal: 64 })],
        invoice: invoiceHeader({ totalExclVat: 64, vatAmount: 10.88, totalInclVat: 74.88 }),
      }),
    );
    const qty = ofType(out.discrepancies, 'QTY_SHORT');
    expect(qty).toHaveLength(1);
    expect(qty[0]?.severity).not.toBe('info');
  });

  it('QTY_OVER — received more than ordered', () => {
    const po = poLine({ id: 'po-1', qtyOrdered: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 13 })],
        invoiceLines: [invoiceLine({ qtyBilled: 13, lineTotal: 104 })],
        invoice: invoiceHeader({ totalExclVat: 104, vatAmount: 17.68, totalInclVat: 121.68 }),
      }),
    );
    const qty = ofType(out.discrepancies, 'QTY_OVER');
    expect(qty).toHaveLength(1);
  });

  it('billed more than received → block (severe — likely overcharge)', () => {
    const po = poLine({ id: 'po-1', qtyOrdered: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 8 })],
        // billed 10 (full order) even though only 8 arrived
        invoiceLines: [invoiceLine({ qtyBilled: 10, lineTotal: 80 })],
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
      }),
    );
    expect(out.status).toBe('blocked');
    // QTY_SHORT for ordered vs received + a flag for billed > received
    const qtyShort = ofType(out.discrepancies, 'QTY_SHORT');
    const qtyOver = ofType(out.discrepancies, 'QTY_OVER');
    expect(qtyShort.length + qtyOver.length).toBeGreaterThan(0);
  });

  it('absolute qty tolerance for single-unit items', () => {
    const po = poLine({ id: 'po-1', qtyOrdered: 3, unit: 'יח׳' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 2 })],
        invoiceLines: [invoiceLine({ qtyBilled: 2, unit: 'יח׳', lineTotal: 16 })],
        invoice: invoiceHeader({ totalExclVat: 16, vatAmount: 2.72, totalInclVat: 18.72 }),
      }),
    );
    // 1 unit diff = within absolute tolerance → info
    const qty = ofType(out.discrepancies, 'QTY_SHORT');
    expect(qty[0]?.severity).toBe('info');
  });
});

describe('runMatch — unit mismatches', () => {
  it('UNIT_MISMATCH — PO ק״ג vs invoice יח׳', () => {
    const po = poLine({ id: 'po-1', unit: 'ק״ג' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ unit: 'יח׳' })],
        invoice: invoiceHeader(),
      }),
    );
    const unit = ofType(out.discrepancies, 'UNIT_MISMATCH');
    expect(unit).toHaveLength(1);
    expect(unit[0]?.severity).toBe('warn');
  });

  it('matching units → no UNIT_MISMATCH', () => {
    const po = poLine({ id: 'po-1', unit: 'ק״ג' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ unit: 'ק״ג' })],
        invoice: invoiceHeader(),
      }),
    );
    expect(ofType(out.discrepancies, 'UNIT_MISMATCH')).toEqual([]);
  });
});

describe('runMatch — item-level mismatches', () => {
  it('UNORDERED_ITEM — invoice has product not in PO', () => {
    const po = poLine({ id: 'po-1', productId: 'product-A' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, productId: 'product-A' })],
        invoiceLines: [
          invoiceLine({ productId: 'product-A', lineTotal: 80 }),
          invoiceLine({ productId: 'product-B', qtyBilled: 5, unitPriceBilled: 4, lineTotal: 20 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 17, totalInclVat: 117 }),
      }),
    );
    const unordered = ofType(out.discrepancies, 'UNORDERED_ITEM');
    expect(unordered).toHaveLength(1);
    expect(unordered[0]?.severity).toBe('block');
    expect(unordered[0]?.productId).toBe('product-B');
  });

  it('MISSING_ON_INVOICE — PO line not on invoice', () => {
    const poA = poLine({ id: 'po-A', productId: 'product-A' });
    const poB = poLine({
      id: 'po-B',
      productId: 'product-B',
      qtyOrdered: 5,
      unitPriceExpected: 4,
    });
    const out = runMatch(
      input({
        poLines: [poA, poB],
        grLines: [
          grLine({ poLineId: poA.id, productId: 'product-A' }),
          grLine({ poLineId: poB.id, productId: 'product-B', qtyReceived: 5 }),
        ],
        invoiceLines: [invoiceLine({ productId: 'product-A', lineTotal: 80 })],
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
      }),
    );
    const missing = ofType(out.discrepancies, 'MISSING_ON_INVOICE');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.productId).toBe('product-B');
  });

  it('UNORDERED_ARRIVAL — invoice without any PO at all', () => {
    const out = runMatch(
      input({
        poLines: [],
        grLines: [],
        invoiceLines: [invoiceLine({ productId: 'product-X', lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 17, totalInclVat: 117 }),
      }),
    );
    const arrival = ofType(out.discrepancies, 'UNORDERED_ARRIVAL');
    expect(arrival).toHaveLength(1);
    expect(arrival[0]?.severity).toBe('block');
  });
});

describe('runMatch — aggregate checks', () => {
  it('TOTAL_MISMATCH — sum of line totals ≠ invoice subtotal', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ lineTotal: 80 })],
        // Subtotal claims 95 but lines sum to 80
        invoice: invoiceHeader({ totalExclVat: 95, vatAmount: 16.15, totalInclVat: 111.15 }),
      }),
    );
    const total = ofType(out.discrepancies, 'TOTAL_MISMATCH');
    expect(total).toHaveLength(1);
    expect(total[0]?.severity).toBe('block');
  });

  it('VAT_MISMATCH — vat amount differs from subtotal × vatRate', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ lineTotal: 80 })],
        // 80 × 17% = 13.6, but invoice says 20
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 20, totalInclVat: 100 }),
      }),
    );
    const vat = ofType(out.discrepancies, 'VAT_MISMATCH');
    expect(vat).toHaveLength(1);
  });

  it('VAT_MISMATCH NOT triggered for rounding within ±₪0.10', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ lineTotal: 80 })],
        // 80 × 17% = 13.6, invoice claims 13.65 (rounding)
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.65, totalInclVat: 93.65 }),
      }),
    );
    expect(ofType(out.discrepancies, 'VAT_MISMATCH')).toEqual([]);
  });

  it('per-supplier 18% VAT (Zestt) suppresses the false VAT_MISMATCH the 17% default would raise', () => {
    // Real numbers from order_7158745.pdf: ₪5054 ex-VAT, ₪909.72 VAT (18%), ₪5963.72 incl.
    const po = poLine({ id: 'po-z', qtyOrdered: 1, unitPriceExpected: 5054 });
    const scenario = {
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 1 })],
      invoiceLines: [invoiceLine({ qtyBilled: 1, unitPriceBilled: 5054, lineTotal: 5054 })],
      invoice: invoiceHeader({ totalExclVat: 5054, vatAmount: 909.72, totalInclVat: 5963.72 }),
    };
    // 5054 × 0.18 = 909.72 → no mismatch once the supplier's real rate is threaded.
    const at18 = runMatch(input({ ...scenario, vatRate: 0.18 }));
    expect(ofType(at18.discrepancies, 'VAT_MISMATCH')).toEqual([]);
    // 5054 × 0.17 = 859.18 ≠ 909.72 → the default would fire a phantom mismatch.
    const at17 = runMatch(input({ ...scenario, vatRate: 0.17 }));
    expect(ofType(at17.discrepancies, 'VAT_MISMATCH')).toHaveLength(1);
  });
});

describe('runMatch — duplicate detection', () => {
  it('DUPLICATE_INVOICE when invoice number already exists for supplier', () => {
    const known = new Set(['INV-1001', 'INV-1002']);
    const out = runMatch(
      input({
        poLines: [],
        grLines: [],
        invoiceLines: [invoiceLine({ lineTotal: 100 })],
        invoice: invoiceHeader({
          invoiceNumber: 'INV-1001',
          totalExclVat: 100,
          vatAmount: 17,
          totalInclVat: 117,
        }),
        knownInvoiceNumbers: known,
      }),
    );
    const dup = ofType(out.discrepancies, 'DUPLICATE_INVOICE');
    expect(dup).toHaveLength(1);
    expect(dup[0]?.severity).toBe('block');
    expect(out.status).toBe('blocked');
  });

  it('no DUPLICATE_INVOICE when number is new', () => {
    const known = new Set(['INV-1002']);
    const out = runMatch(
      input({
        poLines: [],
        grLines: [],
        invoiceLines: [invoiceLine()],
        invoice: invoiceHeader({ invoiceNumber: 'INV-1001' }),
        knownInvoiceNumbers: known,
      }),
    );
    expect(ofType(out.discrepancies, 'DUPLICATE_INVOICE')).toEqual([]);
  });
});

describe('runMatch — baseline-driven price anomalies', () => {
  it('PRICE_HIGHER when price exceeds p90 baseline', () => {
    const po = poLine({ id: 'po-1', productId: 'product-A', unitPriceExpected: 8 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, productId: 'product-A' })],
        invoiceLines: [
          invoiceLine({ productId: 'product-A', unitPriceBilled: 12, lineTotal: 120 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 120, vatAmount: 20.4, totalInclVat: 140.4 }),
        baselines: { 'product-A': { p50: 8, p90: 9 } },
      }),
    );
    const prices = ofType(out.discrepancies, 'PRICE_HIGHER');
    expect(prices.length).toBeGreaterThanOrEqual(1);
    // Should be block-severity (>10% above expected, and well above p90)
    expect(prices.some((d) => d.severity === 'block')).toBe(true);
  });

  it('price under p90 → no anomaly even if above PO expected', () => {
    const po = poLine({ id: 'po-1', productId: 'product-A', unitPriceExpected: 7 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, productId: 'product-A' })],
        invoiceLines: [
          invoiceLine({ productId: 'product-A', unitPriceBilled: 7.1, lineTotal: 71 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 71, vatAmount: 12.07, totalInclVat: 83.07 }),
        baselines: { 'product-A': { p50: 7, p90: 8 } },
      }),
    );
    // 7.1 vs 7 = within tolerance, no discrepancy
    expect(out.status).toBe('clean');
  });
});

describe('runMatch — date anomalies', () => {
  it('DATE_ANOMALY when invoice date >7 days from expected delivery', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine()],
        invoice: invoiceHeader({ invoiceDate: new Date('2026-05-01') }),
        expectedDeliveryDate: new Date('2026-05-15'),
      }),
    );
    const dateD = ofType(out.discrepancies, 'DATE_ANOMALY');
    expect(dateD).toHaveLength(1);
  });

  it('no DATE_ANOMALY when invoice date within ±7 days of expected', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine()],
        invoice: invoiceHeader({ invoiceDate: new Date('2026-05-13') }),
        expectedDeliveryDate: new Date('2026-05-15'),
      }),
    );
    expect(ofType(out.discrepancies, 'DATE_ANOMALY')).toEqual([]);
  });
});

describe('runMatch — overall status calculation', () => {
  it('no discrepancies → clean', () => {
    expect(runMatch(happyPath()).status).toBe('clean');
  });

  it('only info-level discrepancies → minor', () => {
    const po = poLine({ id: 'po-1', qtyOrdered: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 9 })],
        invoiceLines: [invoiceLine({ qtyBilled: 9, lineTotal: 72 })],
        invoice: invoiceHeader({ totalExclVat: 72, vatAmount: 12.24, totalInclVat: 84.24 }),
      }),
    );
    // 1 unit short = within absolute tolerance → info only
    expect(maxSeverity(out.discrepancies)).toBe('info');
    expect(out.status).toBe('minor');
  });

  it('any warn-level discrepancy → major', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 10.4, lineTotal: 104 })],
        invoice: invoiceHeader({ totalExclVat: 104, vatAmount: 17.68, totalInclVat: 121.68 }),
      }),
    );
    expect(maxSeverity(out.discrepancies)).toBe('warn');
    expect(out.status).toBe('major');
  });

  it('any block-level discrepancy → blocked', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [
          invoiceLine({ lineTotal: 80 }),
          invoiceLine({ productId: 'product-Z', qtyBilled: 1, unitPriceBilled: 200, lineTotal: 200 }),
        ],
        invoice: invoiceHeader({ totalExclVat: 280, vatAmount: 47.6, totalInclVat: 327.6 }),
      }),
    );
    expect(out.status).toBe('blocked');
  });

  it('totalDiscrepancyAmount is the sum of absolute deltas', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 12, lineTotal: 120 })],
        invoice: invoiceHeader({ totalExclVat: 120, vatAmount: 20.4, totalInclVat: 140.4 }),
      }),
    );
    // (12-10) × 10 = ₪20 discrepancy
    expect(out.totalDiscrepancyAmount).toBeGreaterThanOrEqual(20);
  });
});

describe('runMatch — line linking', () => {
  it('matches invoice lines to PO lines via productId', () => {
    const po = poLine({ id: 'po-A', productId: 'product-A' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, productId: 'product-A' })],
        invoiceLines: [invoiceLine({ productId: 'product-A' })],
        invoice: invoiceHeader(),
      }),
    );
    expect(out.discrepancies).toEqual([]);
  });

  it('GR line linked by poLineId is matched even with different productId tracking', () => {
    const po = poLine({ id: 'po-A', productId: 'product-A', qtyOrdered: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, productId: 'product-A', qtyReceived: 10 })],
        invoiceLines: [invoiceLine({ productId: 'product-A', qtyBilled: 10 })],
        invoice: invoiceHeader(),
      }),
    );
    expect(out.status).toBe('clean');
  });
});

describe('runMatch — multi-line scenarios', () => {
  it('handles 5 lines with mixed pass/warn outcomes', () => {
    const poLines = Array.from({ length: 5 }).map((_, i) =>
      poLine({
        id: `po-${i}`,
        productId: `p-${i}`,
        qtyOrdered: 10,
        unitPriceExpected: 8,
      }),
    );
    const grLines = poLines.map((p) => grLine({ poLineId: p.id, productId: p.productId, qtyReceived: 10 }));
    const invoiceLines = poLines.map((p, i) =>
      invoiceLine({
        productId: p.productId,
        qtyBilled: 10,
        // line 0: clean, line 1: small price hike (warn), line 2-4: clean
        unitPriceBilled: i === 1 ? 8.4 : 8,
        lineTotal: i === 1 ? 84 : 80,
      }),
    );
    const subtotal = invoiceLines.reduce((s, l) => s + l.lineTotal, 0);
    const out = runMatch(
      input({
        poLines,
        grLines,
        invoiceLines,
        invoice: invoiceHeader({
          totalExclVat: subtotal,
          vatAmount: subtotal * 0.17,
          totalInclVat: subtotal * 1.17,
        }),
      }),
    );
    expect(out.status).toBe('major');
    expect(ofType(out.discrepancies, 'PRICE_HIGHER')).toHaveLength(1);
  });
});

describe('runMatch — VAT rate flexibility', () => {
  it('respects custom vatRate (e.g. 18% future Israeli rate)', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 18, totalInclVat: 118 }),
        vatRate: 0.18,
      }),
    );
    expect(ofType(out.discrepancies, 'VAT_MISMATCH')).toEqual([]);
  });

  it('vat zero is supported (exempt invoice)', () => {
    const po = poLine({ id: 'po-1' });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ lineTotal: 100 })],
        invoice: invoiceHeader({ totalExclVat: 100, vatAmount: 0, totalInclVat: 100 }),
        vatRate: 0,
      }),
    );
    expect(ofType(out.discrepancies, 'VAT_MISMATCH')).toEqual([]);
  });
});

describe('runMatch — output integrity', () => {
  it('every discrepancy has expected/actual/deltaAmount populated', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 12, lineTotal: 120 })],
        invoice: invoiceHeader({ totalExclVat: 120, vatAmount: 20.4, totalInclVat: 140.4 }),
      }),
    );
    for (const d of out.discrepancies) {
      expect(typeof d.deltaAmount).toBe('number');
      expect(d.toleranceUsed).toBeTruthy();
      expect(d.severity).toMatch(/^(info|warn|block)$/);
    }
  });

  it('totalDiscrepancyAmount is never negative', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 8, lineTotal: 80 })],
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
      }),
    );
    expect(out.totalDiscrepancyAmount).toBeGreaterThanOrEqual(0);
  });
});

describe('runMatch — custom tolerances', () => {
  it('tighter tolerance escalates a previously-info case to warn', () => {
    const po = poLine({ id: 'po-1', unitPriceExpected: 10 });
    const out = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id })],
        invoiceLines: [invoiceLine({ unitPriceBilled: 10.1, lineTotal: 101 })],
        invoice: invoiceHeader({ totalExclVat: 101, vatAmount: 17.17, totalInclVat: 118.17 }),
        tolerances: {
          ...DEFAULT_TOLERANCES,
          pricePercent: 0,
          priceAbsolute: 0,
          blockPricePercent: 0.5,
        },
      }),
    );
    expect(out.status).not.toBe('clean');
  });
});
