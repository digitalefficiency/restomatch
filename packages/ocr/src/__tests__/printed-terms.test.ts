/**
 * G-17 · printed payment terms + due date (brief §4.1). The model's read is
 * kept verbatim for the terms string and as YYYY-MM-DD for the date; an
 * unreadable or absent value is `undefined`, never a guess.
 */
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../providers/claudeVision';
import { InvoiceExtractionV2 } from '../providers/invoiceSchema';
import { normalizeExtraction } from '../providers/normalizeExtraction';

const BASE = {
  supplier: { name: 'ירקני אבי בע״מ', businessId: '514888888' },
  invoiceNumber: 'A-10293',
  invoiceDate: '2026-10-15',
  lines: [{ rawDescription: 'עגבניה שרי', qty: 2, unit: 'ק״ג', unitPrice: 10, lineTotal: 20 }],
  totals: { subtotal: 20, vat: 3.6, total: 23.6 },
};

const read = (extra: Record<string, unknown>) =>
  InvoiceExtractionV2.parse(normalizeExtraction({ ...BASE, ...extra }));

describe('printed payment terms (G-17)', () => {
  it.each(['שוטף+60', 'שוטף + 30', 'net 45', 'מזומן'])('keeps %s verbatim', (t) => {
    expect(read({ paymentTermsText: t }).paymentTermsText).toBe(t);
  });

  it('trims, and an empty / null / non-string read is absent', () => {
    expect(read({ paymentTermsText: '  שוטף + 60  ' }).paymentTermsText).toBe('שוטף + 60');
    expect(read({ paymentTermsText: '   ' }).paymentTermsText).toBeUndefined();
    expect(read({ paymentTermsText: null }).paymentTermsText).toBeUndefined();
    expect(read({ paymentTermsText: 60 }).paymentTermsText).toBeUndefined();
    expect(read({ paymentTermsText: 'x'.repeat(201) }).paymentTermsText).toBeUndefined();
  });

  it('"לתשלום עד 30.11.2026" read as ISO is kept; any other shape is absent, never a guess', () => {
    expect(read({ dueDate: '2026-11-30' }).dueDate).toBe('2026-11-30');
    expect(read({ dueDate: '30.11.2026' }).dueDate).toBeUndefined();
    expect(read({ dueDate: 'סוף החודש' }).dueDate).toBeUndefined();
    expect(read({ dueDate: null }).dueDate).toBeUndefined();
  });

  it('an invoice with no printed terms parses exactly as before', () => {
    const r = read({});
    expect(r.paymentTermsText).toBeUndefined();
    expect(r.dueDate).toBeUndefined();
    expect('paymentTermsText' in r && r.paymentTermsText !== undefined).toBe(false);
  });

  it('the prompt asks for both fields and forbids computing a date from the terms', () => {
    expect(SYSTEM_PROMPT).toContain('"paymentTermsText"');
    expect(SYSTEM_PROMPT).toContain('"dueDate": "YYYY-MM-DD" | null');
    expect(SYSTEM_PROMPT).toContain('אל תחשב תאריך מתנאי התשלום');
  });
});
