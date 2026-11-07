import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  computeLeakBreakdown,
  computeLeakHero,
  scanAwaitingCountSql,
  type LeakBreakdownInvoice,
} from '@restomatch/charts';
import { eq, restaurants, sql, type Database, type UserRole } from '@restomatch/db';
import { NEVER_CLAIMABLE_TYPES, claimableLines, sumClaims, type VatBasis } from '../lib/claims';
import {
  computeDueDate,
  dueBucket,
  jerusalemDayKey,
  parsePaymentTerms,
  dueDateFromTerms,
  daysBetween as daysFrom,
  type DueBucket,
  type DueDateSource,
} from '../lib/dueDate';
import { featureEnabled } from '../lib/features';
import { canActOn } from '../lib/roles';
import { vatAtRisk } from '../vat/vatAtRisk';

/** 'YYYY-MM-DD' ± n calendar days (pure calendar counting). */
function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
import { financeProcedure, router } from '../trpc';

/** Never a credit to ask for: the never-claimable types (owner 31.10) + a duplicate copy (held, not claimed). */
const NOT_A_CREDIT_SQL = sql.join(
  [...NEVER_CLAIMABLE_TYPES, 'DUPLICATE_INVOICE'].map((t) => sql`${t}`),
  sql`, `,
);

/**
 * Pay run (flag `payRun`): the month's checked invoices that are not marked
 * paid, grouped by supplier, each with one calm status for the person who pays:
 *
 *  • 'pay'   — no open / escalated finding that counts as leak;
 *  • 'hold'  — an open or escalated finding waits for a decision (or the invoice
 *              still waits for its PO link);
 *  • 'claim' — only accepted claims remain: ask the supplier for a credit of the
 *              accepted ₪ (the SAME capped per-invoice rule as the credit letters,
 *              lib/claims.ts).
 *
 * "Not paid" is `invoices.status <> 'paid'` — the app has no payment rail; the
 * UI says "not marked as paid". No new leak math: the month bounds and the
 * per-invoice capped leak come from computeLeakHero / computeLeakBreakdown.
 * Finance roles only (owner / manager / bookkeeper), like the leak drill-down.
 */

export type PayRunStatus = 'pay' | 'hold' | 'claim';

export interface PayRunClaim {
  discrepancyId: string;
  type: string;
  resolutionStatus: string;
  amount: number;
  basis: VatBasis;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
}

export interface PayRunInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  status: PayRunStatus;
  /** The invoice still waits for its PO link (a consolidated invoice): held, calmly. */
  pendingLink: boolean;
  /**
   * A receiving scan waiting for its receipt's count (#94): held until the count
   * is in — bound to its order already, so never "waiting to be linked".
   */
  awaitingCount: boolean;
  /** A (non-waived) duplicate copy: held — "don't pay this copy", never a credit to ask for. */
  duplicate: boolean;
  /** The claimable ₪ of the duplicate finding(s) (= the copy's total incl. VAT); not in pending / credit. */
  duplicateIls: number;
  totalInclVat: number;
  totalExclVat: number;
  /** Open / escalated claimable ₪ (waits for a decision). */
  pendingIls: number;
  /** Accepted claimable ₪ — the credit to ask for. */
  creditIls: number;
  /** Claimable lines (open, escalated, accepted), capped exactly like the letters. */
  claims: PayRunClaim[];
}

export interface PayRunSupplier {
  key: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoices: PayRunInvoice[];
  /** Σ invoice totals incl. VAT per status. */
  payIls: number;
  holdIls: number;
  claimIls: number;
  /** Σ accepted credit ₪ (letters' basis per line, see PayRunClaim.basis). */
  creditIls: number;
  /** Σ open/escalated claimable ₪. */
  pendingIls: number;
  /** Σ totals incl. VAT of invoices waiting for their PO link (T4; not in pay / hold). */
  linkIls: number;
}

export interface PayRunResult {
  enabled: boolean;
  monthStart: string | null;
  monthEnd: string | null;
  suppliers: PayRunSupplier[];
  totals: {
    invoices: number;
    payIls: number;
    holdIls: number;
    claimIls: number;
    creditIls: number;
    pendingIls: number;
    /** Invoices waiting for their PO link (T4), and their totals incl. VAT. */
    linkIls: number;
    linkCount: number;
  };
}

