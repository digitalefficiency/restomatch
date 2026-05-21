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
  rawDescription: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  vatRate: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type InvoiceOcrLine = z.infer<typeof InvoiceOcrLine>;

export const InvoiceOcrResult = z.object({
  supplier: z.object({
    name: z.string().optional(),
    businessId: z.string().optional(),
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

export const Tolerances = z.object({
  pricePercent: z.number().nonnegative().default(0.02),
  priceAbsolute: z.number().nonnegative().default(5),
  qtyPercent: z.number().nonnegative().default(0.03),
  qtyAbsolute: z.number().nonnegative().default(1),
  blockPricePercent: z.number().nonnegative().default(0.1),
});
export type Tolerances = z.infer<typeof Tolerances>;
