import type { InvoiceOcrResult } from '@restomatch/types';

/** Both providers produce identical, perfect output. */
export const AGREEMENT_PERFECT: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבי', businessId: '301234561' },
    invoiceNumber: 'INV-1001',
    invoiceDate: '2026-05-21',
    allocationNumber: null,
    lines: [
      { rawDescription: 'עגבניה שרי 1 ק״ג', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80, vatRate: 0.17 },
      { rawDescription: 'מלפפון חממה', qty: 5, unit: 'ק״ג', unitPrice: 6, lineTotal: 30, vatRate: 0.17 },
    ],
    totals: { subtotal: 110, vat: 18.7, total: 128.7 },
    confidence: 0.97,
  },
  claude: {
    supplier: { name: 'ירקני אבי', businessId: '301234561' },
    invoiceNumber: 'INV-1001',
    invoiceDate: '2026-05-21',
    allocationNumber: null,
    lines: [
      { rawDescription: 'עגבניה שרי 1 ק״ג', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80, vatRate: 0.17 },
      { rawDescription: 'מלפפון חממה', qty: 5, unit: 'ק״ג', unitPrice: 6, lineTotal: 30, vatRate: 0.17 },
    ],
    totals: { subtotal: 110, vat: 18.7, total: 128.7 },
    confidence: 0.98,
  },
};

/** Disagreement on a single field (price OCR error). */
export const SINGLE_DISAGREEMENT: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1001',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 3, lineTotal: 30 }, // misread
    ],
    totals: { subtotal: 80, vat: 13.6, total: 93.6 },
  },
  claude: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1001',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    totals: { subtotal: 80, vat: 13.6, total: 93.6 },
  },
};

/** Claude has Hebrew right, Document AI struggles with Hebrew letters. */
export const HEBREW_OCR_NOISE: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבן' }, // wrong: should be אבי
    invoiceNumber: 'INV-1001',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    totals: { subtotal: 80, vat: 13.6, total: 93.6 },
  },
  claude: {
    supplier: { name: 'ירקני אבי' }, // correct
    invoiceNumber: 'INV-1001',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    totals: { subtotal: 80, vat: 13.6, total: 93.6 },
  },
};

/** Document AI sees a line that Claude missed. */
export const MISSING_LINE_IN_CLAUDE: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1002',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
      { rawDescription: 'בצל יבש', qty: 5, unit: 'ק״ג', unitPrice: 4, lineTotal: 20 },
    ],
    totals: { subtotal: 100, vat: 17, total: 117 },
  },
  claude: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1002',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    totals: { subtotal: 100, vat: 17, total: 117 },
  },
};

/** Lines in different order between providers (Dice should still match). */
export const REORDERED_LINES: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1003',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'מלפפון חממה', qty: 5, unit: 'ק״ג', unitPrice: 6, lineTotal: 30 },
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    totals: { subtotal: 110, vat: 18.7, total: 128.7 },
  },
  claude: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1003',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
      { rawDescription: 'מלפפון חממה', qty: 5, unit: 'ק״ג', unitPrice: 6, lineTotal: 30 },
    ],
    totals: { subtotal: 110, vat: 18.7, total: 128.7 },
  },
};

/** Numeric within tolerance (rounding diff). */
export const ROUNDING_DIFF: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1004',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    totals: { subtotal: 80, vat: 13.6, total: 93.6 },
  },
  claude: {
    supplier: { name: 'ירקני אבי' },
    invoiceNumber: 'INV-1004',
    invoiceDate: '2026-05-21',
    lines: [
      { rawDescription: 'עגבניה שרי', qty: 10, unit: 'ק״ג', unitPrice: 8, lineTotal: 80 },
    ],
    // claude rounded differently: 13.605 vs 13.60 — within ±₪0.10
    totals: { subtotal: 80, vat: 13.65, total: 93.65 },
  },
};

/** Empty invoice (no lines). */
export const EMPTY_INVOICE: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } = {
  docAi: {
    supplier: { name: 'ירקני אבי' },
    lines: [],
    totals: {},
  },
  claude: {
    supplier: { name: 'ירקני אבי' },
    lines: [],
    totals: {},
  },
};
