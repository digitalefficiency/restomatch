import type { Locale } from '@/lib/i18n/config';
import { createTranslator, type Translator } from '@/lib/i18n/translate';
import { invoices } from '@/lib/i18n/messages/invoices';
import type {
  DecisionRecord,
  DecisionResult,
  GapReason,
  GapRole,
  GapSeverity,
  PassedOn,
  QueueRow,
  VatBasis,
} from './types';

/**
 * INV-00 · the words every screen of the invoices area shares (SPEC §2.2): with whom a gap
 * is, since when, why, what was decided and by which role. Pure: the server returns
 * structures (`./types.ts`), this module words them from `messages/invoices/gap.ts`, and no
 * screen writes a role word or a rule phrase of its own. Every function that words a wait
 * takes "now". Every ₪ goes through `formatIls()`.
 */

/** The three forms of a role word: "בעלים" · "הבעלים" · "לבעלים". */
export type RoleForm = 'bare' | 'the' | 'to';

/** What the line about one gap needs: the list's `holding`, or a queue row through `gapOfQueueRow()`. */
export interface GapLineInput {
  /** The role the gap waits for. */
  role: GapRole;
  /** Routed to the viewer's own role ("אצלכם"). */
  mine: boolean;
  /** When its wait started (the pass-on, else the gap row's creation). */
  since: Date;
  reason: GapReason;
  passedOn: PassedOn | null;
}

/** The restaurant's zone: whole days are counted on its calendar. */
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

/** The line-input of a queue row (`approvals.myQueue`) for `viewer`: the same words as the list's `holding`. */
export function gapOfQueueRow(row: QueueRow, viewer: GapRole): GapLineInput {
  const role: GapRole = row.waitingOn === 'owner' || row.waitingOn === 'bookkeeper' ? row.waitingOn : 'manager';
  return {
    role,
    mine: role === viewer,
    since: row.passedOn?.at ?? row.createdAt,
    reason: row.reason,
    passedOn: row.passedOn,
  };
}

/** Whole days from `since` to `now` on the restaurant's calendar (0 on the same day). */
export function waitDays(since: Date, now: Date, timeZone: string = AREA_TIME_ZONE): number {
  void since;
  void now;
  void timeZone;
  return 0; // slice 4
}

/** How long a gap has waited: "מהיום" on its first day (or the day it was passed on), else "יום אחד" / "יומיים" / "N ימים". */
export function waitText(since: Date, now: Date, locale: Locale): string {
  void since;
  void now;
  void locale;
  return ''; // slice 4
}

/**
 * Why a gap is with its role, as the approved phrase without "כי" (SPEC §2.2), or null when
 * the owner has not read a phrase for its rule, or its numbers are not proven.
 */
export function reasonText(gap: { reason: GapReason; passedOn: PassedOn | null }, locale: Locale): string | null {
  void gap;
  void locale;
  return null; // slice 4
}

/** The full line: "אצלכם 10 ימים, כי חיוב על יותר ממה שהתקבל חוסם תשלום." or, with no phrase, "אצל הבעלים 4 ימים." */
export function gapLine(gap: GapLineInput, now: Date, locale: Locale): string {
  void now;
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

/** "הוחלט היום" when it was decided on `now`'s day; on an earlier day the date itself (dd.MM.yyyy). */
export function decidedWhenText(decision: DecisionRecord, now: Date, locale: Locale): string {
  void decision;
  void now;
  void locale;
  return ''; // slice 4
}

/** The reason a person gave: the words they typed, else the desk's label of the reason code; null when none. */
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

/** An amount with its basis, from integer agorot: "₪38.70 לפני מע״מ" (through `formatIls()`). */
export function amountText(agorot: number, basis: VatBasis, locale: Locale): string {
  void agorot;
  void basis;
  void locale;
  return ''; // slice 4
}
