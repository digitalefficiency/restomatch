/**
 * PILOT (W2-02 #222): the review-reason codes S13's pipeline writes on a HELD
 * invoice (`ocr_payload.raw.reviewReasons`, #224), mapped to the copy keys of the
 * 'invoices' namespace (`needsLines.held.*`). Read loosely: `doc_kind_<kind>`
 * collapses to one key, an unknown code reads "ממתינה לבדיקה". Link codes never
 * reach here (the API drops them: G-08's flow).
 */
export const HOLD_REASON_KEYS = [
  'supplier_id_mismatch',
  'consolidated',
  'consolidated_unknown_supplier',
  'consolidated_evidence',
  'doc_kind',
  'unknown',
] as const;
export type HoldReasonKey = (typeof HOLD_REASON_KEYS)[number];

export function holdReasonKey(code: string): HoldReasonKey {
  if (code.startsWith('doc_kind_')) return 'doc_kind';
  return (HOLD_REASON_KEYS as readonly string[]).includes(code) && code !== 'doc_kind' && code !== 'unknown'
    ? (code as HoldReasonKey)
    : 'unknown';
}

/** One key per distinct reason, in order (two doc_kind_* codes → one chip). */
export function holdReasonKeys(codes: readonly string[]): HoldReasonKey[] {
  const out: HoldReasonKey[] = [];
  for (const c of codes) {
    const k = holdReasonKey(c);
    if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : ['unknown'];
}
