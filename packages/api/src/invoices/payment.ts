import { AWAITING_QUESTION_SQL } from '@restomatch/charts';
import { sql, type Database, type UserRole } from '@restomatch/db';
import { computeDueDate, type DateInput, type DueDateSource } from '../lib/dueDate';
import { holdReasonsOf, type HoldInputs, type HoldReason, type PayRunStatus } from '../routers/payRun';
import { isValidAllocationNumber, vatAtRisk } from '../vat/vatAtRisk';
import type { InvoiceStateRow } from './state';

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
  /**
   * True exactly when `status` is `held` and `reasons` is `['decision']`: the pay run's decision
   * hold alone, so deciding the open gap releases the invoice for payment. False for a duplicate
   * or a pending-link hold, even when an open gap is behind it (confirming a duplicate keeps the
   * copy held; a decision does not link an invoice).
   */
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
  /**
   * When the number was last asked of the supplier (`vatAtRisk()`'s request state), so no
   * screen asks again for a number already asked for; null when never, or unless `missing`.
   */
  requestedAt: Date | null;
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

// ───────────────────────────────────────────────────────────────────────────────
// Slice 2 · the payment block, from the canonical state and the pay run's own rules.
// ───────────────────────────────────────────────────────────────────────────────

/** The facts the payment block needs beside the canonical state, read once per invoice. */
export interface PaymentFacts {
  invoiceId: string;
  /** `invoices.status` as stored. */
  invStatus: string;
  /** OCR held it for a person (review reasons), not a consolidated invoice waiting for its link. */
  reviewHeld: boolean;
  /** A "זה אותו מוצר?" question holds it (charts AWAITING_QUESTION_SQL, as the pay run reads it). */
  question: boolean;
  supplierTerms: string | null;
  dueDate: Date | null;
  /** `COALESCE(invoice_date, created_at)`: the date the pay run counts the terms from. */
  invoiceAt: Date;
  printedDueDate: string | null;
  allocationNumber: string | null;
  totalExclVat: string | null;
  invoiceDate: Date | null;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const dateOf = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

/** The payment facts of the given invoices (the same columns `payRun.list` reads). Foreign ids are absent. */
export async function loadPaymentFacts(
  db: Database,
  restaurantId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, PaymentFacts>> {
  const out = new Map<string, PaymentFacts>();
  const ids = [...new Set(invoiceIds)];
  for (let at = 0; at < ids.length; at += 500) {
    const chunk = ids.slice(at, at + 500);
    const res = await db.execute(sql`
      SELECT i.id, i.status::text AS inv_status,
             (jsonb_typeof(i.ocr_payload -> 'raw' -> 'reviewReasons') = 'array'
               AND jsonb_array_length(i.ocr_payload -> 'raw' -> 'reviewReasons') > 0
               AND COALESCE(i.ocr_payload -> 'raw' ->> 'kind', '') <> 'consolidated') AS review_held,
             ${AWAITING_QUESTION_SQL} AS question,
             s.payment_terms, i.due_date, COALESCE(i.invoice_date, i.created_at) AS invoice_at,
             i.ocr_payload -> 'raw' ->> 'printedDueDate' AS printed_due_date,
             i.allocation_number, i.total_excl_vat, i.invoice_date
      FROM invoices i
      LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
      WHERE i.restaurant_id = ${restaurantId}
        AND i.id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    for (const r of rowsOf(res)) {
      out.set(String(r.id), {
        invoiceId: String(r.id),
        invStatus: String(r.inv_status),
        reviewHeld: r.review_held === true,
        question: r.question === true,
        supplierTerms: r.payment_terms == null ? null : String(r.payment_terms),
        dueDate: dateOf(r.due_date),
        invoiceAt: dateOf(r.invoice_at) ?? new Date(0),
        printedDueDate: r.printed_due_date == null ? null : String(r.printed_due_date),
        allocationNumber: r.allocation_number == null ? null : String(r.allocation_number),
        totalExclVat: r.total_excl_vat == null ? null : String(r.total_excl_vat),
        invoiceDate: dateOf(r.invoice_date),
      });
    }
  }
  return out;
}

/**
 * Pure: the pay run's hold inputs for one invoice, built from the canonical state's flags
 * (their parity with the pay run is pinned in invoices/state.ts) the way `payRun.list` builds
 * them (`invoiceOfRow`). Only the hold KINDS are read from `holdReasonsOf`, so the amounts and
 * the decision's role and days are left neutral.
 */
export function holdInputsOf(
  state: InvoiceStateRow,
  facts: Pick<PaymentFacts, 'invStatus' | 'reviewHeld' | 'question'>,
  viewerRole: UserRole,
  missingAllocationVatIls: number | null,
): HoldInputs {
  const awaitingCount = state.awaitingCount;
  const awaitingQuestion = !awaitingCount && !state.checked && facts.question;
  const awaitingReview =
    !awaitingCount && !awaitingQuestion && !state.checked && facts.invStatus === 'parsed' && facts.reviewHeld && !state.duplicate;
  const pendingLink = !awaitingCount && !awaitingQuestion && !awaitingReview && state.pendingLink;
  const hold = state.duplicate || pendingLink || awaitingCount || awaitingQuestion || awaitingReview || state.openFinding;
  const status: PayRunStatus = hold ? 'hold' : state.acceptedFinding ? 'claim' : 'pay';
  return {
    status,
    pendingLink,
    awaitingCount,
    awaitingQuestion,
    awaitingReview,
    duplicate: state.duplicate,
    duplicateIls: 0,
    pendingIls: 0,
    totalInclVat: state.totalInclVat,
    openRole: null,
    openDays: null,
    viewerRole,
    missingAllocationVatIls,
    noteBilledTwiceIls: null,
  };
}

/** Pure: the payment block of one invoice (see `Payment`). */
export function paymentOf(
  state: InvoiceStateRow,
  facts: Pick<PaymentFacts, 'invStatus' | 'reviewHeld' | 'question'>,
  viewerRole: UserRole,
  missingAllocationVatIls: number | null,
): Payment {
  if (state.state === 'paid') return { status: 'paid', reasons: [], onlyOpenGap: false };
  if (state.state === 'in_ocr') return { status: 'reading', reasons: [], onlyOpenGap: false };
  const reasons = holdReasonsOf(holdInputsOf(state, facts, viewerRole, missingAllocationVatIls)).map((h) => h.kind);
  return {
    status: reasons.length > 0 ? 'held' : 'payable',
    reasons,
    onlyOpenGap: reasons.length === 1 && reasons[0] === 'decision',
  };
}

/**
 * Each invoice whose VAT is at risk for a missing or malformed allocation number, by the pay
 * run's own call (`vatAtRisk(db, rid, 'all')`, as `payRun.list` makes it: it reads the 2,000
 * newest invoices, a known limit): the VAT at risk in integer agorot and when the number was
 * last asked of the supplier. The pay run holds an unpaid invoice for exactly these; a paid one
 * keeps its flag while its VAT stays at risk (the pay run never lists it).
 */
export async function allocationAtRisk(
  db: Database,
  restaurantId: string,
  opts: { now?: Date } = {},
): Promise<Map<string, { vatAgorot: number; requestedAt: Date | null }>> {
  const res = await vatAtRisk(db, restaurantId, 'all', { now: opts.now });
  return new Map(
    res.rows.map((r) => [
      r.invoiceId,
      { vatAgorot: Math.round(r.vatAtRisk * 100), requestedAt: r.requestedAt ? new Date(r.requestedAt) : null },
    ]),
  );
}

/** Pure: the allocation number of one invoice (see `Allocation`). */
export function allocationOf(
  facts: Pick<PaymentFacts, 'allocationNumber'>,
  required: boolean,
  missingVatAgorot: number | null,
  requestedAt: Date | null,
): Allocation {
  const number = facts.allocationNumber?.trim() ? facts.allocationNumber.trim() : null;
  const missing = missingVatAgorot != null && missingVatAgorot > 0;
  return {
    required,
    number,
    valid: isValidAllocationNumber(number),
    missing,
    vatAtRiskAgorot: missing ? missingVatAgorot : null,
    requestedAt: missing ? requestedAt : null,
  };
}
