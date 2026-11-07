/**
 * W2-03 · The ONE due-date rule (owner decision 31.10, addendum 1.11).
 *
 * Pure: no DB, no clock, no env. All calendar math runs on the restaurant's
 * Asia/Jerusalem day — an invoice timestamped 23:30Z on 30.09 is an Israeli
 * 01.10 invoice, and its due date follows from 01.10.
 *
 * Precedence (binding, W2-03 §10 / G-17):
 *   1. a human-entered `explicitDueDate` (`invoices.due_date`) wins;
 *   2. then the AGREED supplier terms (`suppliers.payment_terms`);
 *   3. then the OCR-printed due date (G-17 `ocr_payload.raw.printedDueDate`),
 *      ONLY when the supplier has no parseable agreed terms — so a supplier
 *      who prints an earlier date can never move the payment earlier;
 *   4. otherwise `unknown` ("אין תנאי תשלום · הגדירו").
 *
 * Terms grammar (defensive; free text up to 500 chars, never throws):
 *   - "שוטף+N" and its variants ("שוטף + 30", "שוטף 30", "שוטף-30",
 *     "net+30", "net 30", "eom+30", "שוטף+60 יום") = END of the invoice month
 *     + N days. Bare "שוטף" / "net" / "eom" = end of month + 0.
 *   - "מזומן" / "cash" / "COD" = the invoice date itself.
 *   - anything else = `unknown`.
 *
 * G-17 reuses `parsePaymentTerms` / `dueDateFromTerms` for the PRINTED terms
 * string — don't fork a second parser.
 */

/** The IANA zone every due-date day is computed in. */
export const DUE_DATE_TZ = 'Asia/Jerusalem';

/**
 * Payment-Delays law (חוק מוסר תשלומים לספקים) ceiling, in days after the end
 * of the invoice month. Terms beyond it get the warn chip "מעבר לתקרת החוק".
 * Proposed 45 — leak-economist confirms the number before merge.
 */
export const PAYMENT_LAW_MAX_DAYS_AFTER_EOM = 45;

/** Upper bound on a parsed N; anything larger is treated as unparsed. */
const MAX_TERMS_DAYS = 365;

export type ParsedTerms =
  | { kind: 'eom_plus'; days: number }
  | { kind: 'cash' }
  | { kind: 'unknown' };

export type DueDateSource = 'explicit' | 'agreed' | 'printed' | 'unknown';

export interface DueDateResult {
  /** 'YYYY-MM-DD' Asia/Jerusalem calendar day, or null when unknown. */
  dueDate: string | null;
  source: DueDateSource;
  /** The parsed AGREED terms (always reported, even when explicit wins). */
  terms: ParsedTerms;
  /** Agreed terms exceed `PAYMENT_LAW_MAX_DAYS_AFTER_EOM` (warn chip). */
  exceedsLawLimit: boolean;
}

export type DateInput = Date | string | null | undefined;

