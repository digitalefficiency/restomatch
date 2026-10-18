/**
 * Mock data for the receiver wizard showcase. Production swaps these
 * structures for real tRPC query results — the shapes stay identical.
 */

export interface MockSupplierExpectation {
  supplierId: string;
  supplierName: string;
  /** English display name (Receiver in English demo). */
  supplierNameEn?: string;
  supplierInitials: string;
  expectedAt: string; // ISO
  poIds: string[];
  totalLines: number;
  totalEstimated: number;
  hasActiveReceipt: boolean;
}

export type LineStatus =
  | 'matched'
  | 'qty_diff'
  | 'price_diff'
  | 'unordered'
  | 'missing_from_invoice'
  /** Neutral: not compared yet / couldn't be paired automatically (calm UX). */
  | 'pending_review';

export interface ReconciliationLine {
  invoiceLineIndex: number | null;
  poLineId: string | null;
  productId: string | null;
  /** Supplier catalog number (מק״ט) from the invoice, when extracted. */
  sku?: string | null;
  productName: string;
  /** English display name ("Receiver in English"); Hebrew stays the source. */
  productNameEn?: string | null;
  poQty: number | null;
  poUnit: string | null;
  invoiceQty: number | null;
  invoiceUnit: string | null;
  poUnitPrice: number | null;
  invoiceUnitPrice: number | null;
  status: LineStatus;
  deltaIls: number;
}

export interface ContactChangeAlert {
  role: string;
  name: string | null;
  oldPhone: string;
  newPhone: string;
  /** new primary first, then kept-secondary numbers */
  allNumbers: string[];
}

export interface ReconciliationResult {
  invoiceMeta: {
    invoiceNumber: string;
    invoiceDate: string;
    totalInclVat: number;
    ocrConfidence: number;
    /** No invoice was read (PO-only review): there is no OCR confidence to show. */
    noInvoice?: boolean;
  };
  /** Supplier-contact change alerts (e.g. agent phone changed since last invoice). */
  contactAlerts?: ContactChangeAlert[];
  supplierBusinessId?: string;
  matchedSupplierId: string;
  matchedPoIds: string[];
  lines: ReconciliationLine[];
  summary: {
    matchedCount: number;
    qtyDiffCount: number;
    priceDiffCount: number;
    unorderedCount: number;
    missingCount: number;
    /** Lines waiting for a manual check (never counted as a leak). */
    pendingCount?: number;
    overallConfidence: number;
    headlineDelta: number;
  };
}

export const MOCK_SUPPLIERS: MockSupplierExpectation[] = [
  {
    supplierId: 'sup-avi',
    supplierName: 'ירקני אבי',
    supplierNameEn: "Avi's Greengrocer",
    supplierInitials: 'יא',
    expectedAt: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(),
    poIds: ['po-1234'],
    totalLines: 12,
    totalEstimated: 1284.5,
    hasActiveReceipt: false,
  },
  {
    supplierId: 'sup-kerem',
    supplierName: 'קצביית הכרם',
    supplierNameEn: "HaKerem Butchery",
    supplierInitials: 'קה',
    expectedAt: new Date(new Date().setHours(9, 30, 0, 0)).toISOString(),
    poIds: ['po-1235'],
    totalLines: 8,
    totalEstimated: 3420,
    hasActiveReceipt: false,
  },
  {
    supplierId: 'sup-brans',
    supplierName: 'מאפיית ברנס',
    supplierNameEn: "Brans Bakery",
    supplierInitials: 'מב',
    expectedAt: new Date(new Date().setHours(6, 0, 0, 0)).toISOString(),
    poIds: ['po-1236'],
    totalLines: 4,
    totalEstimated: 240,
    hasActiveReceipt: true,
  },
  {
    supplierId: 'sup-kobi',
    supplierName: 'דגי קובי',
    supplierNameEn: "Kobi's Fish",
    supplierInitials: 'דק',
    expectedAt: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(),
    poIds: ['po-1237'],
    totalLines: 6,
    totalEstimated: 1850,
    hasActiveReceipt: false,
  },
];

