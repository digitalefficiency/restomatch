import type { Locale } from '@/lib/i18n/config';
import { createTranslator, type Translator } from '@/lib/i18n/translate';
import { invoices } from '@/lib/i18n/messages/invoices';
import type {
  AgorotByBasis,
  DecisionRecord,
  DecisionResult,
  GapReason,
  GapRole,
  GapSeverity,
  HistoryActor,
  PassedOn,
  PayBy,
  QueueRow,
  VatBasis,
} from './types';

/**
 * INV-00 · the words every screen of the invoices area shares (SPEC §2.2): with whom a gap
 * is, since when, why, what was decided and by which role. Pure: the server returns
 * structures (`./types.ts`), this module words them from `messages/invoices/gap.ts`, and no
 * screen writes a role word or a rule phrase of its own. Every function that words a wait or
 * a day takes "now" and the restaurant's zone (`timeZone`, carried by the payload: the list,
 * the invoice, `invoices.holding` entries, `approvals.queueSummary`). Every ₪ goes through
 * `formatIls()`.
 */

/** The three forms of a role word: "בעלים" · "הבעלים" · "לבעלים". */
export type RoleForm = 'bare' | 'the' | 'to';

/** What the line about one gap needs: the list's `holding`, or a queue row through `gapOfQueueRow()`. */
export interface GapLineInput {
  /** The role the gap waits for. */
  role: GapRole;
  /** Routed to the viewer's own role ("אצלכם"); never for a gap with no routed role. */
  mine: boolean;
  /** When its wait started (the pass-on, else the gap row's creation). */
  since: Date;
  reason: GapReason;
  passedOn: PassedOn | null;
}

/**
 * The zone the server counts in when a restaurant stores none (`DEFAULT_AREA_TIME_ZONE`). A
 * screen passes the payload's `timeZone`; no function here falls back to this by itself.
 */
export const AREA_TIME_ZONE = 'Asia/Jerusalem';

type InvoicesT = Translator<(typeof invoices)['he']>;
const translators = new Map<Locale, InvoicesT>();
function tr(locale: Locale): InvoicesT {
  let t = translators.get(locale);
  if (!t) {
    t = createTranslator(locale, invoices);
    translators.set(locale, t);
  }
  return t;
}

/** A role word in one of its three forms ("בעלים", "הבעלים", "לבעלים"). */
export function roleWord(role: GapRole, form: RoleForm, locale: Locale): string {
  return tr(locale)(`gap.role.${role}.${form}`);
}

/** With whom a gap is: "אצלכם" when it is routed to the viewer's role, else "אצל הבעלים" / "אצל הניהול" / "אצל הנהלת החשבונות". */
export function withWhom(gap: { role: GapRole; mine: boolean }, locale: Locale): string {
  return tr(locale)(gap.mine ? 'gap.who.mine' : `gap.who.${gap.role}`);
}

/**
 * The line-input of a queue row (`approvals.myQueue`) for `viewer`: the same words as the list's
 * `holding`. A row with no routed role (`waitingOn: 'unrouted'`) reads as the manager's and is
 * nobody's own ("אצל הניהול" for every viewer), as `holding` returns it.
 */
export function gapOfQueueRow(row: QueueRow, viewer: GapRole): GapLineInput {
  const role: GapRole = row.waitingOn === 'owner' || row.waitingOn === 'bookkeeper' ? row.waitingOn : 'manager';
  return {
    role,
    mine: row.waitingOn === viewer,
    since: row.passedOn?.at ?? row.createdAt,
    reason: row.reason,
    passedOn: row.passedOn,
  };
}

/** Whole days from `since` to `now` on the restaurant's calendar (`timeZone`; 0 on the same day). */
export function waitDays(since: Date, now: Date, timeZone: string): number {
  void since;
  void now;
  void timeZone;
  return 0; // slice 4
}

/** How long a gap has waited: "מהיום" on its first day (or the day it was passed on), else "יום אחד" / "יומיים" / "N ימים". */
export function waitText(since: Date, now: Date, locale: Locale, timeZone: string): string {
  void since;
  void now;
  void locale;
  void timeZone;
  return ''; // slice 4
}

/**
 * Why a gap is with its role, as the approved phrase without "כי" (SPEC §2.2), or null when
 * the owner has not read a phrase for its rule, or its numbers are not proven. When `passedOn`
 * is set, the reason is the pass-on phrase (approved for a gap the manager passed on, with
 * its `waitedDays`) or null, never the rule's phrase: the rule's phrase belongs to the first
 * routing (the history's `routed` event).
 */
export function reasonText(gap: { reason: GapReason; passedOn: PassedOn | null }, locale: Locale): string | null {
  void gap;
  void locale;
  return null; // slice 4
}

/** The full line: "אצלכם 10 ימים, כי חיוב על יותר ממה שהתקבל חוסם תשלום." or, with no phrase, "אצל הבעלים 4 ימים." */
export function gapLine(gap: GapLineInput, now: Date, locale: Locale, timeZone: string): string {
  void now;
  void timeZone;
  return withWhom(gap, locale); // slice 4
}

/** A gap's level: "חוסם תשלום" or "אזהרה". */
export function levelText(severity: GapSeverity, locale: Locale): string {
  void severity;
  void locale;
  return ''; // slice 4
}

/** A decision's result ("נוסף לבקשת הזיכוי", "שולם כפי שחויב"), or null for a result with no approved words. */
export function resultText(result: DecisionResult, locale: Locale): string | null {
  void result;
  void locale;
  return null; // slice 4
}