const OPEN = new Set(['open', 'escalated']);
const CLAIMABLE_DUP = new Set(['open', 'escalated', 'accepted']);
const ag = (v: number) => Math.round(v * 100);
const ils = (a: number) => a / 100;
const EMPTY_TOTALS = { invoices: 0, payIls: 0, holdIls: 0, claimIls: 0, creditIls: 0, pendingIls: 0, linkIls: 0, linkCount: 0 };

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Pure: one invoice's pay-run status from its breakdown entry (null = no finding at all). */
export function payRunStatusOf(b: LeakBreakdownInvoice | null): {
  status: PayRunStatus;
  duplicate: boolean;
  duplicateIls: number;
  claims: PayRunClaim[];
  pendingIls: number;
  creditIls: number;
} {
  if (!b) return { status: 'pay', duplicate: false, duplicateIls: 0, claims: [], pendingIls: 0, creditIls: 0 };
  const lines = claimableLines(b);
  const claims = lines.map(({ line, amount, basis }) => ({
    discrepancyId: line.discrepancyId,
    type: line.type,
    resolutionStatus: line.resolutionStatus,
    amount,
    basis,
    productName: line.productName,
    productNameEn: line.productNameEn,
    lineDescription: line.lineDescription,
    lineDescriptionEn: line.lineDescriptionEn,
  }));
  // An unpaid duplicate copy is not a credit to ask for: the action is "don't pay this copy".
  // Its ₪ (the copy's total incl. VAT) stays out of pending / credit and out of the pay total.
  const isDup = (c: { type: string }) => c.type === 'DUPLICATE_INVOICE';
  const duplicate = b.lines.some((l) => l.countsAsLeak && isDup(l) && CLAIMABLE_DUP.has(l.resolutionStatus));
  const duplicateIls = sumClaims(claims.filter(isDup));
  const rest = claims.filter((c) => !isDup(c));
  const pendingIls = sumClaims(rest.filter((c) => OPEN.has(c.resolutionStatus)));
  const creditIls = sumClaims(rest.filter((c) => !OPEN.has(c.resolutionStatus)));
  // An open / escalated leak finding holds the invoice, even one whose ₪ the cap already used up —
  // but, like the claimable rule, only a real one: a ₪0 line (the engine's QTY_SHORT "twin" of a
  // billed QTY_OVER) or a non-leak line never keeps an invoice on hold.
  const waiting =
    duplicate ||
    b.pendingLink ||
    b.lines.some((l) => l.countsAsLeak && OPEN.has(l.resolutionStatus) && Math.abs(l.deltaAmount) > 0);
  const status: PayRunStatus = waiting ? 'hold' : creditIls > 0 ? 'claim' : 'pay';
  return { status, duplicate, duplicateIls, claims, pendingIls, creditIls };
}