/**
 * Build a deterministic mock reconciliation result for a given supplier id.
 * Always returns a realistic mix of statuses so the UI can show all variants.
 */
export function mockReconcile(supplierId: string): ReconciliationResult {
  const presets: Record<string, ReconciliationLine[]> = {
    'sup-avi': [
      {
        invoiceLineIndex: 0,
        poLineId: 'pl-1',
        productId: 'prod-tomato',
        productName: 'עגבניה שרי',
        productNameEn: 'Cherry tomatoes',
        poQty: 10,
        poUnit: 'ק״ג',
        invoiceQty: 12,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 7,
        invoiceUnitPrice: 8.5,
        status: 'price_diff',
        deltaIls: (8.5 - 7) * 12,
      },
      {
        invoiceLineIndex: 1,
        poLineId: 'pl-2',
        productId: 'prod-cucumber',
        productName: 'מלפפון חממה',
        productNameEn: 'Greenhouse cucumber',
        poQty: 5,
        poUnit: 'ק״ג',
        invoiceQty: 5,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 6,
        invoiceUnitPrice: 6,
        status: 'matched',
        deltaIls: 0,
      },
      {
        invoiceLineIndex: 2,
        poLineId: 'pl-3',
        productId: 'prod-pepper',
        productName: 'פלפל אדום',
        productNameEn: 'Red pepper',
        poQty: 3,
        poUnit: 'ק״ג',
        invoiceQty: 2.5,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 12,
        invoiceUnitPrice: 12,
        status: 'qty_diff',
        deltaIls: (3 - 2.5) * 12,
      },
      {
        invoiceLineIndex: 3,
        poLineId: 'pl-4',
        productId: 'prod-lettuce',
        productName: 'חסה אייסברג',
        productNameEn: 'Iceberg lettuce',
        poQty: 4,
        poUnit: 'יח׳',
        invoiceQty: 4,
        invoiceUnit: 'יח׳',
        poUnitPrice: 7.5,
        invoiceUnitPrice: 7.5,
        status: 'matched',
        deltaIls: 0,
      },
      {
        invoiceLineIndex: 4,
        poLineId: null,
        productId: 'prod-mint',
        productName: 'נענע',
        productNameEn: 'Mint',
        poQty: null,
        poUnit: null,
        invoiceQty: 2,
        invoiceUnit: 'יח׳',
        poUnitPrice: null,
        invoiceUnitPrice: 4.5,
        status: 'unordered',
        deltaIls: 2 * 4.5,
      },
      {
        invoiceLineIndex: null,
        poLineId: 'pl-5',
        productId: 'prod-parsley',
        productName: 'פטרוזיליה',
        productNameEn: 'Parsley',
        poQty: 2,
        poUnit: 'יח׳',
        invoiceQty: null,
        invoiceUnit: null,
        poUnitPrice: 3,
        invoiceUnitPrice: null,
        status: 'missing_from_invoice',
        deltaIls: 0,
      },
    ],
    'sup-kerem': [
      {
        invoiceLineIndex: 0,
        poLineId: 'pl-10',
        productId: 'prod-entrecote',
        productName: 'אנטריקוט',
        productNameEn: 'Entrecote',
        poQty: 12,
        poUnit: 'ק״ג',
        invoiceQty: 12,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 145,
        invoiceUnitPrice: 145,
        status: 'matched',
        deltaIls: 0,
      },
      {
        invoiceLineIndex: 1,
        poLineId: 'pl-11',
        productId: 'prod-chicken-breast',
        productName: 'חזה עוף',
        productNameEn: 'Chicken breast',
        poQty: 20,
        poUnit: 'ק״ג',
        invoiceQty: 18,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 38,
        invoiceUnitPrice: 38,
        status: 'qty_diff',
        deltaIls: (20 - 18) * 38,
      },
      {
        invoiceLineIndex: 2,
        poLineId: 'pl-12',
        productId: 'prod-chicken-liver',
        productName: 'כבד עוף',
        productNameEn: 'Chicken liver',
        poQty: 6,
        poUnit: 'ק״ג',
        invoiceQty: 6,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 32,
        invoiceUnitPrice: 32,
        status: 'matched',
        deltaIls: 0,
      },
    ],
    'sup-brans': [
      {
        invoiceLineIndex: 0,
        poLineId: 'pl-20',
        productId: 'prod-garlic-rolls',
        productName: 'לחמניות שום',
        productNameEn: 'Garlic rolls',
        poQty: 30,
        poUnit: 'יח׳',
        invoiceQty: 30,
        invoiceUnit: 'יח׳',
        poUnitPrice: 4,
        invoiceUnitPrice: 4,
        status: 'matched',
        deltaIls: 0,
      },
      {
        invoiceLineIndex: 1,
        poLineId: 'pl-21',
        productId: 'prod-sliced-bread',
        productName: 'לחם פרוס',
        productNameEn: 'Sliced bread',
        poQty: 6,
        poUnit: 'יח׳',
        invoiceQty: 6,
        invoiceUnit: 'יח׳',
        poUnitPrice: 18,
        invoiceUnitPrice: 18,
        status: 'matched',
        deltaIls: 0,
      },
    ],
    'sup-kobi': [
      {
        invoiceLineIndex: 0,
        poLineId: 'pl-30',
        productId: 'prod-salmon',
        productName: 'סלמון נורווגי',
        productNameEn: 'Norwegian salmon',
        poQty: 4,
        poUnit: 'ק״ג',
        invoiceQty: 4,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 195,
        invoiceUnitPrice: 195,
        status: 'qty_diff', // actually arrived 3.2 in real world
        deltaIls: (4 - 3.2) * 195,
      },
      {
        invoiceLineIndex: 1,
        poLineId: 'pl-31',
        productId: 'prod-denis',
        productName: 'דניס',
        productNameEn: 'Sea bream',
        poQty: 5,
        poUnit: 'ק״ג',
        invoiceQty: 5,
        invoiceUnit: 'ק״ג',
        poUnitPrice: 85,
        invoiceUnitPrice: 92,
        status: 'price_diff',
        deltaIls: (92 - 85) * 5,
      },
    ],
  };

  const lines = presets[supplierId] ?? presets['sup-avi']!;
  return buildResult(supplierId, lines);
}

