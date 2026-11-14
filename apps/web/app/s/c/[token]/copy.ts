/**
 * H-06ʰ — every string the SUPPLIER sees on the reply link. Partner wording
 * (docs/ux/terms/GLOSSARY.md §1–§2, owner decisions W1–W2): our document is a
 * "מכתב בקשת זיכוי", theirs is a "חשבונית זיכוי"; ask, don't demand; the
 * invoice is the subject; assume good faith; thank them. `__tests__/copy.test.ts`
 * fails the build on any word from the never-list.
 *
 * Kept local to the page (Hebrew-first, English for an English browser) instead
 * of a `msg/` namespace: `msg/index.ts` is W3-08's in wave 3.
 */
import type { claimPortal } from '@restomatch/api';

type ClaimLineReason = claimPortal.ClaimLineReason;

type Dict = {
  metaTitle: string;
  eyebrow: string;
  title: string;
  intro: string;
  goodFaith: string;
  sentOn: string;
  expires: string;
  invoice: string;
  invoiceNoDate: string;
  total: string;
  reasons: Record<ClaimLineReason, string>;
  agree: string;
  check: string;
  agreeAll: string;
  lineNote: string;
  lineNotePlaceholder: string;
  creditNoteNumber: string;
  note: string;
  notePlaceholder: string;
  submit: string;
  pickOne: string;
  sending: string;
  doneTitle: string;
  doneBody: string;
  empty: string;
  inactiveTitle: string;
  inactiveBody: string;
  expiredBody: string;
  rateLimited: string;
  alreadyAnswered: string;
  generic: string;
  poweredBy: string;
};