/** The unpaid, read invoices of `rid` (optionally inside an invoice-month window) with every pay-run input. */
function unpaidInvoicesSql(rid: string, window: { start: string; end: string } | null) {
  const windowSql = window
    ? sql`AND COALESCE(i.invoice_date, i.created_at) >= ${window.start}::timestamptz
          AND COALESCE(i.invoice_date, i.created_at) < ${window.end}::timestamptz`
    : sql``;
  return sql`
        SELECT i.id, i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS at,
               COALESCE(i.total_incl_vat, 0) AS total_incl, COALESCE(i.total_excl_vat, 0) AS total_excl,
               i.supplier_id, s.name AS supplier_name, s.name_en AS supplier_name_en,
               -- Safety net for an invoice past the breakdown's 200-row window: any open
               -- warn/block finding still holds it (never shown as payable by omission).
               EXISTS (
                 SELECT 1 FROM match_runs mr2
                 JOIN discrepancies d ON d.match_run_id = mr2.id AND d.restaurant_id = ${rid}
                 WHERE mr2.invoice_id = i.id AND mr2.restaurant_id = ${rid}
                   AND d.severity IN ('warn','block') AND d.resolution_status IN ('open','escalated')
                   AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL') AND ABS(d.delta_amount) > 0
               ) AS has_open,
               -- …and accepted real findings still ask for a credit (Σ |Δ|, capped at the
               -- invoice total like the hero's per-invoice cap), never "can pay".
               (
                 SELECT LEAST(COALESCE(SUM(ABS(d.delta_amount)), 0), COALESCE(i.total_incl_vat, 0))
                 FROM match_runs mr3
                 JOIN discrepancies d ON d.match_run_id = mr3.id AND d.restaurant_id = ${rid}
                 WHERE mr3.invoice_id = i.id AND mr3.restaurant_id = ${rid}
                   AND d.severity IN ('warn','block') AND d.resolution_status IN ('accepted','resolved')
                   AND d.type NOT IN (${NOT_A_CREDIT_SQL}) AND ABS(d.delta_amount) > 0
               ) AS accepted_ils,
               -- …a non-waived duplicate copy is held ("don't pay this copy"); its ₪ is the copy's total.
               (
                 SELECT LEAST(COALESCE(SUM(ABS(d.delta_amount)), 0), COALESCE(i.total_incl_vat, 0))
                 FROM match_runs mr4
                 JOIN discrepancies d ON d.match_run_id = mr4.id AND d.restaurant_id = ${rid}
                 WHERE mr4.invoice_id = i.id AND mr4.restaurant_id = ${rid}
                   AND d.type = 'DUPLICATE_INVOICE' AND d.severity IN ('warn','block')
                   AND d.resolution_status IN ('open','escalated','accepted')
               ) AS dup_ils,
               EXISTS (
                 SELECT 1 FROM match_runs mr5
                 JOIN discrepancies d ON d.match_run_id = mr5.id AND d.restaurant_id = ${rid}
                 WHERE mr5.invoice_id = i.id AND mr5.restaurant_id = ${rid}
                   AND d.type = 'DUPLICATE_INVOICE' AND d.severity IN ('warn','block')
                   AND d.resolution_status IN ('open','escalated','accepted')
               ) AS has_dup,
               -- …and an open unordered arrival means the invoice still waits for its PO link.
               EXISTS (
                 SELECT 1 FROM match_runs mr6
                 JOIN discrepancies d ON d.match_run_id = mr6.id AND d.restaurant_id = ${rid}
                 WHERE mr6.invoice_id = i.id AND mr6.restaurant_id = ${rid}
                   AND d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')
               ) AS has_ua,
               EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = i.id AND mr.restaurant_id = ${rid}) AS matched,
               -- …a receiving scan the OCR held for its receipt's count (#94, same rule as the hero).
               ${scanAwaitingCountSql(rid, sql`i`)} AS counting,
               -- W2-03: due-date inputs (agreed terms, human due date, G-17 printed values).
               s.payment_terms, i.due_date,
               i.ocr_payload -> 'raw' ->> 'printedDueDate' AS printed_due_date,
               i.ocr_payload -> 'raw' ->> 'printedTerms' AS printed_terms,
               -- …and who the oldest open real finding waits for, since when.
               (
                 SELECT d.requires_role::text FROM match_runs mr7
                 JOIN discrepancies d ON d.match_run_id = mr7.id AND d.restaurant_id = ${rid}
                 WHERE mr7.invoice_id = i.id AND mr7.restaurant_id = ${rid}
                   AND d.severity IN ('warn','block') AND d.resolution_status IN ('open','escalated')
                   AND ABS(COALESCE(d.delta_amount, 0)) > 0
                 ORDER BY d.created_at, d.id LIMIT 1
               ) AS open_role,
               (
                 SELECT MIN(d.created_at) FROM match_runs mr8
                 JOIN discrepancies d ON d.match_run_id = mr8.id AND d.restaurant_id = ${rid}
                 WHERE mr8.invoice_id = i.id AND mr8.restaurant_id = ${rid}
                   AND d.severity IN ('warn','block') AND d.resolution_status IN ('open','escalated')
                   AND ABS(COALESCE(d.delta_amount, 0)) > 0
               ) AS open_since
        FROM invoices i
        LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${rid}
        WHERE i.restaurant_id = ${rid}
          AND i.status <> 'paid'
          ${windowSql}
          -- Checked invoices, plus the read-but-unmatched ones (consolidated invoices waiting
          -- for their PO link, shown as T4 "waiting to be linked"); not invoices still in OCR.
          AND i.status <> 'ocr_pending'
        ORDER BY at DESC, i.invoice_number
  `;
}

