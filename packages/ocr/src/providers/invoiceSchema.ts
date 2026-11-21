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
 *    was changed by hand: a person checks it;
 *  - paymentTermsText / dueDate (G-17) — the payment terms and due date
 *    PRINTED on the paper. Read-only evidence for the "תנאים קצרים מהמוסכם"
 *    flag; they never set invoices.due_date and never carry ₪.
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

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const localDate = z
  .string()
  .optional()
  .transform((v) => (v && LOCAL_DATE.test(v.trim()) ? v.trim() : undefined))
  .catch(undefined);

/**
 * One ת.מ. reference. The number is kept as digits only ("ת.מ. 7781" / 7781 →
 * "7781") — the consolidated matcher only accepts digit strings — and an item
 * the model garbled is dropped alone, never the whole list.
 */
export const DeliveryNoteRef = z.object({
  number: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/\D/g, '')),
  date: localDate,
  /** The note's amount before VAT, when the מרכזת prints one per note. */
  totalExclVat: z.number().finite().optional().catch(undefined),
});
export type DeliveryNoteRef = z.infer<typeof DeliveryNoteRef>;

/** Keep the parseable, non-empty, de-duplicated notes; drop the rest one by one. */
export function cleanDeliveryNotes(raw: unknown): DeliveryNoteRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: DeliveryNoteRef[] = [];
  for (const item of raw) {
    const r = DeliveryNoteRef.safeParse(item);
    if (!r.success || r.data.number === '' || seen.has(r.data.number)) continue;
    seen.add(r.data.number);
    out.push(r.data);
  }
  return out;
}

/** G-17: the raw printed terms string, capped; anything not a string → absent. */
const printedTermsText = z
  .string()
  .max(200)
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined))
  .catch(undefined);

export const InvoiceExtractionV2 = InvoiceOcrResult.extend({
  documentKind: z.enum(DOCUMENT_KINDS).optional().catch('other'),
  buyer: z
    .object({ name: trimmedOrUndefined, businessId: trimmedOrUndefined })
    .optional()
    .catch(undefined),
  /** Delivery notes (ת.מ.) the document lists — a מרכזת lists many, a regular invoice may cite one. */
  deliveryNotes: z.array(DeliveryNoteRef).optional().catch(undefined),
  /** Billing period of a מרכזת (YYYY-MM-DD, as printed); anything else → absent. */
  periodStart: localDate,
  periodEnd: localDate,
  /** Invoice-level discount in ₪ (before VAT), when printed. */
  invoiceDiscount: amount,
  /** G-17: payment terms as printed ("שוטף + 60", "net 45", "מזומן"); absent when not printed. */
  paymentTermsText: printedTermsText,
  /** G-17: the due date as printed, YYYY-MM-DD; anything else → absent (never a guess). */
  dueDate: localDate,
  continuesOnAnotherPage: flag,
  handwrittenCorrection: flag,
  lines: z.array(InvoiceLineV2),
  totals: InvoiceOcrResult.shape.totals.extend({
    /** Printed VAT rate as a fraction (0.18). */
    vatRate: z.number().finite().min(0).max(1).optional().catch(undefined),
  }),
});
export type InvoiceExtractionV2 = z.infer<typeof InvoiceExtractionV2>;