function buildResult(supplierId: string, lines: ReconciliationLine[]): ReconciliationResult {
  const counts = {
    matchedCount: 0,
    qtyDiffCount: 0,
    priceDiffCount: 0,
    unorderedCount: 0,
    missingCount: 0,
  };
  let headlineDelta = 0;
  for (const l of lines) {
    if (l.status === 'matched') counts.matchedCount += 1;
    if (l.status === 'qty_diff') counts.qtyDiffCount += 1;
    if (l.status === 'price_diff') counts.priceDiffCount += 1;
    if (l.status === 'unordered') counts.unorderedCount += 1;
    if (l.status === 'missing_from_invoice') counts.missingCount += 1;
    headlineDelta += l.deltaIls;
  }
  const invoiceTotal = lines.reduce(
    (s, l) => s + (l.invoiceQty ?? 0) * (l.invoiceUnitPrice ?? 0),
    0,
  );
  return {
    invoiceMeta: {
      invoiceNumber: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      totalInclVat: Math.round(invoiceTotal * 1.18 * 100) / 100,
      ocrConfidence: 0.94,
    },
    matchedSupplierId: supplierId,
    matchedPoIds: MOCK_SUPPLIERS.find((s) => s.supplierId === supplierId)?.poIds ?? [],
    lines,
    summary: {
      ...counts,
      overallConfidence: 0.93,
      headlineDelta: Math.round(headlineDelta * 100) / 100,
    },
  };
}
