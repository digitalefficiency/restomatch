/**
 * The RestoMatch glossary, as code (W2-13; spec: docs/ux/review/lens-copy-rtl.md §1).
 *
 * One concept → one Hebrew term, one English term, one short definition. The
 * definition feeds the in-place "מה זה?" popover (one sentence; anything longer
 * belongs behind a "למה?" toggle on the screen itself, not here).
 *
 * `retireHe` / `retireEn` are the strings the copy gate (`__tests__/copy-gate.test.ts`)
 * reports in user copy. `allow` lists `namespace:key.path` (or `file:<path>`)
 * entries where a retired term is deliberate, each with a reason in a comment.
 *
 * Owner terminology (binding, 31.10) wins over older spec wording:
 * חשבונית מרכזת · פער · דרישת זיכוי · קבלת סחורה · דליפה (the monthly leak
 * only) · "מחירים שעלו" (price creep). No "יעד"/1.5% target language. An
 * undecided ₪ is never "הפסד" or "חיסכון".
 */
export interface GlossaryEntry {
  readonly concept: string;
  readonly he: string;
  readonly en: string;
  /** One sentence, Hebrew, for the "מה זה?" popover. */
  readonly define: string;
  readonly retireHe: readonly string[];
  readonly retireEn: readonly string[];
  /** `namespace:dotted.key` (or `file:relative/path`) where a retired term is deliberate. */
  readonly allow: readonly string[];
}

