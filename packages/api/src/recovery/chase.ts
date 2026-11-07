import { isNeverClaimable, vatBasisOf } from '../lib/claims';
import type { ReportLocale } from '../reports/money';

/**
 * AU-03 · the pre-addressed supplier reminder DRAFT (pure; catalogue A12).
 *
 * Owner decision 16: nothing goes to a supplier automatically. This builds the
 * text and the hand-off links (wa.me to the supplier's own number, mailto to
 * the supplier's own address); the web opens them only on a click, in the
 * user's own WhatsApp / mail app. Nothing here queues, sends or stamps.
 *
 * Wording follows the owner's partner tone (OWNER-DECISIONS-0711 W1/W2,
 * terms/GLOSSARY §2): "בקשת זיכוי", "תזכורת קטנה", ask for "חשבונית זיכוי"
 * by name; never דרישה / תביעה / חוב / באיחור / מחלוקת.
 *
 * Only decided claims are listed (the caller passes chased claims); a
 * never-claimable type (e.g. MISSING_ON_INVOICE) is dropped defensively, and a
 * claim whose letter was never sent is NOT reminded (the letter goes first).
 */

export interface DraftClaim {
  id: string;
  status: string;
  outstandingAgorot: number;
  letterSentAt: string | null;
  acknowledgedAt?: string | null;
  claimedAt: string;
  discrepancyType?: string | null;
}

export interface SupplierReminderDraftInput {
  supplier: { name: string; nameEn?: string | null; contactWhatsapp?: string | null; contactEmail?: string | null };
  claims: ReadonlyArray<DraftClaim>;
  restaurant: { name: string; nameEn?: string | null };
  locale?: ReportLocale;
  /** "now" — the reply-by date is now + replyInDays (default 7), Israel calendar. */
  nowIso: string;
  replyInDays?: number;
}

export interface SupplierReminderDraftText {
  /** `reminder` = letter sent, no reply; `acknowledged` = the supplier agreed, no credit yet. */
  variant: 'reminder' | 'acknowledged';
  subject: string;
  text: string;
  waHref: string | null;
  mailtoHref: string | null;
  claimIds: string[];
  count: number;
  outstandingAgorot: number;
}

/**
 * An Israeli phone as wa.me wants it (E.164 digits, no "+"): local 0-prefix →
 * 972. Same rule as the orders hand-off (apps/web orders/order-logic.ts
 * `waPhone`) until W2-11's shared E.164 normaliser lands. Null when the number
 * cannot be a phone (fewer than 9 national digits, or more than 15 in all).
 */
export function waPhoneE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  let e164: string;
  if (digits.startsWith('972')) e164 = digits;
  else if (digits.startsWith('00')) e164 = digits.slice(2);
  else if (digits.startsWith('0')) e164 = `972${digits.slice(1)}`;
  else e164 = digits;
  if (e164.startsWith('972') && e164.length !== 11 && e164.length !== 12) return null;
  if (e164.length < 10 || e164.length > 15) return null;
  return e164;
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
export function validEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? '').trim();
  return EMAIL_RE.test(e) ? e : null;
}

/** dd.MM in Israel time. */
export function ddMM(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit' }).formatToParts(
    new Date(iso),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}`;
}

/** ₪ with agorot (2 dp) — the interim for G-13 `moneyText`. */
export function chaseMoney(agorot: number, locale: ReportLocale = 'he'): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(agorot / 100);
}

/**
 * Build the reminder draft for ONE supplier, or null when there is nothing a
 * reminder may say (no sent letter / acknowledged claim with ₪ outstanding).
 */
export function supplierReminderDraft(input: SupplierReminderDraftInput): SupplierReminderDraftText | null {
  const en = input.locale === 'en';
  const claims = input.claims.filter(
    (c) =>
      c.outstandingAgorot > 0 &&
      !(c.discrepancyType && isNeverClaimable(c.discrepancyType)) &&
      (c.status === 'letter_sent' || c.status === 'acknowledged'),
  );
  if (claims.length === 0) return null;
  // Any claim still without an answer makes it a plain reminder; all acknowledged → the softer variant.
  const variant: SupplierReminderDraftText['variant'] = claims.every((c) => c.status === 'acknowledged') ? 'acknowledged' : 'reminder';
  const total = claims.reduce((s, c) => s + c.outstandingAgorot, 0);
  const count = claims.length;
  const amount = chaseMoney(total, en ? 'en' : 'he');
  const allExcl = claims.every((c) => vatBasisOf(c.discrepancyType ?? '') === 'excl');
  const sentDates = claims.map((c) => c.letterSentAt ?? c.claimedAt).sort();
  const firstSent = ddMM(sentDates[0]!);
  const ackDates = claims.map((c) => c.acknowledgedAt).filter((d): d is string => !!d).sort();
  const ackOn = ddMM(ackDates[0] ?? sentDates[0]!);
  const replyBy = ddMM(new Date(new Date(input.nowIso).getTime() + (input.replyInDays ?? 7) * 86_400_000).toISOString());
  const supplierName = en && input.supplier.nameEn ? input.supplier.nameEn : input.supplier.name;
  const restaurantName = en && input.restaurant.nameEn ? input.restaurant.nameEn : input.restaurant.name;

  let subject: string;
  let text: string;
  if (en) {
    const lines = `${count} ${count === 1 ? 'line' : 'lines'}, ${amount}${allExcl ? ' before VAT' : ''}`;
    subject = variant === 'acknowledged' ? `Credit request from ${ackOn}: credit invoice` : `A small reminder: credit request from ${firstSent}`;
    text =
      variant === 'acknowledged'
        ? `Hi ${supplierName}, thank you for approving the credit request from ${ackOn}. The credit invoice has not reached us yet (${lines}). Could you let us know when it will be issued? We would appreciate it by ${replyBy}, so we can close the month. Thanks, ${restaurantName}`
        : `Hi ${supplierName}, a small reminder about the credit request we sent on ${firstSent} (${lines}). We would appreciate a credit invoice or a corrected invoice by ${replyBy}, so we can close the month. If something doesn't add up on your side, let's check it together. Thanks, ${restaurantName}`;
  } else {
    const lines = `${count === 1 ? 'שורה אחת' : `${count} שורות`}, ${amount}${allExcl ? ' לפני מע״מ' : ''}`;
    subject = variant === 'acknowledged' ? `בקשת זיכוי מ-${ackOn}: חשבונית זיכוי` : `תזכורת קטנה: בקשת זיכוי מ-${firstSent}`;
    text =
      variant === 'acknowledged'
        ? `שלום ${supplierName}, תודה שאישרתם את בקשת הזיכוי מ-${ackOn}. חשבונית הזיכוי עוד לא הגיעה אלינו (${lines}). אפשר לעדכן מתי היא תצא? נודה לה עד ${replyBy}, כדי שנסגור את החודש מסודר. תודה, ${restaurantName}`
        : `שלום ${supplierName}, תזכורת קטנה לגבי בקשת הזיכוי ששלחנו ב-${firstSent} (${lines}). נשמח לחשבונית זיכוי או לחשבונית מתוקנת עד ${replyBy}, כדי שנסגור את החודש מסודר. אם משהו לא מסתדר אצלכם — דברו איתנו ונבדוק יחד. תודה, ${restaurantName}`;
  }

  const phone = waPhoneE164(input.supplier.contactWhatsapp);
  const email = validEmail(input.supplier.contactEmail);
  return {
    variant,
    subject,
    text,
    waHref: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
    mailtoHref: email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null,
    claimIds: claims.map((c) => c.id),
    count,
    outstandingAgorot: total,
  };
}
