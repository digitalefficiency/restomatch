import type { Tolerances } from '@restomatch/types';
import type {
  GrLineInput,
  InvoiceHeaderInput,
  InvoiceLineInput,
  MatchInput,
  PoLineInput,
} from '../index';

export const DEFAULT_TOLERANCES: Tolerances = {
  pricePercent: 0.02,
  priceAbsolute: 5,
  qtyPercent: 0.03,
  qtyAbsolute: 1,
  blockPricePercent: 0.1,
};

let _idCounter = 0;
export function id(prefix = 'id'): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

export function poLine(overrides: Partial<PoLineInput> = {}): PoLineInput {
  return {
    id: id('po'),
    productId: 'product-1',
    qtyOrdered: 10,
    unit: 'ק״ג',
    unitPriceExpected: 8.0,
    ...overrides,
  };
}

export function grLine(overrides: Partial<GrLineInput> = {}): GrLineInput {
  return {
    id: id('gr'),
    poLineId: null,
    productId: 'product-1',
    qtyReceived: 10,
    ...overrides,
  };
}

export function invoiceLine(overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput {
  return {
    id: id('inv'),
    productId: 'product-1',
    qtyBilled: 10,
    unit: 'ק״ג',
    unitPriceBilled: 8.0,
    lineTotal: 80,
    ...overrides,
  };
}

export function invoiceHeader(overrides: Partial<InvoiceHeaderInput> = {}): InvoiceHeaderInput {
  return {
    invoiceNumber: 'INV-1001',
    invoiceDate: new Date('2026-05-15T10:00:00Z'),
    supplierId: 'supplier-1',
    totalExclVat: 80,
    vatAmount: 13.6,
    totalInclVat: 93.6,
    ...overrides,
  };
}

export function input(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    invoice: invoiceHeader(),
    poLines: [],
    grLines: [],
    invoiceLines: [],
    vatRate: 0.17,
    tolerances: DEFAULT_TOLERANCES,
    ...overrides,
  };
}

/** Build a perfectly-matched single-line scenario as a baseline for tests */
export function happyPath(): MatchInput {
  const po = poLine({ id: 'po-h1', qtyOrdered: 10, unitPriceExpected: 8.0 });
  return input({
    poLines: [po],
    grLines: [grLine({ poLineId: po.id, qtyReceived: 10 })],
    invoiceLines: [
      invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 8.0, lineTotal: 80 }),
    ],
  });
}
