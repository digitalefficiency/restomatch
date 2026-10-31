/**
 * "ממתין להחלטה שלך" — the approvals page is the single source of truth (orchestrator
 * decision, wave 1): the home row is approvals.queueSummary, mapped. Its ₪ is the
 * lib/claims rule before VAT (the "ניתן לדרוש מהספקים" tile); a no-PO arrival or a
 * missing-on-invoice row is "לבדיקה (ללא ₪)" (a count), and a duplicate (incl. VAT)
 * or a VAT mismatch is a separate muted item — never added into the one number.
 */

export interface QueueSummaryLike {
  count: number;
  blockers: number;
  duplicateIls: number;
  vatIls: number;
  toDecide: { count: number; amountIls: number };
  toReview: { count: number };
}

export interface DecideNeed {
  count: number;
  /** = approvals "ניתן לדרוש מהספקים" (claimableIls, before VAT). */
  amountIls: number;
  blocking: number;
  toReview: number;
  duplicateIls: number;
  vatIls: number;
}

export function decideNeed(s: QueueSummaryLike): DecideNeed {
  return {
    count: s.count,
    amountIls: s.toDecide.amountIls,
    blocking: s.blockers,
    toReview: s.toReview.count,
    duplicateIls: s.duplicateIls,
    vatIls: s.vatIls,
  };
}
