import { computeDueDate, type DateInput, type DueDateSource } from '../lib/dueDate';
import type { HoldReason } from '../routers/payRun';

/**
 * INV-00 · whether an invoice can be paid and by when, in the pay run's own terms, for the
 * invoice screen's payment block (`invoices.detail.payment`, `.allocation`, `.payBy`) and the
 * list rows (`allocationMissing`, `payBy`). Reads only; `routers/payRun.ts` is never edited.
 *
 *  - `payment` is built from the canonical state (`invoices/state.ts`, whose parity with the
 *    pay run is pinned there) and the pay run's own pure `holdReasonsOf()`;
 *  - `allocation.missing` / `allocationMissing` is the pay run's rule, from `vatAtRisk()`: a
 *    malformed number counts as missing; a credit, an invoice being read and a held duplicate
 *    copy are left out. It is NOT `allocationRequired && !hasAllocation`;
 *  - `payBy` is the pay run's own date, `computeDueDate()` (`lib/dueDate.ts`), called with the
 *    invoice's date, the supplier's terms, `invoices.due_date` and the printed due date, as
 *    `payRun.list` calls it. The list row's existing `dueDate` keeps its value (only the date
 *    a person typed).
 */

/** Why the pay run holds an invoice: the kinds of `routers/payRun.ts` HoldReason, in its order. */
export type HoldReasonCode = HoldReason['kind'];

/**
 * `held` · the pay run holds it (`payRun.list` returns a hold: the reasons say why);
 * `payable` · unpaid and nothing holds it;
 * `paid` · marked paid (`invoices.status = 'paid'`, which nothing writes for a real restaurant yet);
 * `reading` · still being read (`in_ocr`): the pay run does not list it yet.
 */
export type PaymentStatus = 'held' | 'payable' | 'paid' | 'reading';

export interface Payment {
  status: PaymentStatus;
  /** Every reason the pay run holds it, in the pay run's order; empty unless `held`. */
  reasons: HoldReasonCode[];
  /** An open gap is the only thing that holds it: deciding the gap releases it for payment. */
  onlyOpenGap: boolean;
}

/** The allocation number (מספר הקצאה) of one invoice. */
export interface Allocation {
  /**
   * Above the allocation threshold in force on its date (the amount before VAT): the same rule
   * as the list row's `allocationRequired`. A narrower rule decides `missing`.
   */
  required: boolean;
  /** The number as stored, trimmed; null when there is none. */
  number: string | null;
  /** The stored number is well-formed (9 digits; a format check only, as `vatAtRisk()` does). */
  valid: boolean;
  /** The pay run holds the invoice for a missing or malformed number (`vatAtRisk()`). */
  missing: boolean;
  /** The VAT that cannot be deducted without it, integer agorot; null unless `missing`. */
  vatAtRiskAgorot: number | null;
}

/** The pay run's date for an invoice, and where it comes from. */
export interface PayBy {
  /** 'YYYY-MM-DD', the restaurant's (Asia/Jerusalem) calendar day. */
  date: string;
  /** A person typed it, the supplier's agreed terms, or the date printed on the invoice. */
  source: Exclude<DueDateSource, 'unknown'>;
}

/**
 * Pure: the pay run's date (`computeDueDate`, called as `payRun.list` calls it), or null when
 * the rule answers `unknown`. A screen prints no remainder when it is null.
 */
export function payByOf(
  invoiceDate: DateInput,
  supplierTerms: string | null | undefined,
  explicitDueDate: DateInput,
  printedDueDate: DateInput,
): PayBy | null {
  const due = computeDueDate(invoiceDate, supplierTerms, explicitDueDate, { printedDueDate: printedDueDate ?? null });
  if (!due.dueDate || due.source === 'unknown') return null;
  return { date: due.dueDate, source: due.source };
}