/** One SQL row (+ its breakdown entry, if any) → its pay-run invoice. Shared by `month` and `list`. */
function invoiceOfRow(row: Row, b: LeakBreakdownInvoice | null): PayRunInvoice {
  const s = payRunStatusOf(b);
  // Past the breakdown's 200-row window (known limit, not reached by the demo): an open
  // real finding still holds the invoice; an unmatched one waits for its link.
  if (!b && row.has_open === true) s.status = 'hold';
  if (!b && Number(row.accepted_ils ?? 0) > 0) {
    s.creditIls = Math.round(Number(row.accepted_ils) * 100) / 100;
    if (s.status === 'pay') s.status = 'claim';
  }
  if (!b && row.has_dup === true) {
    s.duplicate = true;
    s.duplicateIls = Math.round(Number(row.dup_ils ?? 0) * 100) / 100;
    s.status = 'hold';
  }
  // Waiting for the count (#94): no run yet, but bound to its order — held, not T4.
  const awaitingCount = row.matched !== true && row.counting === true;
  const pendingLink =
    !awaitingCount &&
    ((b?.pendingLink ?? false) || row.matched !== true || (!b && row.has_ua === true));
  if (pendingLink || awaitingCount) s.status = 'hold';
  return {
    invoiceId: String(row.id),
    invoiceNumber: row.invoice_number == null ? null : String(row.invoice_number),
    invoiceDate: iso(row.at),
    status: s.status,
    pendingLink,
    awaitingCount,
    duplicate: s.duplicate,
    duplicateIls: s.duplicateIls,
    totalInclVat: Number(row.total_incl),
    totalExclVat: Number(row.total_excl),
    pendingIls: s.pendingIls,
    creditIls: s.creditIls,
    claims: s.claims,
  };
}

async function flagOn(db: Database, rid: string): Promise<boolean> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, rid))
    .limit(1);
  return featureEnabled(r?.settings ?? {}, 'payRun');
}

