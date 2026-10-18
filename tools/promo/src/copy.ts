// Every on-screen string, per locale. Every NUMBER here is traceable — see
// STORYBOARD.md §Sources. Demo figures come from the seeded demo tenant
// "כפר הזיתים" (scripts/dev-setup.sh → seed-demo log + the live /dashboard hero),
// month = October 2026. Change copy here; layout reads it.

export type Locale = 'he' | 'en';

/** Facts shown on screen (seeded demo tenant, dashboard hero, Oct 2026). */
export const FACTS = {
  leak: 572, // "דלף החודש" — owner.leakHero
  spend: 28389, // pre-VAT checked spend this month
  leakPct: '2.0%', // 572 / 28,389 = 2.01%
  caught: 296, // "נתפס לפני תשלום" — leak on unpaid invoices
  claimed: 276, // "נדרש מהספקים" — accepted to claim back
  flagged: 9, // invoices with a leak
  checked: 24, // checked invoices (dashboard "9 מתוך 24")
  beerFrom: 520, // leak detective: beer keg baseline ₪520.00
  beerTo: 575, // last price ₪575.00 (+10.6%)
  pilotTarget: '1.5%', // North Star / pilot target (docs/ICP.md, AGENTS.md)
} as const;

export const SITE = 'restomatch.co.il'; // placeholder — final domain TBD (canonical = APP_URL)

const he = {
  hook: {
    l1: 'כמה כסף',
    l2: 'דלף לך',
    l3: 'החודש?',
    sub: 'רוב בעלי המסעדות לא יודעים לענות.',
    tag: 'מסעדת הדגמה · אוקטובר 2026',
  },
  problem: {
    t1: 'עשרות משלוחים בשבוע.',
    t2: 'חשבונית לכל אחד.',
    t3: 'ואף אחד לא משווה שורה מול שורה.',
    stampPrice: 'מחיר עלה +10.6%',
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
    heroSub: 'כמה דלף החודש — ומה עוד אפשר לעצור.',
    chipLeak: 'דלף החודש',
    chipPct: 'מהרכש',
    chipCaught: 'נתפס לפני תשלום',
    heatTitle: 'בלש הדליפות',
    heatSub: 'איפה המחיר מזחל, ומי מקצר משלוחים.',
    chipBeer: 'בירה מהחבית: ₪520 ← ₪575',
    apprTitle: 'עוצרים לפני התשלום',
    apprSub: 'כל פער מגיע לאדם הנכון — מאשרים, דוחים, או דורשים זיכוי.',
    chipAppr: '5 ממתינות לאישור',
    claimTitle: 'מכתב דרישת זיכוי',
    claimSub: 'מכתב לכל ספק, מוכן להדפסה — בלחיצה.',
    chipClaim: 'נדרש מהספקים',
    realUi: 'מסך אמיתי · נתוני הדגמה',
  },
  receiver: {
    badge: 'חדש · פיצ׳ר הדגל',
    title: 'מקבל הסחורה לא קורא עברית?',
    title2: 'לא בעיה.',
    sub: 'החשבונית בעברית — העובד ברציף רואה את השורות והמוצרים באנגלית, ובודק את המשלוח בעצמו.',
    paper: 'חשבונית ספק · ירקות השרון',
    phoneCaption: 'Receiver in English',
  },
  chains: {
    title: 'רשתות וסניפים',
    sub: 'כל הסניפים במסך אחד — איפה הכסף דולף.',
    concept: 'קונספט עיצובי · בפיתוח',
    branches: ['סניף מרכז', 'סניף צפון', 'סניף דרום', 'סניף שרון'],
    col: 'דליפה מהרכש',
  },
  value: {
    eyebrow: 'מסעדת ההדגמה · אוקטובר 2026',
    leak: 'דלף החודש',
    leakNote: `${FACTS.leakPct} מתוך ₪28,389 רכש`,
    caught: 'נתפס לפני תשלום',
    caughtNote: 'על חשבוניות שעוד לא שולמו',
    claimed: 'נדרש מהספקים',
    claimedNote: 'חריגות שאושרו לדרישה',
    calm: 'בלי לשנות את העבודה היומיומית.',
    steps: ['מצלמים את החשבונית', 'המערכת משווה שורה מול שורה', 'מאשרים — לפני התשלום'],
  },
  cta: {
    tagline: 'המספר שכל בעל מסעדה צריך',
    action: 'תאמו הדגמה קצרה',
    url: SITE,
  },
  loop: { chip: 'נתוני הדגמה' },
};