/** Beside the gap's amount: "הפער: שולם כפי שחויב" (the amount is the gap's; nothing records a payment). */
export function gapResultText(result: DecisionResult, locale: Locale): string | null {
  void result;
  void locale;
  return null; // slice 4
}

/** A decision as a history line: "נוסף לבקשת הזיכוי, ₪38.70 לפני מע״מ" / "הפער של ₪38.70 לפני מע״מ נסגר, שולם כפי שחויב". */
export function decisionLine(decision: DecisionRecord, locale: Locale): string | null {
  void decision;
  void locale;
  return null; // slice 4
}

/** Who decided, as a role: "בעלים", or "בעלים, במקום הניהול" when the owner decided another role's gap. */
export function decidedByText(decision: DecisionRecord, locale: Locale): string | null {
  void decision;
  void locale;
  return null; // slice 4
}

/** "הוחלט היום" when it was decided on `now`'s day (in `timeZone`); on an earlier day the date itself (dd.MM.yyyy). */
export function decidedWhenText(decision: DecisionRecord, now: Date, locale: Locale, timeZone: string): string {
  void decision;
  void now;
  void locale;
  void timeZone;
  return ''; // slice 4
}

/**
 * The reason a person gave: the words they typed, else the desk's label of the reason code
 * (`messages/approvals` `reasons.*`, INV-04's group: its keys must stay; 'reviewed' reads the
 * frozen `decision.reviewedDone`); null when none.
 */
export function decisionReasonText(decision: DecisionRecord, locale: Locale): string | null {
  void decision;
  void locale;
  return null; // slice 4
}

/** After the owner decided another role's gap: "החלטתם במקום הניהול". */
export function youDecidedInPlaceOf(role: GapRole, locale: Locale): string {
  void role;
  void locale;
  return ''; // slice 4
}

/** The note on another role's group or gap the viewer may not decide: "לקריאה בלבד". */
export function readOnlyText(locale: Locale): string {
  void locale;
  return ''; // slice 4
}

/** The note beside the action when the owner looks at another role's gap: "גם אתם רשאים להחליט". */
export function mayDecideTooText(locale: Locale): string {
  void locale;
  return ''; // slice 4
}

/**
 * For a role that may not decide: "ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם." (`full`), or
 * "ההחלטה אצל הבעלים." (`short`, the list's summary and the foot of the whole-screen document).
 */
export function notYoursText(role: GapRole, form: 'full' | 'short', locale: Locale): string {
  void role;
  void form;
  void locale;
  return ''; // slice 4
}

/** An invoice that waits to be linked: "מחכה לשיוך להזמנה", or "השיוך לתעודות המשלוח עוד לא פעיל" for a consolidated invoice (no full stop: a screen adds it in a sentence). */
export function awaitingLinkText(consolidated: boolean, locale: Locale): string {
  void consolidated;
  void locale;
  return ''; // slice 4
}

/** Whole days from `now`'s day to the pay-by day (`payBy.date`, 'YYYY-MM-DD'): 0 on the day, negative when late. */
export function payByDaysLeft(payBy: PayBy, now: Date, timeZone: string): number {
  void payBy;
  void now;
  void timeZone;
  return 0; // slice 4
}

/**
 * The quiet remainder after a due date (SPEC §2.3): "נותרו N ימים" ("נותר יום אחד"), or "היום
 * האחרון" on the day itself; null when `payBy` is null or the day has passed (a late invoice
 * has no words), and for a paid invoice (the screen does not call it). Days on the
 * restaurant's calendar (`timeZone`).
 */
export function payByRemainderText(payBy: PayBy | null, now: Date, locale: Locale, timeZone: string): string | null {
  void payBy;
  void now;
  void locale;
  void timeZone;
  return null; // slice 4
}

/**
 * The role beside an act of an invoice's story (SPEC §4.8): a role word ("בעלים", "ניהול",
 * "הנהלת חשבונות", "קבלת סחורה", "מטבח"), "המערכת" for what the product did, or null when
 * the product does not record who did it.
 */
export function actorText(by: HistoryActor, locale: Locale): string | null {
  void by;
  void locale;
  return null; // slice 4
}

/** "פער אחד" / "N פערים". */
export function countGapsText(count: number, locale: Locale): string {
  void count;
  void locale;
  return ''; // slice 4
}

/** "חשבונית אחת" / "N חשבוניות". */
export function countInvoicesText(count: number, locale: Locale): string {
  void count;
  void locale;
  return ''; // slice 4
}

/** The VAT basis an amount is on: "לפני מע״מ", "כולל מע״מ", or "מע״מ" (a VAT mismatch is the VAT itself). */
export function basisText(basis: VatBasis, locale: Locale): string {
  void basis;
  void locale;
  return ''; // slice 4
}

/**
 * Open ₪ on all its bases: each non-zero part with its own basis, before VAT first ("₪143.50
 * לפני מע״מ · ₪1,170.00 כולל מע״מ"); null when all three are 0 (never "₪0").
 */
export function openAmountText(open: AgorotByBasis, locale: Locale): string | null {
  void open;
  void locale;
  return null; // slice 4
}

/** "פער של ₪38.70 לפני מע״מ" / "פערים של ₪143.50 לפני מע״מ" (and the parts on other bases); null with no ₪. */
export function gapsOfText(count: number, open: AgorotByBasis, locale: Locale): string | null {
  void count;
  void open;
  void locale;
  return null; // slice 4
}

/** An amount with its basis, from integer agorot: "₪38.70 לפני מע״מ" (through `formatIls()`). */
export function amountText(agorot: number, basis: VatBasis, locale: Locale): string {
  void agorot;
  void basis;
  void locale;
  return ''; // slice 4
}
