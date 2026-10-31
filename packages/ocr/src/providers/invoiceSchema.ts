/**
 * Invoice extraction schema v2 (PR-OCR-2) — the canonical InvoiceOcrResult
 * (packages/types, NOT edited here) extended LOCALLY with what a real
 * restaurant's paper needs before a number may become a ₪ leak:
 *
 *  - documentKind — a quote, a delivery note or a credit note is not a tax
 *    invoice to match against (consumers decide; the gate flags the non-invoices);
 *  - buyer — whose invoice this is (a wrong-restaurant scan is caught upstream);
 *  - deliveryNotes / periodStart / periodEnd — a consolidated invoice (מרכזת);
 *  - net unitPrice after a line discount, lineDiscountPct, invoiceDiscount;
 *  - lineKind — deposit (פיקדון) and delivery-fee lines are not products;
 *  - totals.vatRate — the printed VAT rate;
 *  - continuesOnAnotherPage / handwrittenCorrection — the read is partial or
 *    was changed by hand: a person checks it.
 *
 * Everything new is optional with a safe default, so an older model answer still
 * parses. Unknown enum values fall back ('other' / 'item') instead of failing
 * the whole invoice.
 */
import { InvoiceOcrLine, InvoiceOcrResult } from '@restomatch/types';
import { z } from 'zod';

export const DOCUMENT_KINDS = [
  'tax_invoice',
  'tax_invoice_receipt',
  'credit_note',
  'delivery_note',
  'consolidated',
  'receipt',
  'quote',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const LINE_KINDS = ['item', 'deposit', 'delivery_fee'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

const trimmedOrUndefined = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const flag = z.boolean().optional().catch(undefined);
const amount = z.number().finite().optional().catch(undefined);

export const InvoiceLineV2 = InvoiceOcrLine.extend({
  /** English rendering for the receiver ("Receiver in English"), same call. */
  rawDescriptionEn: trimmedOrUndefined,
  /** Line discount in percent (10 = 10%) as printed; unitPrice is already NET of it. */
  lineDiscountPct: z.number().finite().min(0).max(100).optional().catch(undefined),
  lineKind: z.enum(LINE_KINDS).optional().catch('item'),
});
export type InvoiceLineV2 = z.infer<typeof InvoiceLineV2>;

export const InvoiceExtractionV2 = InvoiceOcrResult.extend({
  documentKind: z.enum(DOCUMENT_KINDS).optional().catch('other'),
  buyer: z
    .object({ name: trimmedOrUndefined, businessId: trimmedOrUndefined })
    .optional()
    .catch(undefined),
  deliveryNotes: z
    .array(z.object({ number: z.string(), date: z.string().optional() }))
    .optional()
    .catch(undefined),
  periodStart: z.string().optional().catch(undefined),
  periodEnd: z.string().optional().catch(undefined),
  /** Invoice-level discount in ₪ (before VAT), when printed. */
  invoiceDiscount: amount,
  continuesOnAnotherPage: flag,
  handwrittenCorrection: flag,
  lines: z.array(InvoiceLineV2),
  totals: InvoiceOcrResult.shape.totals.extend({
    /** Printed VAT rate as a fraction (0.18). */
    vatRate: z.number().finite().min(0).max(1).optional().catch(undefined),
  }),
});
export type InvoiceExtractionV2 = z.infer<typeof InvoiceExtractionV2>;
