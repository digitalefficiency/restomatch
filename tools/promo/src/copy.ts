// Every on-screen string, per locale. Every NUMBER on screen comes from the site's ONE sample month
// (sample.ts SAMPLE = apps/web/app/(marketing)/_components/sampleMonth.ts) or from its reconciled
// film breakdown (sample.ts FILM) — scripts/check-sample.mjs pins both. No demo-seed figure, no
// demo restaurant name. Terms follow apps/web/lib/i18n/glossary.ts (the w3-06 vitest scans this file).

export type Locale = 'he' | 'en';

export { SAMPLE, FILM, risePct, kegGap } from './sample';

/**
 * ₪ amount exactly as the app's formatIls renders it: he-IL "‏572 ₪" — WITH the leading RLM, so a
 * plain <bdi> resolves RTL and the glyph sits at the visual left, as on the site (Money.tsx) — and
 * en "₪572".
 */
export const ilsText = (n: number, locale: Locale, decimals = 0) => {
  const v = n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return locale === 'he' ? `\u200F${v} ₪` : `₪${v}`;
};

const he = {
  hook: {
    l1: 'כמה כסף',
    l2: 'דולף לכם',
    l3: 'החודש?',
    sub: 'רוב בעלי המסעדות לא יודעים לענות.',
    tag: 'דוגמה · מסעדה בדויה · אוקטובר',
  },
  problem: {
    t1: 'עשרות משלוחים בשבוע.',
    t2: 'חשבונית לכל אחד.',
    t3: 'ואף אחד לא משווה שורה מול שורה.',
    stampPrice: 'מחיר עלה {pct}',
    stampShort: 'חויב על 3 ק״ג שלא הגיעו',
    stampUnordered: 'לא הוזמן',
    suppliers: ['ירקות השרון', 'קצביית הכרם', 'משקאות שטיינברג', 'דגי הים התיכון', 'מחלבות הגליל', 'מאפיית ברנר'],
    invoice: 'חשבונית מס',
    item: 'פריט',
    qty: 'כמות',
    price: 'מחיר',
    total: 'סה״כ',
  },
  match: {
    po: 'הזמנה',
    gr: 'קבלת סחורה',
    inv: 'חשבונית',
    line: 'RestoMatch משווה כל חשבונית להזמנה ולמה שבאמת הגיע',
  },
  product: {
    heroTitle: 'מספר אחד. בשקלים.',
    heroSub: 'כמה כסף דולף החודש — ומה עוד לא שולם.',
    chipLeak: 'דליפה החודש',
    chipPct: 'מהרכש',
    chipCaught: 'נתפס לפני תשלום',
    heatTitle: 'מחירים שעלו',
    heatSub: 'איזה מחיר עלה מעל המחיר הרגיל — ואצל איזה ספק.',
    chipBeer: 'בירה מהחבית: {from} ← {to}',
    apprTitle: 'מסמנים לפני התשלום.',
    apprSub: 'כל פער מגיע לאדם הנכון — מאשרים, דוחים, או מבקשים זיכוי.',
    chipAppr: 'ממתין להחלטה שלך:',
    claimTitle: 'בקשת זיכוי לכל ספק',
    claimSub: 'מכתב מנומס לכל ספק, מוכן לשליחה — בלחיצה.',
    chipClaim: 'אושר לבקשת זיכוי:',
    chipClaimed: 'אושר לבקשת זיכוי',
    realUi: 'דוגמה · מסעדה בדויה, מספרים להמחשה',
  },
  receiver: {
    badge: 'חדש · פיצ׳ר הדגל',
    title: 'מקבל הסחורה לא קורא עברית?',
    title2: 'לא בעיה.',
    sub: 'החשבונית בעברית — העובד ברציף רואה את השורות והמוצרים באנגלית, ובודק את המשלוח בעצמו.',
    paper: 'חשבונית ספק · בעברית',
    phoneCaption: 'Receiver in English',
  },
  value: {
    eyebrow: 'דוגמה · מסעדה בדויה · אוקטובר',
    leak: 'דליפה החודש',
    leakNote: 'מתוך {spend} רכש, לפני מע״מ',
    caught: 'נתפסו לפני תשלום',
    caughtNote: 'על חשבוניות שעוד לא שולמו',
    claimed: 'בקשות זיכוי לשליחה',
    claimedNote: 'על חשבוניות ששולמו — מכתב לספק מוכן',
    calm: 'בלי לשנות את העבודה היומיומית.',
    steps: ['מצלמים את החשבונית', 'המערכת משווה שורה מול שורה', 'מאשרים — לפני התשלום'],
  },
  cta: {
    tagline: 'המספר שכל בעל מסעדה צריך',
    action: 'תאמו הדגמה קצרה',
  },
  loop: { chip: 'נתוני הדגמה' },
  sampleTag: 'דוגמה · מספרים להמחשה',
  // portrait hero loop: partner wording toward suppliers — a credit *request*, not a demand
  loopVertical: { held: 'ממתין להחלטה שלך:', claim: 'בקשת זיכוי לספק — בלחיצה' },
  // the site's showcase wording for the sample month (showcase/overview messages on W3-06)
  sample: {
    eyebrow: 'דוגמה · דליפה שזוהתה · אוקטובר',
    label: 'דליפה החודש',
    pct: '{pct} מהרכש שנבדק',
    base: 'מתוך {amount} לפני מע״מ',
    completeness: '{checked} חשבוניות נבדקו · {withGap} עם פער',
    caught: 'נתפסו לפני תשלום',
    needsTitle: 'מחכה לך',
    decide: 'ממתין להחלטה שלך',
    credit: 'בקשות זיכוי לשליחה',
    gaps: '{count} פערים',
    decideVerb: 'להחלטה',
    creditVerb: 'שליחת המכתב',
    example: 'לדוגמה: בירה מהחבית — חבית 30 ל׳',
    goodNews: '{amount} כבר אושרו לקיזוז בתשלום',
    title: 'לוח הבעלים',
  },
};