export const CLAIM_PORTAL_COPY: Record<'he' | 'en', Dict> = {
  he: {
    metaTitle: 'מכתב בקשת זיכוי',
    eyebrow: 'מכתב בקשת זיכוי',
    title: 'בקשת זיכוי מ{restaurant}',
    intro:
      'שלום {supplier}, תודה על העבודה המשותפת. בבדיקת החשבוניות מול ההזמנות ותעודות המשלוח מצאנו כמה פערים, בסך {amount}, ונשמח לחשבונית זיכוי עליהם.',
    goodFaith: 'ייתכן שפספסנו משהו — אם יש תעודה חתומה, נשמח לראות. אפשר לסמן "נבדוק יחד" ונחזור אליכם.',
    sentOn: 'בקשת הזיכוי ששלחנו ב-{date}',
    expires: 'הקישור פעיל עד {date}',
    invoice: 'חשבונית {number} · {date}',
    invoiceNoDate: 'חשבונית {number}',
    total: 'סך הכול',
    reasons: {
      price: 'המחיר בחשבונית גבוה מהמחיר שסוכם',
      quantity: 'הכמות בחשבונית שונה ממה שהתקבל לפי תעודת המשלוח',
      missing: 'פער מול תעודת המשלוח',
      unit: 'יחידת המידה בחשבונית שונה מזו שבהזמנה',
      duplicate: 'נראה שהחשבונית הזו הגיעה אלינו פעמיים',
      vat: 'פער בחישוב המע״מ בחשבונית',
      total: 'פער בסכום הכולל של החשבונית',
      other: 'פער מול ההזמנה או תעודת המשלוח',
    },
    agree: 'מאשרים — תצא חשבונית זיכוי',
    check: 'נבדוק יחד',
    agreeAll: 'מאשרים את כל השורות',
    lineNote: 'מה כדאי שנדע על השורה הזו?',
    lineNotePlaceholder: 'למשל: יש תעודת משלוח חתומה על 12 ק״ג',
    creditNoteNumber: 'מספר חשבונית הזיכוי, אם כבר יש',
    note: 'הערה למסעדה',
    notePlaceholder: 'אפשר להשאיר ריק',
    submit: 'שליחת התשובה · {count} שורות',
    pickOne: 'נשמח לתשובה לפחות על שורה אחת.',
    sending: 'שולחים…',
    doneTitle: 'תודה! התשובה התקבלה',
    doneBody:
      'העברנו את התשובה ל{restaurant}. על השורות שאישרתם נשמח לחשבונית זיכוי; על השורות שסימנתם "נבדוק יחד" — נחזור אליכם ונבדוק יחד.',
    empty: 'אין כרגע שורות פתוחות במכתב הזה. תודה על הטיפול!',
    inactiveTitle: 'הקישור לא פעיל',
    inactiveBody: 'ייתכן שהקישור הועתק חלקית. אפשר לפנות למסעדה ולבקש קישור חדש.',
    expiredBody: 'הקישור היה פעיל 72 שעות. אפשר לבקש מהמסעדה קישור חדש — נשמח לתשובה.',
    rateLimited: 'היו כאן הרבה ניסיונות ברצף. נסו שוב בעוד כמה דקות.',
    alreadyAnswered: 'על חלק מהשורות כבר התקבלה תשובה. רעננו את הדף כדי לראות מה נשאר.',
    generic: 'משהו לא הסתדר בשליחה. נסו שוב בעוד רגע.',
    poweredBy: 'נשלח באמצעות RestoMatch',
  },
  en: {
    metaTitle: 'Credit-request letter',
    eyebrow: 'Credit-request letter',
    title: 'Credit request from {restaurant}',
    intro:
      'Hello {supplier}, thank you for working with us. Checking this month’s invoices against the orders and delivery notes, we found a few gaps totalling {amount}, and would be glad to receive a credit note for them.',
    goodFaith: 'We may have missed something — if you have a signed delivery note, we’d be glad to see it. Mark a line “Let’s check together” and we’ll get back to you.',
    sentOn: 'The credit request we sent on {date}',
    expires: 'This link is active until {date}',
    invoice: 'Invoice {number} · {date}',
    invoiceNoDate: 'Invoice {number}',
    total: 'Total',
    reasons: {
      price: 'The invoice price is higher than the agreed price',
      quantity: 'The invoiced quantity differs from what the delivery note shows',
      missing: 'A gap against the delivery note',
      unit: 'The invoice unit differs from the order',
      duplicate: 'This invoice seems to have reached us twice',
      vat: 'A gap in the invoice VAT',
      total: 'A gap in the invoice total',
      other: 'A gap against the order or delivery note',
    },
    agree: 'Agreed — a credit note will follow',
    check: 'Let’s check together',
    agreeAll: 'Agree to all lines',
    lineNote: 'Anything we should know about this line?',
    lineNotePlaceholder: 'e.g. there is a signed delivery note for 12 kg',
    creditNoteNumber: 'Credit note number, if you already have one',
    note: 'A note for the restaurant',
    notePlaceholder: 'You can leave this empty',
    submit: 'Send the answer · {count} lines',
    pickOne: 'We’d be glad of an answer on at least one line.',
    sending: 'Sending…',
    doneTitle: 'Thank you! Your answer arrived',
    doneBody:
      'We passed your answer to {restaurant}. For the lines you agreed, we look forward to the credit note; for the lines marked “Let’s check together”, we’ll get back to you.',
    empty: 'There are no open lines in this letter right now. Thank you!',
    inactiveTitle: 'This link is not active',
    inactiveBody: 'The link may have been copied only in part. You can ask the restaurant for a new one.',
    expiredBody: 'This link was active for 72 hours. You can ask the restaurant for a new one — we’d be glad of your answer.',
    rateLimited: 'There were many tries in a row. Please try again in a few minutes.',
    alreadyAnswered: 'Some lines were already answered. Refresh the page to see what is left.',
    generic: 'Something went wrong while sending. Please try again in a moment.',
    poweredBy: 'Sent with RestoMatch',
  },
};

export function claimCopy(locale: string) {
  return CLAIM_PORTAL_COPY[locale === 'en' ? 'en' : 'he'];
}

/** `{name}` interpolation; values are plain text (React escapes them). */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
