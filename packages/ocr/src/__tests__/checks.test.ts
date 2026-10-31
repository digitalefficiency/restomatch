import { describe, expect, it } from 'vitest';
import {
  checkInvoice,
  defaultVatRate,
  isValidIsraeliBusinessId,
  lineProductAgorot,
  toAgorot,
  type CheckableInvoice,
} from '../checks';
import { runOcrPipeline } from '../pipeline';
import { StubOcrProvider } from '../providers/stub';
import type { InvoiceOcrResult } from '@restomatch/types';

/** A clean 18% invoice that adds up to the agora (the bench fixture's numbers). */
const CLEAN: CheckableInvoice & InvoiceOcrResult = {
  supplier: { name: 'ירקות השרון בע"מ', businessId: '514276385' },
  invoiceNumber: '40917',
  invoiceDate: '2026-10-14',
  allocationNumber: '204917335',
  lines: [
    { rawDescription: 'עגבניות שרי', qty: 12, unit: 'ק"ג', unitPrice: 14.9, lineTotal: 178.8 },
    { rawDescription: 'מלפפונים', qty: 20, unit: 'ק"ג', unitPrice: 6.5, lineTotal: 130 },
    { rawDescription: 'בצל יבש', qty: 15, unit: 'ק"ג', unitPrice: 4.2, lineTotal: 63 },
    { rawDescription: 'פטרוזיליה צרור', qty: 30, unit: "יח'", unitPrice: 3.5, lineTotal: 105 },
    { rawDescription: 'תפוחי אדמה לבנים', qty: 25, unit: 'ק"ג', unitPrice: 5.8, lineTotal: 145 },
    { rawDescription: 'לימונים', qty: 8, unit: 'ק"ג', unitPrice: 9.9, lineTotal: 79.2 },
  ],
  totals: { subtotal: 701, vat: 126.18, total: 827.18 },
  confidence: 0.96,
};

const withLines = (lines: CheckableInvoice['lines'], totals = CLEAN.totals) => ({ ...CLEAN, lines, totals }) as typeof CLEAN;