export const GLOSSARY = [
  /* ── documents and objects ─────────────────────────────────────────── */
  {
    concept: 'purchaseOrder',
    he: 'הזמנה',
    en: 'Order',
    define: 'מה שהזמנו מהספק: פריטים, כמויות ומחיר מוסכם.',
    retireHe: ['PO', 'POs'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'deliveryNote',
    he: 'תעודת משלוח',
    en: 'Delivery note',
    define: 'המסמך שהנהג מביא עם הסחורה (בקיצור ת״מ).',
    retireHe: ['ת.מ.'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'goodsReceipt',
    he: 'קבלת סחורה',
    en: 'Receiving',
    define: 'מה שספרנו ובדקנו בדלת, מול ההזמנה.',
    retireHe: ['קליטת סחורה', 'קלוט סחורה', 'תעודת קבלה'],
    retireEn: ['goods intake'],
    allow: [],
  },
  {
    concept: 'consolidatedInvoice',
    he: 'חשבונית מרכזת',
    en: 'Consolidated invoice',
    define: 'חשבונית אחת שמכסה כמה תעודות משלוח.',
    retireHe: ['חשבונית ריכוז', 'חשבוניות ריכוז', 'חשבונית הריכוז'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'creditInvoice',
    he: 'חשבונית זיכוי',
    en: 'Credit note',
    define: 'המסמך שהספק מוציא כשהוא מזכה אתכם.',
    retireHe: ['תעודת זיכוי'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'usualPrice',
    he: 'המחיר הרגיל',
    en: 'Usual price',
    define: 'החציון של מה ששילמתם לספק על הפריט בתקופה האחרונה.',
    retireHe: ['מחיר חציוני'],
    retireEn: [],
    allow: [],
  },
  /* ── money words: the ₪ story ──────────────────────────────────────── */
  {
    concept: 'leak',
    he: 'דליפה',
    en: 'Leak',
    define: 'כסף שחויב ביתר בחשבוניות שנבדקו החודש, לפני מע״מ.',
    retireHe: ['דלף', 'הפסד פוטנציאלי', 'הפסד', 'ההפסד המוערך', 'חיסכון', 'נחסכו', 'נחסך', 'בלש הדליפות'],
    retireEn: ['potential loss', 'savings'],
    allow: [],
  },
  {
    concept: 'leakBase',
    he: 'מהרכש שנבדק',
    en: 'of checked spend',
    define: 'סכום החשבוניות שנבדקו מול הזמנה, לפני מע״מ.',
    retireHe: ['ההוצאה על סחורה', 'ההוצאה שנבדקה', 'רכש נבדק', 'מההוצאה'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'priceCreep',
    he: 'מחירים שעלו',
    en: 'Price rises',
    define: 'פריטים שהמחיר שלהם עלה מעל המחיר הרגיל.',
    retireHe: ['זחילת מחירים', 'דליפות מחיר', 'מוקדי זחילה'],
    retireEn: ['price creep'],
    allow: [],
  },
  {
    concept: 'discrepancy',
    he: 'פער',
    en: 'Discrepancy',
    define: 'שורה שבה החשבונית לא תואמת להזמנה או לקבלת הסחורה.',
    retireHe: ['חריגה', 'חריגות', 'הפרש', 'הפרשים', 'ממצא', 'ממצאים'],
    retireEn: ['finding'],
    allow: [],
  },
  {
    concept: 'severity',
    he: 'חוסם · אזהרה · לידיעה',
    en: 'Blocking · Warning · FYI',
    define: 'עד כמה הפער דחוף: חוסם תשלום, דורש בדיקה, או רק לידיעה.',
    retireHe: ['חומרה גבוהה', 'חומרה בינונית'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'funnel',
    he: 'נמצא · נדרש · זוכה · הוחזר · פתוח · במחלוקת · ויתור',
    en: 'Found · Claimed · Credited · Returned · Outstanding · Disputed · Written off',
    define: 'הדרך של כל פער: מהרגע שנמצא ועד שהכסף חזר.',
    retireHe: ['חזר בפועל', 'התקבל זיכוי', 'נדרש בחזרה'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'paidAsBilled',
    he: 'שולם כפי שחויב',
    en: 'Paid as billed',
    define: 'החלטתם לא לדרוש את הפער מהספק.',
    retireHe: [],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'creditClaim',
    he: 'דרישת זיכוי',
    en: 'Credit claim',
    define: 'הבקשה לספק להחזיר את מה שחויב ביתר.',
    retireHe: ['תביעה', 'תביעות', 'לתבוע', 'בקשת זיכוי', 'לבקש זיכוי'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'overdueClaim',
    he: 'דרישת זיכוי באיחור',
    en: 'Overdue claim',
    define: 'דרישת זיכוי שלא נענתה תוך 7 ימים.',
    retireHe: ['מעל 14 יום'],
    retireEn: ['over 14 days'],
    allow: [],
  },
  {
    concept: 'vatAtRisk',
    he: 'מע״מ בסיכון',
    en: 'VAT at risk',
    define: 'מע״מ תשומות שאי אפשר לנכות בלי מסמך תקין.',
    retireHe: ['לקזז מע״מ'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'tolerance',
    he: 'סבולת',
    en: 'Tolerance',
    define: 'הסטייה שמותר לספק בלי שנסמן פער.',
    retireHe: ['סבילות'],
    retireEn: [],
    allow: [],
  },
  /* ── places, roles and system words ────────────────────────────────── */
  {
    concept: 'matching',
    he: 'התאמה',
    en: 'Match',
    define: 'בדיקת החשבונית מול ההזמנה וקבלת הסחורה, שורה אחר שורה.',
    retireHe: ['הצלבה'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'invoiceReading',
    he: 'קריאת החשבונית',
    en: 'Reading the invoice',
    define: 'המערכת קוראת את הצילום והופכת אותו לשורות.',
    retireHe: ['OCR', 'פענוח'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'roles',
    he: 'בעלים · ניהול · הנהלת חשבונות · קבלת סחורה · מטבח',
    en: 'Owner · Manager · Bookkeeper · Receiver · Chef',
    define: 'מי עושה מה במערכת.',
    retireHe: ['מנהל/ת', 'חשב/ת'],
    retireEn: [],
    allow: [],
  },
  {
    concept: 'email',
    he: 'מייל',
    en: 'Email',
    define: 'כתובת המייל שאליה נשלחות ההתראות.',
    retireHe: ['אימייל'],
    retireEn: [],
    allow: [],
  },
] as const satisfies readonly GlossaryEntry[];

/** Abbreviations that must use gershayim (U+05F4), never ASCII quotes. */
export const GERSHAYIM_ABBREVIATIONS = ['ת״מ', 'ח״פ', 'דוא״ל', 'מע״מ', 'ק״ג', 'מ״ל', 'סה״כ', 'מק״ט', 'בע״מ'] as const;

/** Look up a concept (for "מה זה?" popovers). */
export function glossaryEntry(concept: (typeof GLOSSARY)[number]['concept']): GlossaryEntry {
  return GLOSSARY.find((g) => g.concept === concept)!;
}
