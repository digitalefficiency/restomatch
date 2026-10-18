import { z } from 'zod';

export const Currency = z.enum(['ILS', 'USD', 'EUR']);
export type Currency = z.infer<typeof Currency>;

export const PurchaseOrderLine = z.object({
  externalId: z.string().optional(),
  productHint: z.string().optional(),
  /** Supplier catalog number (מק״ט) as printed on the order, when present. */
  sku: z.string().nullable().optional(),
  rawDescription: z.string(),
  qty: z.number().positive(),
  unit: z.string(),
  unitPrice: z.number().nonnegative().optional(),
  /** Printed line total — used only for the import-time totals checksum. */
  lineTotal: z.number().nonnegative().optional(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

export const NormalizedPurchaseOrder = z.object({
  externalId: z.string(),
  platform: z.enum([
    'marketman',
    'zester',
    'zestt',
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

/* ──────────────────────────────────────────────────────────────────────────
 * Order cadence (Wave 2)
 *
 * The ACTIONABLE order schedule a supplier publishes: which weekdays the
 * restaurant can place an order, the daily cutoff time, and how a placed order
 * maps to a delivery date. This is SEPARATE from the info-only deliverySchedule
 * (free-text time slots) — orderSchedule drives expectedDeliveryAt derivation.
 *
 * Weekday convention matches JS Date#getDay / Intl: 0 = Sunday … 6 = Saturday.
 * cutoff + all day math anchor to the restaurant's timezone, never server-local.
 * ────────────────────────────────────────────────────────────────────────── */

/** A weekday index, Sunday = 0 … Saturday = 6 (JS Date#getDay convention). */
export const Weekday = z.number().int().min(0).max(6);
export type Weekday = z.infer<typeof Weekday>;

/** 24-hour 'HH:MM' wall-clock time, e.g. '14:30'. */
export const CutoffTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: 'cutoff must be HH:MM (00:00–23:59)',
});

/**
 * How a placed order maps to a delivery date:
 *  - lead_days: deliver `leadDays` calendar days after the order day
 *    (0 = same day, 1 = next day, …).
 *  - next_named_day: deliver on the next occurrence of `deliversOnDay`
 *    (a fixed weekday) at or after the order day.
 */
export const OrderFulfillment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lead_days'), leadDays: z.number().int().min(0).max(30) }),
  z.object({ kind: z.literal('next_named_day'), deliversOnDay: Weekday }),
]);
export type OrderFulfillment = z.infer<typeof OrderFulfillment>;

export const OrderWindow = z.object({
  /** Weekdays an order can be placed in this window (0 = Sun … 6 = Sat). */
  orderDays: z.array(Weekday).min(1).max(7),
  /** Daily cutoff time (restaurant-local wall clock) for this window. */
  cutoff: CutoffTime,
  fulfillment: OrderFulfillment,
});
export type OrderWindow = z.infer<typeof OrderWindow>;

export const OrderSchedule = z.object({
  windows: z.array(OrderWindow).min(1).max(14),
  /** Optional IANA tz override; callers default to the restaurant timezone. */
  tz: z.string().min(1).max(64).optional(),
});
export type OrderSchedule = z.infer<typeof OrderSchedule>;

export const Tolerances = z.object({
  pricePercent: z.number().nonnegative().default(0.02),
  priceAbsolute: z.number().nonnegative().default(5),
  qtyPercent: z.number().nonnegative().default(0.03),
  qtyAbsolute: z.number().nonnegative().default(1),
  blockPricePercent: z.number().nonnegative().default(0.1),
});
export type Tolerances = z.infer<typeof Tolerances>;