const en: typeof he = {
  hook: {
    l1: 'How much',
    l2: 'money leaked',
    l3: 'this month?',
    sub: 'Most restaurant owners can’t answer.',
    tag: 'Sample · fictional restaurant · October',
  },
  problem: {
    t1: 'Dozens of deliveries a week.',
    t2: 'An invoice for each one.',
    t3: 'And nobody checks them line by line.',
    stampPrice: 'Price up {pct}',
    stampShort: 'Billed 3 kg that never came',
    stampUnordered: 'Not ordered',
    suppliers: ['ירקות השרון', 'קצביית הכרם', 'משקאות שטיינברג', 'דגי הים התיכון', 'מחלבות הגליל', 'מאפיית ברנר'],
    invoice: 'חשבונית מס',
    item: 'פריט',
    qty: 'כמות',
    price: 'מחיר',
    total: 'סה״כ',
  },
  match: {
    po: 'Order',
    gr: 'Delivery',
    inv: 'Invoice',
    line: 'RestoMatch checks every invoice against the order and what really arrived',
  },
  product: {
    heroTitle: 'One number. In shekels.',
    heroSub: 'What leaked this month — and what’s still unpaid.',
    chipLeak: 'Leak this month',
    chipPct: '', // the callout keeps only "· 1.5%": the words overflow the chip in English
    chipCaught: 'Caught before payment',
    heatTitle: 'Price rises',
    heatSub: 'Which price rose above the usual price — and at which supplier.',
    chipBeer: 'Beer keg: {from} → {to}',
    apprTitle: 'Flag it before you pay.',
    apprSub: 'Every gap goes to the right person — approve, reject, or request a credit.',
    chipAppr: 'Awaiting your decision:',
    claimTitle: 'A credit request per supplier',
    claimSub: 'A polite letter per supplier, ready to send — in one click.',
    chipClaim: 'Approved for a credit request:',
    chipClaimed: 'Approved for a credit request',
    realUi: 'Sample · a fictional restaurant, illustrative figures',
  },
  receiver: {
    badge: 'New · flagship feature',
    title: 'Your receiver can’t read Hebrew?',
    title2: 'No problem.',
    sub: 'The invoice is in Hebrew — the worker at the back door sees every line and product in English, and checks the delivery themselves.',
    paper: 'Supplier invoice · in Hebrew',
    phoneCaption: 'Receiver in English',
  },
  value: {
    eyebrow: 'Sample · fictional restaurant · October',
    leak: 'Leak this month',
    leakNote: 'of {spend} spend, before VAT',
    caught: 'Caught before payment',
    caughtNote: 'on invoices not yet paid',
    claimed: 'Credit requests to send',
    claimedNote: 'on paid invoices — the letter is ready',
    calm: 'Without changing your daily routine.',
    steps: ['Snap the invoice', 'It’s checked line by line', 'Approve — before you pay'],
  },
  cta: {
    tagline: 'The number every restaurant owner needs',
    action: 'Book a short demo',
  },
  loop: { chip: 'Demo data' },
  sampleTag: 'Sample · illustrative figures',
  loopVertical: { held: 'Awaiting your decision:', claim: 'Credit request to the supplier — one click' },
  sample: {
    eyebrow: 'Sample · leak found · October',
    label: 'Leak this month',
    pct: '{pct} of checked spend',
    base: 'of {amount} before VAT',
    completeness: '{checked} invoices checked · {withGap} with a gap',
    caught: 'Caught before payment',
    needsTitle: 'Waiting for you',
    decide: 'Awaiting your decision',
    credit: 'Credit requests to send',
    gaps: '{count} gaps',
    decideVerb: 'Decide',
    creditVerb: 'Send the letter',
    example: 'e.g. Draft beer keg 30L',
    goodNews: '{amount} already approved for offset at payment',
    title: 'Owner dashboard',
  },
};

export const COPY = { he, en };
export type Copy = typeof he;


/**
 * The receiver beat's invoice lines (Hebrew paper → English): names and quantities only — the
 * receiver never sees ₪ (apps/web receiving UI: quantities and states). Cherry tomatoes are the
 * short line: ordered FILM.delivery.ordered, received FILM.delivery.received.
 */
type Line = { he: string; en: string; qty: string; qtyEn: string; flag?: 'qty' };
export const LINES: Line[] = [
  { he: 'עגבניות שרי', en: 'Cherry tomatoes', qty: '15 ק״ג', qtyEn: '15 kg', flag: 'qty' },
  { he: 'כוסברה', en: 'Coriander', qty: '10 צרור', qtyEn: '10 bunch' },
  { he: 'חסה ערבית', en: 'Romaine lettuce', qty: '20 יח׳', qtyEn: '20 unit' },
  { he: 'מלפפונים', en: 'Cucumbers', qty: '12 ק״ג', qtyEn: '12 kg' },
];
