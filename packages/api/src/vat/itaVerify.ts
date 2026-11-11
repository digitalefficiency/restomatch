/**
 * AU-08 (A13) · R1 — manual verification at the Tax Authority.
 *
 * The product only checks the allocation number's FORMAT (9 digits). Whether
 * the number was really issued for this invoice can be checked only on the
 * Tax Authority's own service ("אימות פרטי חשבונית"), by hand. This file gives
 * the screen the fields to copy into that form, in the form's order.
 *
 * `ITA_VERIFY_URL` stays `null` until a human (owner or bookkeeper) confirms
 * the exact public URL before merge — never a guessed link. While it is null
 * the UI hides the "open" button and keeps only the copy fields.
 */

/** Human-confirmed link to the Tax Authority invoice-verification service. Pending → null. */
export const ITA_VERIFY_URL: string | null = null;

/** Copy under the button (he). Never claim more than the format check. */
export const ITA_VERIFY_DISCLAIMER_HE = 'בדיקת פורמט בלבד במערכת. אימות שהמספר שייך לחשבונית — רק באתר רשות המסים.';

export type ItaFieldKey = 'allocationNumber' | 'supplierBusinessId' | 'invoiceNumber' | 'invoiceDate' | 'totalExclVat' | 'vatAmount';

export interface ItaField {
  key: ItaFieldKey;
  /** Hebrew label as the Tax Authority form names it. */
  labelHe: string;
  /** Plain, copy-ready value (no ₪ glyph, no thousands separator), or null when unknown. */
  value: string | null;
}

const heDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const plainAmount = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : n.toFixed(2));

/**
 * The six fields, in order: מספר הקצאה, ח״פ ספק, מספר חשבונית, תאריך,
 * סכום לפני מע״מ, מע״מ. An unknown value is `null` (shown as "—"), never "0".
 */
export function itaVerifyFields(
  row: {
    allocationNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string;
    totalExclVat: number;
    vatAmount: number | null;
  },
  supplier: { businessId: string | null } | null,
): ItaField[] {
  const alloc = row.allocationNumber?.replace(/[\s-]/g, '') || null;
  return [
    { key: 'allocationNumber', labelHe: 'מספר הקצאה', value: alloc },
    { key: 'supplierBusinessId', labelHe: 'ח״פ ספק', value: supplier?.businessId?.trim() || null },
    { key: 'invoiceNumber', labelHe: 'מספר חשבונית', value: row.invoiceNumber?.trim() || null },
    { key: 'invoiceDate', labelHe: 'תאריך', value: heDay(row.invoiceDate) },
    { key: 'totalExclVat', labelHe: 'סכום לפני מע״מ', value: plainAmount(row.totalExclVat) },
    { key: 'vatAmount', labelHe: 'מע״מ', value: plainAmount(row.vatAmount) },
  ];
}
