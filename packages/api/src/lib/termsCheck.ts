/**
 * G-17 · "תנאים קצרים מהמוסכם" — compare the payment terms PRINTED on the
 * invoice with the terms AGREED with the supplier.
 *
 * Pure: no DB, no clock, no env. Reuses W2-03's one parser
 * (`parsePaymentTerms` / `dueDateFromTerms` / `jerusalemDayKey` in
 * `./dueDate`) — never fork a second one.
 *
 * Rules (G-17 brief §4.2):
 *   - The printed due date is the date stated on the paper when there is one;
 *     otherwise it is computed from the printed terms. When the stated date and
 *     the printed terms disagree, the STATED DATE WINS.
 *   - `shorter` only when that printed due date falls strictly BEFORE the due
 *     date computed from the agreed terms (by more than 0 days).
 *   - `unknown` when either side is missing or unparsed. That is neutral (T4),
 *     never an alarm.
 *
 * Money: this is a flag, never a leak. It carries NO ₪ and must never feed
 * the leak, the hero, a claim or a letter. It also never moves the payment
 * date — the pay run sorts by the AGREED due date (W2-03 §10).
 */
import { type DateInput, dueDateFromTerms, jerusalemDayKey, parsePaymentTerms } from './dueDate';

export type TermsVerdict = 'ok' | 'shorter' | 'unknown';

/** Where the printed due date came from (null when there is none). */
export type PrintedDueSource = 'date' | 'terms' | null;

export interface TermsCheckResult {
  verdict: TermsVerdict;
  /** 'YYYY-MM-DD' Asia/Jerusalem day from the agreed terms, or null. */
  agreedDue: string | null;
  /** 'YYYY-MM-DD' Asia/Jerusalem day from the paper, or null. */
  printedDue: string | null;
  printedSource: PrintedDueSource;
}

/**
 * @param agreedTerms    `suppliers.payment_terms` (free text, agreed)
 * @param invoiceDate    `invoices.invoice_date` (instant) or a 'YYYY-MM-DD' Israeli day
 * @param printedTerms   `ocr_payload.raw.printedTerms` (raw printed string)
 * @param printedDueDate `ocr_payload.raw.printedDueDate` (ISO date when printed)
 */
export function termsCheck(
  agreedTerms: string | null | undefined,
  invoiceDate: DateInput,
  printedTerms: string | null | undefined,
  printedDueDate: DateInput,
): TermsCheckResult {
  const invoiceDay = jerusalemDayKey(invoiceDate);

  const agreedDue = invoiceDay
    ? dueDateFromTerms(invoiceDay, parsePaymentTerms(agreedTerms))
    : null;

  let printedDue = jerusalemDayKey(printedDueDate);
  let printedSource: PrintedDueSource = printedDue ? 'date' : null;
  if (!printedDue && invoiceDay) {
    printedDue = dueDateFromTerms(invoiceDay, parsePaymentTerms(printedTerms));
    if (printedDue) printedSource = 'terms';
  }

  if (!agreedDue || !printedDue) {
    return { verdict: 'unknown', agreedDue, printedDue, printedSource };
  }
  // Day keys are zero-padded 'YYYY-MM-DD', so string order is calendar order.
  const verdict: TermsVerdict = printedDue < agreedDue ? 'shorter' : 'ok';
  return { verdict, agreedDue, printedDue, printedSource };
}