// ─────────────────────────────────────────────────────────────────────────────
// W2-03 · the due-date desk: all unpaid checked invoices, bucketed by due date.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server flag for "סמן כשולם": OFF until H-03 (`invoices.paid_at/paid_amount/
 * payment_method/payment_ref`) is deployed and G-05's `mark_paid` transition is on
 * the base (owner: ON after the Tue 1.12 deploy, with a signed before/after).
 */
export function markPaidEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.PAY_RUN_MARK_PAID ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/**
 * G-17's `termsCheck(agreedTerms, invoiceDate, printedTerms, printedDueDate)` result.
 * INTERIM (TODO(G-17)): a local stub with G-17's signature, on the ONE parser in
 * lib/dueDate. Swap the import for `lib/termsCheck` when G-17 lands; delete this.
 */
export interface TermsCheckResult {
  verdict: 'ok' | 'shorter' | 'unknown';
  /** The due day from the agreed supplier terms. */
  agreedDue: string | null;
  /** The due day the paper states (printed date, else printed terms). */
  printedDue: string | null;
  printedSource: 'date' | 'terms' | null;
}
export function termsCheckStub(
  agreedTerms: string | null | undefined,
  invoiceDate: Date | string | null | undefined,
  printedTerms: string | null | undefined,
  printedDueDate: Date | string | null | undefined,
): TermsCheckResult {
  const invDay = jerusalemDayKey(invoiceDate);
  const agreedDue = invDay ? dueDateFromTerms(invDay, parsePaymentTerms(agreedTerms)) : null;
  // A printed date wins over printed terms when the two disagree (G-17 §5).
  const fromDate = jerusalemDayKey(printedDueDate);
  const fromTerms = invDay ? dueDateFromTerms(invDay, parsePaymentTerms(printedTerms)) : null;
  const printedDue = fromDate ?? fromTerms;
  const printedSource = fromDate ? 'date' : fromTerms ? 'terms' : null;
  if (!agreedDue || !printedDue) return { verdict: 'unknown', agreedDue, printedDue, printedSource };
  return { verdict: printedDue < agreedDue ? 'shorter' : 'ok', agreedDue, printedDue, printedSource };
}

/** Why a row can't be paid now — each one is shown as text, never only as a colour. */
export type HoldReason =
  | {
      kind: 'decision';
      /** Who decides (the oldest open finding's routed role; null = owner / manager). */
      waitingFor: UserRole | null;
      /** Whole Israeli days the oldest open finding has waited. */
      days: number;
      /** ₪ in dispute (open / escalated claimable) out of the invoice total. */
      disputeIls: number;
      ofIls: number;
      /** The viewer may decide it ("החליטו"); else "שלחו תזכורת". */
      canAct: boolean;
    }
  | { kind: 'duplicate'; ils: number }
  | { kind: 'pending_link' }
  | { kind: 'awaiting_count' }
  | { kind: 'missing_allocation'; vatIls: number }
  /** G-04 consolidated flag: the same delivery note billed twice; ₪ = the overlap. */
  | { kind: 'note_billed_twice'; ils: number };

export interface HoldInputs {
  status: PayRunStatus;
  pendingLink: boolean;
  awaitingCount: boolean;
  duplicate: boolean;
  duplicateIls: number;
  pendingIls: number;
  totalInclVat: number;
  openRole: UserRole | null;
  openDays: number | null;
  viewerRole: UserRole;
  /** VAT at risk when the allocation number is missing / malformed (vatAtRisk()). */
  missingAllocationVatIls: number | null;
  /** G-04 `note_billed_twice` overlap ₪ (null until G-04's addendum is on the base). */
  noteBilledTwiceIls: number | null;
}

/** Pure: the hold reasons of one unpaid row (empty = payable). */
export function holdReasonsOf(h: HoldInputs): HoldReason[] {
  const out: HoldReason[] = [];
  if (h.duplicate) out.push({ kind: 'duplicate', ils: h.duplicateIls });
  if (h.pendingLink) out.push({ kind: 'pending_link' });
  if (h.awaitingCount) out.push({ kind: 'awaiting_count' });
  if (h.noteBilledTwiceIls != null && h.noteBilledTwiceIls > 0) {
    out.push({ kind: 'note_billed_twice', ils: h.noteBilledTwiceIls });
  }
  if (h.status === 'hold' && !h.duplicate && !h.pendingLink && !h.awaitingCount) {
    out.push({
      kind: 'decision',
      waitingFor: h.openRole,
      days: Math.max(0, h.openDays ?? 0),
      disputeIls: h.pendingIls,
      ofIls: h.totalInclVat,
      canAct: canActOn(h.viewerRole, h.openRole),
    });
  }
  if (h.missingAllocationVatIls != null && h.missingAllocationVatIls > 0) {
    out.push({ kind: 'missing_allocation', vatIls: h.missingAllocationVatIls });
  }
  return out;
}

export interface PayRunRow extends PayRunInvoice {
  supplierKey: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  /** 'YYYY-MM-DD' Israeli day (computeDueDate), or null = "אין תנאי תשלום · הגדירו". */
  dueDate: string | null;
  dueSource: DueDateSource;
  bucket: DueBucket;
  /** Whole days from today to the due day (negative = overdue). */
  daysToDue: number | null;
  /** The supplier's agreed terms exceed the Payment-Delays law ceiling ("מעבר לתקרת החוק"). */
  exceedsLawLimit: boolean;
  /** G-17 "תנאים קצרים מהמוסכם" (warn chip; never ₪). */
  termsCheck: TermsCheckResult;
  holds: HoldReason[];
  /** Can go into a mark-paid batch: no hold of any kind. */
  selectable: boolean;
}

export interface PayRunListResult {
  enabled: boolean;
  /** Israeli day the buckets were computed for. */
  today: string;
  /** Set when the "לפי חודש חשבונית" filter (`?m=`) is on. */
  monthStart: string | null;
  monthEnd: string | null;
  /** Due date ascending (unknown last). */
  rows: PayRunRow[];
  buckets: Record<DueBucket, { count: number; ils: number }>;
  totals: {
    invoices: number;
    /** Σ totals incl. VAT of selectable rows. */
    payableIls: number;
    payableCount: number;
    heldIls: number;
    heldCount: number;
    /** Σ ₪ in dispute on held rows. */
    disputeIls: number;
    /** Σ accepted credit ₪ (to offset before payment, decision 19). */
    creditIls: number;
  };
  /** The server flag; the UI shows "סמן כשולם" only when on. */
  markPaidEnabled: boolean;
}

const BUCKETS: DueBucket[] = ['overdue', 'this_week', 'next_week', 'later', 'unknown'];

/** Pure: sort due date ascending, unknown last, then invoice date, then number. */
export function sortByDue(a: PayRunRow, b: PayRunRow): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return (
    a.invoiceDate.localeCompare(b.invoiceDate) ||
    (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? '')
  );
}

const ITEM = z.object({
  invoiceId: z.string().uuid(),
  /** The status the client saw; a stale one is a CONFLICT (G-05 `expectedFrom`). */
  expectedStatus: z.enum(['ocr_pending', 'parsed', 'matched', 'disputed', 'approved', 'paid']),
});
const MARK_PAID_INPUT = z.object({
  items: z.array(ITEM).min(1).max(200),
  /** 'YYYY-MM-DD' Israeli day the payment went out. */
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['bank_transfer', 'check', 'cash', 'credit_card', 'other']),
  reference: z.string().trim().max(120).optional(),
  clientMutationId: z.string().min(8).max(80),
});
const UNMARK_PAID_INPUT = z.object({
  items: z.array(ITEM).min(1).max(200),
  /**
   * Owner decision I7 (7.11): a paid invoice is locked; reopening it (G-05 `unmark`, paid →
   * approved) REQUIRES a reason ("סיבה (חובה)"). Passed through to G-05, which enforces it.
   */
  reason: z.string().trim().min(3).max(300),
  clientMutationId: z.string().min(8).max(80),
});

/**
 * Every item must be one of the caller's invoices. A foreign or unknown id is
 * NOT_FOUND for the whole batch (all-or-nothing) — never a hint that it exists.
 */
async function assertOwnInvoices(
  db: Database,
  rid: string,
  ids: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  const res = await db.execute(sql`
    SELECT i.id, i.status FROM invoices i
    WHERE i.restaurant_id = ${rid} AND i.id IN (${sql.join(
      uniq.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  const found = new Map(rowsOf(res).map((r) => [String(r.id), String(r.status)]));
  if (found.size !== uniq.length)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'payRun.invoiceNotFound' });
  return found;
}

