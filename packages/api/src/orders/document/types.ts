/**
 * The order document a supplier receives (wave-1 flag `orderPricesOut`).
 *
 * One structure, several renderers (email text, compact WhatsApp text, Hebrew
 * RTL PDF). Money is integer agorot end to end; ₪ formatting happens only in
 * the renderers. Other features add lines through `OrderDocumentExtension`
 * (e.g. S11's supplier-confirmation link) without touching the renderers.
 */
export interface OrderDocumentLine {
  description: string;
  sku: string | null;
  /** Quantity as ordered, decimal string (NUMERIC(12,3)), e.g. "2.500". */
  qty: string;
  unit: string;
  /** Agreed unit price in agorot (null = no price agreed for this line). */
  unitPriceAgorot: number | null;
  /** qty × unit price, rounded half-up to the agora (null when unpriced). */
  lineTotalAgorot: number | null;
}

export interface OrderDocument {
  restaurantName: string;
  supplierName: string;
  /** Short human order reference (first 8 hex of the PO id). */
  orderRef: string;
  /** `DD.MM.YYYY` in the restaurant's timezone, or null. */
  deliveryDate: string | null;
  /** `DD.MM.YYYY` the order was placed, restaurant timezone. */
  orderDate: string;
  lines: OrderDocumentLine[];
  /** Sum of priced lines, agorot. */
  totalAgorot: number;
  /** True when at least one line has no agreed price. */
  hasUnpricedLines: boolean;
  /** Per-restaurant setting: false = the supplier sees SKU + qty only. */
  showPrices: boolean;
  notes: string | null;
  /** Lines contributed by extensions, appended after the totals. */
  extraLines: string[];
}

/**
 * Extension point: given the built document, return extra lines to append
 * (text and PDF). Must be pure and synchronous; register in `index.ts`
 * `ORDER_DOCUMENT_EXTENSIONS` or pass per call.
 */
export type OrderDocumentExtension = (doc: Readonly<OrderDocument>) => string[];

/** restaurants.settings.orderDocument (absent = defaults). */
export interface OrderDocumentSettings {
  showPrices?: boolean;
}