describe('arithmetic gate (integer agorot)', () => {
  it('a clean invoice passes every check', () => {
    const c = checkInvoice(CLEAN);
    expect(c).toMatchObject({ passed: true, reasons: [], score: 1, vatRateUsed: 0.18 });
  });

  it('a 1,250 → 1,750 misread on a line total is flagged (it would have been a ₪500 "leak")', () => {
    // True line: 10 × ₪125 = ₪1,250; the model read the total as ₪1,750.
    const truth = { rawDescription: 'פילה סלמון', qty: 10, unit: 'ק"ג', unitPrice: 125, lineTotal: 1250 };
    const subtotal = 701 + 1250;
    const totals = { subtotal, vat: Number((subtotal * 0.18).toFixed(2)), total: Number((subtotal * 1.18).toFixed(2)) };
    expect(checkInvoice(withLines([...CLEAN.lines, truth], totals)).passed).toBe(true);

    const misread = checkInvoice(withLines([...CLEAN.lines, { ...truth, lineTotal: 1750 }], totals));
    expect(misread.passed).toBe(false);
    expect(misread.reasons).toEqual(expect.arrayContaining(['line_math_mismatch', 'subtotal_mismatch']));
    expect(misread.issues.find((i) => i.code === 'line_math_mismatch')).toMatchObject({ line: 6, deltaAgorot: 50_000 });
    expect(misread.score).toBeLessThan(0.85);
  });

  it('the same misread on the unit price (125 → 175) is flagged on the line', () => {
    const lines = [...CLEAN.lines];
    lines[0] = { ...lines[0]!, unitPrice: 19.9 }; // 12 × 19.9 ≠ 178.80
    expect(checkInvoice(withLines(lines)).reasons).toEqual(['line_math_mismatch']);
  });

  it('a wrong VAT amount is flagged; a wrong grand total too', () => {
    expect(checkInvoice({ ...CLEAN, totals: { ...CLEAN.totals, vat: 162.18 } }).reasons).toEqual(
      expect.arrayContaining(['vat_mismatch']),
    );
    expect(checkInvoice({ ...CLEAN, totals: { ...CLEAN.totals, total: 872.18 } }).reasons).toEqual(['total_mismatch']);
  });

  it('honours the printed VAT rate, then the line rate, then 17%/18% by date', () => {
    const at17 = { ...CLEAN, totals: { subtotal: 701, vat: 119.17, total: 820.17 } };
    expect(checkInvoice(at17).reasons).toEqual(['vat_mismatch']); // 2026 → 18% by default
    expect(checkInvoice({ ...at17, totals: { ...at17.totals, vatRate: 0.17 } }).passed).toBe(true);
    expect(checkInvoice({ ...at17, lines: at17.lines.map((l) => ({ ...l, vatRate: 0.17 })) }).passed).toBe(true);
    expect(defaultVatRate('2024-12-31')).toBe(0.17);
    expect(defaultVatRate('2025-01-01')).toBe(0.18);
  });

  it('zero-rated produce (0% VAT) passes — per line, printed, or VAT 0 on the document', () => {
    const zero = { ...CLEAN, totals: { subtotal: 701, vat: 0, total: 701 } };
    expect(checkInvoice({ ...zero, lines: zero.lines.map((l) => ({ ...l, vatRate: 0 })) }).passed).toBe(true);
    expect(checkInvoice({ ...zero, totals: { ...zero.totals, vatRate: 0 } }).passed).toBe(true);
    expect(checkInvoice(zero).passed).toBe(true); // printed 0, no rate given
    // …but a "0" VAT whose total still includes VAT is a misread.
    expect(checkInvoice({ ...zero, totals: { subtotal: 701, vat: 0, total: 827.18 } }).reasons).toEqual(['total_mismatch']);
  });

  it('a mixed invoice (0% produce + 18% goods) passes line by line', () => {
    const lines = CLEAN.lines.map((l, i) => ({ ...l, vatRate: i < 3 ? 0 : 0.18 }));
    // 18% only on 105 + 145 + 79.20 = 329.20 → 59.26
    const totals = { subtotal: 701, vat: 59.26, total: 760.26 };
    expect(checkInvoice(withLines(lines, totals)).passed).toBe(true);
    expect(checkInvoice(withLines(lines, { ...totals, vat: 95.26, total: 796.26 })).reasons).toEqual(['vat_mismatch']);
  });

  it('a discounted line passes (net unit price; the line check is skipped for it)', () => {
    const lines = [...CLEAN.lines];
    // 12 × 16.56 gross with 10% off = 178.85 printed — the read gives the net price.
    lines[0] = { ...lines[0]!, unitPrice: 16.56, lineDiscountPct: 10 };
    expect(checkInvoice(withLines(lines)).passed).toBe(true);
    // Without the discount flag the same numbers are a mismatch.
    lines[0] = { ...lines[0]!, lineDiscountPct: undefined };
    expect(checkInvoice(withLines(lines)).reasons).toEqual(['line_math_mismatch']);
  });

  it('an invoice-level discount skips Σ lines vs subtotal (VAT and total are still checked)', () => {
    const totals = { subtotal: 681, vat: 122.58, total: 803.58 }; // ₪20 off
    expect(checkInvoice(withLines(CLEAN.lines, totals)).reasons).toEqual(['subtotal_mismatch']);
    expect(checkInvoice({ ...withLines(CLEAN.lines, totals), invoiceDiscount: 20 }).passed).toBe(true);
  });

  it('deposit lines may sit outside the VAT base', () => {
    const deposit = { rawDescription: 'פיקדון ארגזים', qty: 4, unit: "יח'", unitPrice: 5, lineTotal: 20, lineKind: 'deposit' as const };
    // subtotal 721 includes the deposit; VAT only on 701; total = 721 + 126.18.
    const inv = withLines([...CLEAN.lines, deposit], { subtotal: 721, vat: 126.18, total: 847.18 });
    expect(checkInvoice(inv).passed).toBe(true);
  });

  it('missing invoice number, date or total is flagged', () => {
    const c = checkInvoice({ ...CLEAN, invoiceNumber: '', invoiceDate: undefined, totals: { ...CLEAN.totals, total: undefined } });
    expect(c.reasons).toEqual(
      expect.arrayContaining(['missing_invoice_number', 'missing_invoice_date', 'missing_total']),
    );
  });

  it('document flags and non-invoices go to review', () => {
    expect(checkInvoice({ ...CLEAN, continuesOnAnotherPage: true }).reasons).toEqual(['continues_on_another_page']);
    expect(checkInvoice({ ...CLEAN, handwrittenCorrection: true }).reasons).toEqual(['handwritten_correction']);
    expect(checkInvoice({ ...CLEAN, documentKind: 'quote' }).reasons).toEqual(['document_kind_not_invoice']);
    expect(checkInvoice({ ...CLEAN, documentKind: 'tax_invoice_receipt' }).passed).toBe(true);
  });

  it('works in agorot: no binary-float drift, half-up at qty × price', () => {
    expect(toAgorot(1.005)).toBe(101);
    expect(toAgorot(0.1 + 0.2)).toBe(30);
    expect(lineProductAgorot(3, 0.1)).toBe(30);
    expect(lineProductAgorot(1.5, 3.333)).toBe(500); // 4.9995 → 5.00 (half-up)
    expect(lineProductAgorot(12.345, 6.4321)).toBe(7940); // 79.4042745
    expect(lineProductAgorot(-2, 10)).toBe(-2000); // credit note
  });
});

