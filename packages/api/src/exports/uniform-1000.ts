/**
 * Israeli uniform tax file (קובץ אחיד) — record type C100 (invoices)
 * minimal subset suitable for accountant ingestion.
 *
 * Reference: רשות המסים, מבנה קבצי דיווח אחידים
 * Spec is fixed-width ASCII; each record is 1 line.
 *
 * This impl covers the most common case: posted purchase invoices.
 * Full export with all record types (C100/B100/etc.) is a separate
 * accounting integration in M9.1.
 */

export interface Uniform1000Invoice {
  /** External invoice number (string). */
  invoiceNumber: string;
  /** ISO date of invoice (YYYY-MM-DD). */
  invoiceDate: string;
  supplierBusinessId: string;
  supplierName: string;
  totalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
}

const RECORD_TYPE_INVOICE = 'C100';

export function toUniform1000Lines(invoices: Uniform1000Invoice[]): string {
  return invoices.map((inv, idx) => formatLine(inv, idx + 1)).join('\n');
}

function formatLine(inv: Uniform1000Invoice, index: number): string {
  // Field layout (fixed-width):
  //   1   record type           4 chars   "C100"
  //   5   running index         9 digits  zero-padded
  //  14   invoice number       20 chars   left-padded space, truncated
  //  34   invoice date          8 digits  YYYYMMDD
  //  42   supplier business id  9 digits  zero-padded
  //  51   supplier name        50 chars   space-padded right, truncated
  // 101   total excl vat       12 chars   integer agorot, zero-padded
  // 113   vat amount           12 chars   integer agorot, zero-padded
  // 125   total incl vat       12 chars   integer agorot, zero-padded
  //
  // Final line length: 136 chars.
  return [
    RECORD_TYPE_INVOICE,
    String(index).padStart(9, '0'),
    inv.invoiceNumber.slice(0, 20).padStart(20, ' '),
    inv.invoiceDate.replace(/-/g, '').slice(0, 8),
    inv.supplierBusinessId.replace(/\D/g, '').slice(0, 9).padStart(9, '0'),
    inv.supplierName.slice(0, 50).padEnd(50, ' '),
    toAgorot(inv.totalExclVat).padStart(12, '0'),
    toAgorot(inv.vatAmount).padStart(12, '0'),
    toAgorot(inv.totalInclVat).padStart(12, '0'),
  ].join('');
}

function toAgorot(ils: number): string {
  return String(Math.round(ils * 100));
}
