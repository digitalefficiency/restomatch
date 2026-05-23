/**
 * Helpers to build a `ScanData` payload for InvoiceScanViewer from the
 * different shapes that already exist in the showcase mocks.
 *
 * - `fromAuditRecord` — full invoice (with lines) used by the invoice-audit
 *   detail drawer.
 * - `fromSupplierInvoiceListItem` — header-only invoice from the supplier
 *   profile recent-invoices list. Synthesizes plausible lines from the
 *   supplier's top products so the rendered scan still looks like a real
 *   invoice.
 */

import type { InvoiceAuditRecord, LineComparison } from '../invoices/_mock';
import type {
  PriceTrendProduct,
  SupplierInvoiceListItem,
  SupplierProfile,
} from '../suppliers/[supplierId]/_mock';
import type { ScanData, ScanLine } from './InvoiceScanViewer';

/** Per-supplier brand colour band used at the top of the rendered scan. */
const SUPPLIER_COLORS: Record<string, string> = {
  'sup-avi': '#16a34a', // greens — produce
  'sup-kerem': '#b91c1c', // red — meat
  'sup-kobi': '#0284c7', // blue — fish
  'sup-brans': '#a16207', // amber — bakery
  'sup-shegev': '#7c3aed', // purple — liquor
};

const DEFAULT_COLOR = '#1d4ed8';

const RESTAURANT_NAME = 'מסעדת השיפוד הזהוב';
const RESTAURANT_BUSINESS_ID = '516778421';

const SUPPLIER_BUSINESS_IDS: Record<string, string> = {
  'sup-avi': '514223178',
  'sup-kerem': '513998206',
  'sup-kobi': '514441290',
  'sup-brans': '512887901',
  'sup-shegev': '514779203',
};

export function fromAuditRecord(record: InvoiceAuditRecord): ScanData {
  const lines: ScanLine[] = record.lines
    .filter((l) => l.invoiceQty !== null && l.invoiceUnitPrice !== null)
    .map((l: LineComparison) => ({
      name: l.productName,
      qty: l.invoiceQty!,
      unit: l.unit,
      unitPrice: l.invoiceUnitPrice!,
      // Suggest lower OCR confidence for lines the engine later flagged
      confidence: l.status === 'matched' ? 0.96 : 0.84,
      // If the receiver caught a quantity discrepancy, mock a pen correction
      correction:
        l.receivedQty !== null && l.invoiceQty !== null && l.receivedQty !== l.invoiceQty
          ? {
              value: `→ ${l.receivedQty}`,
              tone: 'red' as const,
            }
          : undefined,
    }));

  return {
    supplierName: record.supplierName,
    supplierInitials: record.supplierInitials,
    supplierBusinessId: SUPPLIER_BUSINESS_IDS[record.supplierId] ?? '000000000',
    supplierColor: SUPPLIER_COLORS[record.supplierId] ?? DEFAULT_COLOR,
    invoiceNumber: record.invoiceNumber,
    invoiceDate: record.scannedAt,
    customerName: RESTAURANT_NAME,
    customerBusinessId: RESTAURANT_BUSINESS_ID,
    lines,
    ocrConfidence: record.discrepanciesCount === 0 ? 0.97 : 0.88,
    capturedBy: `נסרק ע״י ${record.scannedBy}`,
    driverSignature: 'יוסי',
  };
}

/**
 * For supplier-profile rows we don't have line items, so synthesise a
 * realistic mix from the supplier's top products. Keeps the rendered
 * invoice visually convincing without making up data the user can act on.
 */
export function fromSupplierInvoiceListItem(
  invoice: SupplierInvoiceListItem,
  profile: SupplierProfile,
): ScanData {
  const lines = synthesiseLines(invoice.totalIls, profile.topProducts);
  return {
    supplierName: profile.metadata.name,
    supplierInitials: profile.metadata.initials,
    supplierBusinessId: profile.metadata.businessId,
    supplierColor: SUPPLIER_COLORS[profile.metadata.id] ?? DEFAULT_COLOR,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.scannedAt,
    customerName: RESTAURANT_NAME,
    customerBusinessId: RESTAURANT_BUSINESS_ID,
    lines,
    ocrConfidence: invoice.status === 'clean' ? 0.97 : invoice.status === 'minor' ? 0.92 : 0.86,
    capturedBy: 'נסרק מטלפון',
    driverSignature: 'יוסי',
  };
}

/**
 * Distribute the invoice total across the supplier's known top products
 * with plausible quantities. The math is loose on purpose — this is just
 * to fill the rendered scan with believable rows.
 */
function synthesiseLines(totalIls: number, products: PriceTrendProduct[]): ScanLine[] {
  if (products.length === 0) {
    return [
      {
        name: 'פריט כללי',
        qty: 1,
        unit: 'יח׳',
        unitPrice: totalIls / 1.17,
        confidence: 0.9,
      },
    ];
  }

  const subtotalTarget = totalIls / 1.17;
  // Cap at 6 lines so the rendered table stays readable.
  const picks = products.slice(0, Math.min(6, products.length));
  const weights = picks.map((_, i) => 1 / (i + 1));
  const weightSum = weights.reduce((s, w) => s + w, 0);

  return picks.map((product, i) => {
    const share = (subtotalTarget * (weights[i] ?? 0)) / weightSum;
    const qty = Math.max(1, Math.round(share / product.currentPrice));
    return {
      name: product.name,
      qty,
      unit: product.unit,
      unitPrice: product.currentPrice,
      confidence: 0.93 - i * 0.02,
    };
  });
}