describe('ח״פ / ע״מ check digit', () => {
  it.each([
    ['514276385', true],
    ['514276389', false],
    ['000000018', true],
    ['18', true], // short ids are left-padded
    ['123456782', true],
    ['123456789', false],
    ['301234563', true],
    ['51-427638-5', true], // printed separators ignored
    ['000000000', false],
    ['', false],
    ['1234567890', false], // 10 digits
  ])('%s → %s', (id, ok) => {
    expect(isValidIsraeliBusinessId(id)).toBe(ok);
  });

  it('an invalid printed ח״פ and a ח״פ different from the one on file are flagged', () => {
    expect(checkInvoice({ ...CLEAN, supplier: { businessId: '514276389' } }).reasons).toEqual(['supplier_id_invalid']);
    expect(checkInvoice(CLEAN, { expectedSupplierBusinessId: '514276385' }).passed).toBe(true);
    expect(checkInvoice(CLEAN, { expectedSupplierBusinessId: '515555551' }).reasons).toEqual(['supplier_id_mismatch']);
  });
});

describe('runOcrPipeline + gate', () => {
  const single = (inv: InvoiceOcrResult) => {
    const p = new StubOcrProvider('claude_vision', inv);
    return { documentAi: p, claude: p };
  };

  it('a clean single-provider read: confidence = the model confidence, no review', async () => {
    const r = await runOcrPipeline('x', single(CLEAN));
    expect(r.checks.passed).toBe(true);
    expect(r.confidence).toBe(0.96);
    expect(r.needsHumanReview).toBe(false);
  });

  it('a misread forces review and caps confidence below the threshold (it was a flat 1.0)', async () => {
    const lines = [...CLEAN.lines];
    lines[3] = { ...lines[3]!, lineTotal: 155 }; // 30 × 3.50 = 105, read as 155
    const r = await runOcrPipeline('x', single({ ...CLEAN, lines, confidence: 0.99 }));
    expect(r.needsHumanReview).toBe(true);
    expect(r.confidence).toBe(0.5);
    expect(r.checks.reasons).toEqual(expect.arrayContaining(['line_math_mismatch', 'subtotal_mismatch']));
  });

  it('a low model confidence alone now reaches the owner threshold', async () => {
    const r = await runOcrPipeline('x', single({ ...CLEAN, confidence: 0.6 }));
    expect(r.checks.passed).toBe(true);
    expect(r.confidence).toBe(0.6);
    expect(r.needsHumanReview).toBe(true);
  });

  it('passes expectedSupplierBusinessId to the gate and carries the v2 fields onto the reconciled invoice', async () => {
    const v2 = { ...CLEAN, documentKind: 'tax_invoice', buyer: { name: 'ציקטי' }, totals: { ...CLEAN.totals, vatRate: 0.18 } };
    const r = await runOcrPipeline('x', { ...single(v2 as InvoiceOcrResult), expectedSupplierBusinessId: '515555551' });
    expect(r.checks.reasons).toEqual(['supplier_id_mismatch']);
    expect(r.needsHumanReview).toBe(true);
    expect(r.reconciled.documentKind).toBe('tax_invoice');
    expect(r.reconciled.buyer).toEqual({ name: 'ציקטי' });
    expect(r.reconciled.totals.vatRate).toBe(0.18);
  });
});
