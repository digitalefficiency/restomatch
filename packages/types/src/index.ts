import { z } from 'zod';

export const Currency = z.enum(['ILS', 'USD', 'EUR']);
export type Currency = z.infer<typeof Currency>;

export const PurchaseOrderLine = z.object({
  externalId: z.string().optional(),
  productHint: z.string().optional(),
  rawDescription: z.string(),
  qty: z.number().positive(),
  unit: z.string(),
  unitPrice: z.number().nonnegative().optional(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

export const NormalizedPurchaseOrder = z.object({
  externalId: z.string(),
  platform: z.enum([
    'marketman',
    'zester',
    'tabit',
    'yarpa',
    'nash',
    'restigo',
    'restomatch',
    'email',
    'manual',
  ]),
  supplierExternalId: z.string(),
  supplierName: z.string(),
  expectedDeliveryAt: z.string().datetime().optional(),
  status: z.enum(['draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled']),
  currency: Currency.default('ILS'),
  lines: z.array(PurchaseOrderLine),
  totalEstimated: z.number().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type NormalizedPurchaseOrder = z.infer<typeof NormalizedPurchaseOrder>;

export const InvoiceOcrLine = z.object({
  /** Supplier catalog number (מק״ט) as printed on the invoice, when present. */
  sku: z.string().nullable().optional(),
  rawDescription: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  vatRate: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type InvoiceOcrLine = z.infer<typeof InvoiceOcrLine>;

/** A named contact on the invoice (agent, area manager, account manager, driver). */
export const InvoiceContact = z.object({
  /** Role as printed (e.g. "מנהל אזור", "סוכן", "מנהל תיק לקוח", "נהג"). */
  role: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type InvoiceContact = z.infer<typeof InvoiceContact>;

export const InvoiceOcrResult = z.object({
  supplier: z.object({
    name: z.string().optional(),
    businessId: z.string().optional(),
    phone: z.string().nullable().optional(),
    /** Named people on the invoice — used for cross-referencing & change alerts. */
    contacts: z.array(InvoiceContact).optional(),
  }),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  allocationNumber: z.string().nullable().optional(),
  lines: z.array(InvoiceOcrLine),
  totals: z.object({
    subtotal: z.number().optional(),
    vat: z.number().optional(),
    total: z.number().optional(),
  }),
  confidence: z.number().min(0).max(1).optional(),
});
export type InvoiceOcrResult = z.infer<typeof InvoiceOcrResult>;

/**
 * Payload for the 'ocr-invoice' BullMQ job. Shared between the API (producer)
 * and the worker (consumer) so neither needs to depend on the other.
 */
export interface OcrInvoiceJob {
  restaurantId: string;
  invoiceId: string;
  supplierId: string | null;
  imageUrl: string;
  /** When set, the worker bypasses real providers and uses these results. */
  mockProviders?: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult };
}

export const Tolerances = z.object({
  pricePercent: z.number().nonnegative().default(0.02),
  priceAbsolute: z.number().nonnegative().default(5),
  qtyPercent: z.number().nonnegative().default(0.03),
  qtyAbsolute: z.number().nonnegative().default(1),
  blockPricePercent: z.number().nonnegative().default(0.1),
});
export type Tolerances = z.infer<typeof Tolerances>;
