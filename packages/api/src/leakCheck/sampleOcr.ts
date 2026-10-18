/**
 * Deterministic SAMPLE extraction for the leak check when real OCR is off
 * (local dev, CI, a demo deployment with LEAK_CHECK_ALLOW_SAMPLE=1). The i-th
 * distinct file uploaded maps to the i-th sample invoice (cycling), so a
 * prospect sees the full flow without spend. The result page labels these
 * numbers as SAMPLE data — they are never presented as the prospect's own.
 *
 * Expected findings over the first four invoices (asserted in tests):
 *   #1017 tomatoes  creep  20 kg × (7.20 − 6.50) = ₪14.00
 *   #1017 onions    line   printed 44.00 vs 10 × 4.00 = ₪4.00
 *   #5502 VAT       77.76 vs 18% × 388.80 = 69.98 → ₪7.78
 *   #5530 cream     creep  12 L × (15.90 − 14.90) = ₪12.00
 *   → ₪37.78. The 5th file is a re-sent #5502 → duplicate ₪466.56.
 */
import type { InvoiceOcrResult, NormalizedPurchaseOrder } from '@restomatch/types';

const VEG = { name: 'ירקות השרון בע"מ', businessId: '514000001' };
const DAIRY = { name: 'מחלבות הגליל', businessId: '514000002' };

export const SAMPLE_INVOICES: InvoiceOcrResult[] = [
  {
    supplier: VEG,
    invoiceNumber: '1001',
    invoiceDate: '2026-09-01',
    lines: [
      { rawDescription: 'עגבניות', qty: 20, unit: 'ק"ג', unitPrice: 6.5, lineTotal: 130 },
      { rawDescription: 'מלפפונים', qty: 15, unit: 'ק"ג', unitPrice: 5, lineTotal: 75 },
      { rawDescription: 'בצל יבש', qty: 10, unit: 'ק"ג', unitPrice: 4, lineTotal: 40 },
    ],
    totals: { subtotal: 245, vat: 44.1, total: 289.1 },
  },
  {
    supplier: VEG,
    invoiceNumber: '1017',
    invoiceDate: '2026-09-15',
    lines: [
      { rawDescription: 'עגבניות', qty: 20, unit: 'ק"ג', unitPrice: 7.2, lineTotal: 144 },
      { rawDescription: 'מלפפונים', qty: 15, unit: 'ק"ג', unitPrice: 5, lineTotal: 75 },
      { rawDescription: 'בצל יבש', qty: 10, unit: 'ק"ג', unitPrice: 4, lineTotal: 44 },
    ],
    totals: { subtotal: 263, vat: 47.34, total: 310.34 },
  },
  {
    supplier: DAIRY,
    invoiceNumber: '5502',
    invoiceDate: '2026-09-10',
    lines: [
      { rawDescription: 'שמנת מתוקה 32%', qty: 12, unit: 'ליטר', unitPrice: 14.9, lineTotal: 178.8 },
      { rawDescription: 'גבינה צהובה', qty: 5, unit: 'ק"ג', unitPrice: 42, lineTotal: 210 },
    ],
    totals: { subtotal: 388.8, vat: 77.76, total: 466.56 },
  },
  {
    supplier: DAIRY,
    invoiceNumber: '5530',
    invoiceDate: '2026-09-24',
    lines: [
      { rawDescription: 'שמנת מתוקה 32%', qty: 12, unit: 'ליטר', unitPrice: 15.9, lineTotal: 190.8 },
      { rawDescription: 'גבינה צהובה', qty: 5, unit: 'ק"ג', unitPrice: 42, lineTotal: 210 },
    ],
    totals: { subtotal: 400.8, vat: 72.14, total: 472.94 },
  },
];

/** The 5th sample: the same bill #5502 sent again (a different scan of it). */
SAMPLE_INVOICES.push({ ...SAMPLE_INVOICES[2]!, invoiceDate: '2026-09-12' });

export function sampleInvoiceFor(distinctIndex: number): InvoiceOcrResult {
  return SAMPLE_INVOICES[distinctIndex % SAMPLE_INVOICES.length]!;
}

/** Sample price list: tomatoes 6.50, cream 14.90, yellow cheese 40.00. */
export const SAMPLE_PRICE_LIST: NormalizedPurchaseOrder = {
  externalId: 'sample-price-list',
  platform: 'manual',
  supplierExternalId: 'sample',
  supplierName: 'מחירון',
  status: 'confirmed',
  currency: 'ILS',
  lines: [
    { rawDescription: 'עגבניות', qty: 1, unit: 'ק"ג', unitPrice: 6.5 },
    { rawDescription: 'שמנת מתוקה 32%', qty: 1, unit: 'ליטר', unitPrice: 14.9 },
    { rawDescription: 'גבינה צהובה', qty: 1, unit: 'ק"ג', unitPrice: 40 },
  ],
};