/**
 * Pure: the per-item refusal before a mark-paid write (null = may proceed).
 *  • stale `expectedStatus` → CONFLICT (no write, no audit row);
 *  • until G-14: a capped leak > 0 → PRECONDITION_FAILED `{reason: 'open_leak', ils}`
 *    ("יש פערים בחשבונית · החליטו לפני סימון כשולם").
 */
export function markPaidRefusal(
  item: { expectedStatus: string },
  current: { status: string; cappedLeakIls: number },
):
  | { code: 'CONFLICT'; status: string }
  | { code: 'PRECONDITION_FAILED'; reason: 'open_leak'; ils: number }
  | null {
  if (current.status !== item.expectedStatus) return { code: 'CONFLICT', status: current.status };
  if (current.status === 'paid') return { code: 'CONFLICT', status: current.status };
  if (current.cappedLeakIls > 0)
    return { code: 'PRECONDITION_FAILED', reason: 'open_leak', ils: current.cappedLeakIls };
  return null;
}

export const payRunRouter = router({
  /** Cheap: is the pay run on for the active restaurant (the approvals page links to it)? */
  enabled: financeProcedure.query(async ({ ctx }) => flagOn(ctx.db, ctx.session.restaurantId)),

  month: financeProcedure
    .input(z.object({ monthOffset: z.union([z.literal(0), z.literal(-1)]).default(0) }).optional())
    .query(async ({ ctx, input }): Promise<PayRunResult> => {
      const rid = ctx.session.restaurantId;
      if (!(await flagOn(ctx.db, rid))) {
        return {
          enabled: false,
          monthStart: null,
          monthEnd: null,
          suppliers: [],
          totals: EMPTY_TOTALS,
        };
      }
      const monthOffset = input?.monthOffset ?? 0;
      const hero = await computeLeakHero(ctx.db, rid, { monthOffset });
      const breakdown = await computeLeakBreakdown(ctx.db, rid, { monthOffset, limit: 200 });
      const byInvoice = new Map(breakdown.map((b) => [b.invoiceId, b]));

      // The month's invoices not marked paid (matched, or read but waiting for a PO link) — same
      // date rule as the hero.
      const res = await ctx.db.execute(
        unpaidInvoicesSql(rid, { start: hero.monthStart, end: hero.monthEnd }),
      );

      const groups = new Map<string, PayRunSupplier & { a: Record<string, number> }>();
      for (const row of rowsOf(res)) {
        const id = String(row.id);
        const inv = invoiceOfRow(row, byInvoice.get(id) ?? null);
        const key = row.supplier_id == null ? '' : String(row.supplier_id);
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            supplierName: row.supplier_name == null ? null : String(row.supplier_name),
            supplierNameEn: row.supplier_name_en == null ? null : String(row.supplier_name_en),
            invoices: [],
            payIls: 0,
            holdIls: 0,
            claimIls: 0,
            creditIls: 0,
            pendingIls: 0,
            linkIls: 0,
            a: { pay: 0, hold: 0, claim: 0, credit: 0, pending: 0, link: 0 },
          };
          groups.set(key, g);
        }
        g.invoices.push(inv);
        // Waiting for a PO link is T4: its total is reported on its own, never as pay or hold ₪.
        if (inv.pendingLink && !inv.duplicate) g.a.link! += ag(inv.totalInclVat);
        else g.a[inv.status]! += ag(inv.totalInclVat);
        g.a.credit! += ag(inv.creditIls);
        g.a.pending! += ag(inv.pendingIls);
      }

      const t = { pay: 0, hold: 0, claim: 0, credit: 0, pending: 0, link: 0, invoices: 0, linkCount: 0 };
      const suppliers: PayRunSupplier[] = [...groups.values()].map(({ a, ...g }) => {
        for (const k of ['pay', 'hold', 'claim', 'credit', 'pending', 'link'] as const) t[k] += a[k]!;
        t.invoices += g.invoices.length;
        t.linkCount += g.invoices.filter((i) => i.pendingLink && !i.duplicate).length;
        return {
          ...g,
          payIls: ils(a.pay!),
          holdIls: ils(a.hold!),
          claimIls: ils(a.claim!),
          creditIls: ils(a.credit!),
          pendingIls: ils(a.pending!),
          linkIls: ils(a.link!),
        };
      });
      // Suppliers needing action first (held ₪, then credits), then the payable ones.
      suppliers.sort(
        (x, y) =>
          y.holdIls - x.holdIls ||
          y.creditIls - x.creditIls ||
          y.payIls - x.payIls ||
          (x.supplierName ?? '').localeCompare(y.supplierName ?? '', 'he'),
      );
      return {
        enabled: true,
        monthStart: hero.monthStart,
        monthEnd: hero.monthEnd,
        suppliers,
        totals: {
          invoices: t.invoices,
          payIls: ils(t.pay),
          holdIls: ils(t.hold),
          claimIls: ils(t.claim),
          creditIls: ils(t.credit),
          pendingIls: ils(t.pending),
          linkIls: ils(t.link),
          linkCount: t.linkCount,
        },
      };
    }),
  /**
   * W2-03 · the due-date desk. ALL unpaid checked invoices (not an invoice-month window),
   * each with its due date (lib/dueDate: human > agreed > printed), its bucket
   * (באיחור / השבוע / שבוע הבא / מאוחר יותר) and every reason it is held, as text.
   * `monthOffset` keeps the old "לפי חודש חשבונית" filter (`?m=`).
   */
  list: financeProcedure
    .input(
      z
        .object({
          monthOffset: z.union([z.literal(0), z.literal(-1)]).optional(),
          now: z.date().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<PayRunListResult> => {
      const rid = ctx.session.restaurantId;
      const now = input?.now ?? new Date();
      const today = jerusalemDayKey(now)!;
      const emptyBuckets = () =>
        Object.fromEntries(
          BUCKETS.map((k) => [k, { count: 0, ils: 0 }]),
        ) as PayRunListResult['buckets'];
      const base: PayRunListResult = {
        enabled: false,
        today,
        monthStart: null,
        monthEnd: null,
        rows: [],
        buckets: emptyBuckets(),
        totals: {
          invoices: 0,
          payableIls: 0,
          payableCount: 0,
          heldIls: 0,
          heldCount: 0,
          disputeIls: 0,
          creditIls: 0,
        },
        markPaidEnabled: markPaidEnabled(),
      };
      if (!(await flagOn(ctx.db, rid))) return base;

      let window: { start: string; end: string } | null = null;
      if (input?.monthOffset !== undefined) {
        const hero = await computeLeakHero(ctx.db, rid, { monthOffset: input.monthOffset, now });
        window = { start: hero.monthStart, end: hero.monthEnd };
      }
      const raw = rowsOf(await ctx.db.execute(unpaidInvoicesSql(rid, window)));

      // Per-invoice capped leak for every listed invoice. INTERIM (TODO(W2-09a)): a custom
      // view over the rows' span; swap for the batch `computeInvoicesLeak` when it lands.
      // Past its 200-row window the SQL safety net above still holds / credits the row.
      let byInvoice = new Map<string, LeakBreakdownInvoice>();
      if (raw.length) {
        const days = raw.map((r) => jerusalemDayKey(iso(r.at))!).sort();
        const breakdown = await computeLeakBreakdown(ctx.db, rid, {
          limit: 200,
          view: {
            period: 'custom',
            from: shiftDay(days[0]!, -1),
            to: shiftDay(days[days.length - 1]!, 1),
            now,
          },
        });
        byInvoice = new Map(breakdown.map((b) => [b.invoiceId, b]));
      }

      // "חסר מספר הקצאה" hold — read-only reuse of vatAtRisk().
      const vat = await vatAtRisk(ctx.db, rid, 'all', { now });
      const vatByInvoice = new Map(vat.rows.map((r) => [r.invoiceId, r.vatAtRisk]));

      const rows: PayRunRow[] = raw.map((row) => {
        const inv = invoiceOfRow(row, byInvoice.get(String(row.id)) ?? null);
        const due = computeDueDate(
          row.at as Date | string,
          row.payment_terms as string | null,
          row.due_date as Date | null,
          {
            printedDueDate: (row.printed_due_date as string | null) ?? null,
          },
        );
        const openSince = row.open_since == null ? null : jerusalemDayKey(iso(row.open_since));
        const holds = holdReasonsOf({
          status: inv.status,
          pendingLink: inv.pendingLink,
          awaitingCount: inv.awaitingCount,
          duplicate: inv.duplicate,
          duplicateIls: inv.duplicateIls,
          pendingIls: inv.pendingIls,
          totalInclVat: inv.totalInclVat,
          openRole: (row.open_role as UserRole | null) ?? null,
          openDays: openSince ? Math.max(0, daysFrom(openSince, today)) : null,
          viewerRole: ctx.session.role,
          missingAllocationVatIls: vatByInvoice.get(inv.invoiceId) ?? null,
          // TODO(G-04 addendum): read the consolidated proposal's `note_billed_twice` overlap ₪.
          noteBilledTwiceIls: null,
        });
        return {
          ...inv,
          supplierKey: row.supplier_id == null ? '' : String(row.supplier_id),
          supplierName: row.supplier_name == null ? null : String(row.supplier_name),
          supplierNameEn: row.supplier_name_en == null ? null : String(row.supplier_name_en),
          dueDate: due.dueDate,
          dueSource: due.source,
          bucket: dueBucket(due.dueDate, today),
          daysToDue: due.dueDate ? daysFrom(today, due.dueDate) : null,
          exceedsLawLimit: due.exceedsLawLimit,
          termsCheck: termsCheckStub(
            row.payment_terms as string | null,
            row.at as Date | string,
            row.printed_terms as string | null,
            row.printed_due_date as string | null,
          ),
          holds,
          selectable: holds.length === 0,
        };
      });
      rows.sort(sortByDue);

      const buckets = emptyBuckets();
      const a = { payable: 0, held: 0, dispute: 0, credit: 0 };
      let payableCount = 0;
      let heldCount = 0;
      for (const r of rows) {
        buckets[r.bucket].count += 1;
        buckets[r.bucket].ils += ag(r.totalInclVat);
        a.credit += ag(r.creditIls);
        if (r.selectable) {
          a.payable += ag(r.totalInclVat);
          payableCount += 1;
        } else {
          a.held += ag(r.totalInclVat);
          a.dispute += ag(r.pendingIls);
          heldCount += 1;
        }
      }
      for (const k of BUCKETS) buckets[k].ils = ils(buckets[k].ils);
      return {
        ...base,
        enabled: true,
        monthStart: window?.start ?? null,
        monthEnd: window?.end ?? null,
        rows,
        buckets,
        totals: {
          invoices: rows.length,
          payableIls: ils(a.payable),
          payableCount,
          heldIls: ils(a.held),
          heldCount,
          disputeIls: ils(a.dispute),
          creditIls: ils(a.credit),
        },
      };
    }),

  /**
   * "סמן כשולם" — finance tier. All-or-nothing over `items`; a foreign id is NOT_FOUND.
   * Behind PAY_RUN_MARK_PAID (OFF): until H-03 is deployed and G-05's `mark_paid`
   * transition + idempotency are on the base, it answers NOT_IMPLEMENTED after the
   * ownership check. At the γ rebase the write lands: G-05 `mark_paid` (`expectedFrom`),
   * `paid_at/paid_amount/payment_method/payment_ref`, one audit row per invoice, replay
   * of `clientMutationId` = the recorded result, `markPaidRefusal` per item.
   * Marking paid NEVER deletes a claim (lib/claims keeps a paid invoice's claims).
   */
  markPaid: financeProcedure.input(MARK_PAID_INPUT).mutation(async ({ ctx, input }) => {
    await assertOwnInvoices(
      ctx.db,
      ctx.session.restaurantId,
      input.items.map((i) => i.invoiceId),
    );
    if (!markPaidEnabled())
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidOff' });
    // TODO(H-03 + G-05, γ rebase): the guarded write. Until then the flag stays OFF.
    throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  }),

  /** Undo of "סמן כשולם" (the ≥10 s toast action). Same guards as `markPaid`. */
  unmarkPaid: financeProcedure.input(UNMARK_PAID_INPUT).mutation(async ({ ctx, input }) => {
    await assertOwnInvoices(
      ctx.db,
      ctx.session.restaurantId,
      input.items.map((i) => i.invoiceId),
    );
    if (!markPaidEnabled())
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidOff' });
    // TODO(H-03 + G-05, γ rebase): G-05 `unmark` transition (expectedFrom 'paid').
    throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  }),
});