export interface ComputeDueDateOptions {
  /** G-17: the due date printed on the paper (`raw.printedDueDate`). */
  printedDueDate?: DateInput;
}

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' of the Asia/Jerusalem day containing `d`, or null. */
export function jerusalemDayKey(d: DateInput): string | null {
  if (d == null) return null;
  if (typeof d === 'string') {
    const s = d.trim();
    // A bare calendar date is already an Israeli day — never shift it.
    const bare = DAY_KEY_RE.exec(s);
    if (bare) return isValidYmd(+bare[1]!, +bare[2]!, +bare[3]!) ? s : null;
    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : jerusalemDayKey(parsed);
  }
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DUE_DATE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "שוטף", "net", "eom" optionally followed by [+ - ־ space] N, optional "יום/ימים/days".
const EOM_RE =
  /^(?:שוטף|net|eom|n\/eom)(?:\s*(?:[+\-־–—]\s*|\s+)?(\d{1,4}))?(?:\s*(?:יום|ימים|days?|d))?\.?$/i;
const CASH_RE = /^(?:מזומן|במזומן|cash|cod|c\.o\.d\.?)$/i;

/** Parse free-text supplier terms. Never throws. */
export function parsePaymentTerms(text: string | null | undefined): ParsedTerms {
  if (typeof text !== 'string') return { kind: 'unknown' };
  if (text.length > 500) return { kind: 'unknown' };
  // Strip a leading label ("תנאי תשלום:"), quotes and collapse whitespace.
  const s = text
    .replace(/^\s*(?:תנאי\s*תשלום|payment\s*terms|terms)\s*[:\-]?\s*/i, '')
    .replace(/["'״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return { kind: 'unknown' };
  if (CASH_RE.test(s)) return { kind: 'cash' };
  const m = EOM_RE.exec(s);
  if (m) {
    const days = m[1] === undefined ? 0 : Number(m[1]);
    if (!Number.isInteger(days) || days < 0 || days > MAX_TERMS_DAYS) return { kind: 'unknown' };
    return { kind: 'eom_plus', days };
  }
  return { kind: 'unknown' };
}

/** Due day for parsed terms from an invoice day key; null when unknown. */
export function dueDateFromTerms(invoiceDayKey: string, terms: ParsedTerms): string | null {
  const m = DAY_KEY_RE.exec(invoiceDayKey);
  if (!m) return null;
  const y = +m[1]!;
  const mo = +m[2]!;
  if (terms.kind === 'cash') return invoiceDayKey;
  if (terms.kind !== 'eom_plus') return null;
  // End of the invoice month + N (pure calendar counting, no offsets).
  const due = new Date(Date.UTC(y, mo - 1, daysInMonth(y, mo) + terms.days));
  return ymd(due.getUTCFullYear(), due.getUTCMonth() + 1, due.getUTCDate());
}

/**
 * The one due-date rule. See the file header for precedence and grammar.
 *
 * @param invoiceDate     `invoices.invoice_date` (instant) or a 'YYYY-MM-DD' Israeli day
 * @param terms           `suppliers.payment_terms` (free text, agreed)
 * @param explicitDueDate `invoices.due_date` (human-entered; wins)
 * @param opts.printedDueDate G-17 printed due date (used only with no agreed terms)
 */
export function computeDueDate(
  invoiceDate: DateInput,
  terms: string | null | undefined,
  explicitDueDate?: DateInput,
  opts: ComputeDueDateOptions = {},
): DueDateResult {
  const parsed = parsePaymentTerms(terms);
  const exceedsLawLimit =
    parsed.kind === 'eom_plus' && parsed.days > PAYMENT_LAW_MAX_DAYS_AFTER_EOM;

  const explicit = jerusalemDayKey(explicitDueDate);
  if (explicit) return { dueDate: explicit, source: 'explicit', terms: parsed, exceedsLawLimit };

  const invoiceDay = jerusalemDayKey(invoiceDate);
  if (invoiceDay && parsed.kind !== 'unknown') {
    const agreed = dueDateFromTerms(invoiceDay, parsed);
    if (agreed) return { dueDate: agreed, source: 'agreed', terms: parsed, exceedsLawLimit };
  }

  const printed = jerusalemDayKey(opts.printedDueDate);
  if (printed && parsed.kind === 'unknown') {
    return { dueDate: printed, source: 'printed', terms: parsed, exceedsLawLimit };
  }

  return { dueDate: null, source: 'unknown', terms: parsed, exceedsLawLimit };
}

/** Whole calendar days from `fromDay` to `toDay` ('YYYY-MM-DD'); negative = past. */
export function daysBetween(fromDay: string, toDay: string): number {
  const a = DAY_KEY_RE.exec(fromDay);
  const b = DAY_KEY_RE.exec(toDay);
  if (!a || !b) return NaN;
  const ta = Date.UTC(+a[1]!, +a[2]! - 1, +a[3]!);
  const tb = Date.UTC(+b[1]!, +b[2]! - 1, +b[3]!);
  return Math.round((tb - ta) / 86_400_000);
}

export type DueBucket = 'overdue' | 'this_week' | 'next_week' | 'later' | 'unknown';

/**
 * Bucket a due day relative to today (both Israeli day keys). Weeks are
 * Israeli weeks (Sunday–Saturday): השבוע = today..this Saturday,
 * שבוע הבא = next Sunday..next Saturday.
 */
export function dueBucket(dueDay: string | null, todayDay: string): DueBucket {
  if (!dueDay) return 'unknown';
  const diff = daysBetween(todayDay, dueDay);
  if (Number.isNaN(diff)) return 'unknown';
  if (diff < 0) return 'overdue';
  const t = DAY_KEY_RE.exec(todayDay)!;
  const dow = new Date(Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!)).getUTCDay(); // 0 = Sunday
  const toSaturday = 6 - dow;
  if (diff <= toSaturday) return 'this_week';
  if (diff <= toSaturday + 7) return 'next_week';
  return 'later';
}
