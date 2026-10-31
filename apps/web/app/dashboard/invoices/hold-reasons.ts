/**
 * PILOT (W2-02 #222): the review-reason codes on a HELD invoice
 * (`ocr_payload.raw.reviewReasons`: S13 #224, #174's OcrCheckReason, the
 * pipeline's own), grouped into the copy keys of the 'invoices' namespace
 * (`needsLines.held.*`). Read loosely; an unknown code reads "ממתינה לבדיקה".
 * Link codes and the 'consolidated' marker never reach here (the API drops them).
 */
export const HOLD_REASON_KEYS = [
  'supplier_id_mismatch',
  'supplier_id_invalid',
  'consolidated_unknown_supplier',
  'consolidated_evidence',
  'math',
  'missing',
  'confidence',
  'low_lines',
  'doc_kind_delivery_note',
  'doc_kind_credit_note',
  'doc_kind_receipt',
  'doc_kind_quote',
  'doc_kind',
  'unknown',
] as const;
export type HoldReasonKey = (typeof HOLD_REASON_KEYS)[number];

const DIRECT: Record<string, HoldReasonKey> = {
  supplier_id_mismatch: 'supplier_id_mismatch',
  supplier_id_invalid: 'supplier_id_invalid',
  consolidated_unknown_supplier: 'consolidated_unknown_supplier',
  consolidated_evidence: 'consolidated_evidence',
  line_math_mismatch: 'math',
  subtotal_mismatch: 'math',
  vat_mismatch: 'math',
  total_mismatch: 'math',
  confidence: 'confidence',
  lowLines: 'low_lines',
  low_lines: 'low_lines',
  document_kind_not_invoice: 'doc_kind',
  doc_kind_delivery_note: 'doc_kind_delivery_note',
  doc_kind_credit_note: 'doc_kind_credit_note',
  doc_kind_receipt: 'doc_kind_receipt',
  doc_kind_quote: 'doc_kind_quote',
};

export function holdReasonKey(code: string): HoldReasonKey {
  const direct = DIRECT[code];
  if (direct) return direct;
  if (code.startsWith('missing_')) return 'missing';
  if (code.startsWith('doc_kind_')) return 'doc_kind';
  return 'unknown';
}

/** One key per distinct reason, in order (two math codes → one chip). Empty in → empty out. */
export function holdReasonKeys(codes: readonly string[]): HoldReasonKey[] {
  const out: HoldReasonKey[] = [];
  for (const c of codes) {
    const k = holdReasonKey(c);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