const en: typeof he = {
  hook: {
    l1: 'How much',
    l2: 'money leaked',
    l3: 'this month?',
    sub: 'Most restaurant owners can’t answer.',
    tag: 'Demo restaurant · October 2026',
  },
  problem: {
    t1: 'Dozens of deliveries a week.',
    t2: 'An invoice for each one.',
    t3: 'And nobody checks them line by line.',
    stampPrice: 'Price up +10.6%',
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
    heroSub: 'What leaked this month — and what you can still stop.',
    chipLeak: 'Leaked this month',
    chipPct: 'of food spend',
    chipCaught: 'Caught before payment',
    heatTitle: 'Leak detective',
    heatSub: 'Where prices creep, and who short-delivers.',
    chipBeer: 'Draft beer keg: ₪520 → ₪575',
    apprTitle: 'Stop it before you pay',
    apprSub: 'Every gap goes to the right person — approve, reject, or claim a credit.',
    chipAppr: '5 waiting for approval',
    claimTitle: 'Credit-request letters',
    claimSub: 'One letter per supplier, ready to print — in one click.',
    chipClaim: 'Claimed from suppliers',
    realUi: 'Real screen · demo data',
  },
  receiver: {
    badge: 'New · flagship feature',
    title: 'Your receiver can’t read Hebrew?',
    title2: 'No problem.',
    sub: 'The invoice is in Hebrew — the worker at the back door sees every line and product in English, and checks the delivery themselves.',
    paper: 'Supplier invoice · HaSharon Produce',
    phoneCaption: 'Receiver in English',
  },
  chains: {
    title: 'Chains & branches',
    sub: 'Every branch on one screen — see where money leaks.',
    concept: 'Design concept · in development',
    branches: ['Central', 'North', 'South', 'Sharon'],
    col: 'Leak of spend',
  },
  value: {
    eyebrow: 'Demo restaurant · October 2026',
    leak: 'Leaked this month',
    leakNote: `${FACTS.leakPct} of ₪28,389 food spend`,
    caught: 'Caught before payment',
    caughtNote: 'on invoices not yet paid',
    claimed: 'Claimed from suppliers',
    claimedNote: 'gaps approved for a credit request',
    calm: 'Without changing your daily routine.',
    steps: ['Snap the invoice', 'It’s checked line by line', 'Approve — before you pay'],
  },
  cta: {
    tagline: 'The number every restaurant owner needs',
    action: 'Book a short demo',
    url: SITE,
  },
  loop: { chip: 'Demo data' },
};

export const COPY = { he, en };
export type Copy = typeof he;

/** Hebrew invoice line → English, exactly as the app showed them (public/shots/reconcile-en.png, HaSharon Produce). */
export const LINES: { he: string; en: string; qty: string; qtyEn: string; price: string; flag?: 'price' | 'qty' }[] = [
  { he: 'עגבניות שרי', en: 'Cherry tomatoes', qty: '15 ק״ג', qtyEn: '15 kg', price: '₪14.00', flag: 'price' },
  { he: 'כוסברה', en: 'Coriander', qty: '10 צרור', qtyEn: '10 bunch', price: '₪3.01', flag: 'qty' },
  { he: 'חסה ערבית', en: 'Romaine lettuce', qty: '20 יח׳', qtyEn: '20 unit', price: '₪4.50' },
  { he: 'מלפפונים', en: 'Cucumbers', qty: '12 ק״ג', qtyEn: '12 kg', price: '₪5.87' },
];
