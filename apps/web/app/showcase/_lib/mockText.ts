import type { Locale } from '@/lib/i18n/config';

/**
 * English twins for the showcase mock data (supplier names, products, notes,
 * timeline entries…). Mock fixtures stay authored in Hebrew — their shapes are
 * shared with /scans/[invoiceId] — and the showcase UI renders them through
 * `mockText(value, locale)`, which swaps in the English twin when the viewer is
 * on `en`. UI chrome goes through the `showcase` message catalog instead.
 *
 * All names here are fictional demo data.
 */
const EN: Record<string, string> = {
  // ── Suppliers ────────────────────────────────────────────────────────────
  'ירקני אבי': "Avi's Produce",
  'קצביית הכרם': 'HaKerem Butchery',
  'דגי קובי': "Kobi's Fish",
  'מאפיית ברנס': 'Brans Bakery',
  'אלכוהול שגב': 'Shegev Liquor',
  'פאנדנגו איסוף ומחזור': 'Fandango Pickup & Recycling',
  יא: 'AP',
  קה: 'HB',
  דק: 'KF',
  מב: 'BB',
  אש: 'SL',

  // ── Supplier categories / schedules / terms ──────────────────────────────
  'ירקות ופירות': 'Fruit & vegetables',
  בשרים: 'Meat',
  'דגים וים': 'Fish & seafood',
  מאפים: 'Bakery',
  'משקאות חריפים': 'Spirits & wine',
  'א׳, ג׳, ה׳ · 06:00–08:00': 'Sun, Tue, Thu · 06:00–08:00',
  'ג׳, ה׳ · 09:00–10:30': 'Tue, Thu · 09:00–10:30',
  'ב׳, ה׳ · 11:00–12:00': 'Mon, Thu · 11:00–12:00',
  'כל יום · 06:00': 'Daily · 06:00',
  'שני · 11:00': 'Mon · 11:00',
  'שוטף +30': 'EOM + 30',
  'שוטף +45': 'EOM + 45',
  'שוטף +60': 'EOM + 60',

  // ── People ───────────────────────────────────────────────────────────────
  'יוסי כהן': 'Yossi Cohen',
  'דנה לוי': 'Dana Levi',
  'דני לוי': 'Danny Levi',
  'שי כרמי': 'Shai Karmi',
  'מאיר אזולאי': 'Meir Azoulay',
  'נועה ברק': 'Noa Barak',
  'שיינוס לוי': 'Shainos Levi',
  'רומי המנהל': 'Romi (manager)',
  מערכת: 'System',
  אוטומטי: 'Automatic',
  'נסרק ע״י יוסי כהן': 'Scanned by Yossi Cohen',
  'נסרק ע״י דנה לוי': 'Scanned by Dana Levi',
  'נסרק מטלפון': 'Captured on phone',

  // ── Restaurant (fictional) ───────────────────────────────────────────────
  'מסעדת השיפוד הזהוב': 'The Golden Skewer',

  // ── Units ────────────────────────────────────────────────────────────────
  'ק״ג': 'kg',
  'יח׳': 'pc',
  'בק׳': 'btl',
  בקבוק: 'bottle',

  // ── Products ─────────────────────────────────────────────────────────────
  'עגבניה שרי': 'Cherry tomatoes',
  מלפפון: 'Cucumbers',
  'מלפפון חממה': 'Hothouse cucumbers',
  'פלפל אדום': 'Red peppers',
  חסה: 'Lettuce',
  'חסה אייסברג': 'Iceberg lettuce',
  נענע: 'Fresh mint',
  בצל: 'Onions',
  אנטריקוט: 'Rib-eye',
  'חזה עוף': 'Chicken breast',
  'כבד עוף': 'Chicken liver',
  סלמון: 'Salmon',
  'סלמון נורווגי': 'Norwegian salmon',
  דניס: 'Sea bream',
  לחמניות: 'Bread rolls',
  'לחמניות שום': 'Garlic rolls',
  'לחם פרוס': 'Sliced bread',
  'יין אדום קברנה': 'Cabernet red wine',
  'וודקה גריי גוס': 'Grey Goose vodka',
  'תוויות מבצע': 'Promo labels',
  'גולדסטאר 0.33ל׳': 'Goldstar beer 330ml',
  'יין מרלו רקנאטי': 'Recanati Merlot',
  'וודקה אבסולוט 0.7ל׳': 'Absolut vodka 700ml',
  'פריט כללי': 'General item',

  // ── Invoice-audit line notes ─────────────────────────────────────────────
  'מחיר עלה ב-21% מהממוצע. העובד התעקש על מחיר ההזמנה.':
    'Price 21% above average. The receiver held the supplier to the order price.',
  'התקבל פחות מההזמנה. חויב על הכמות המלאה.':
    'Less arrived than was ordered, but the invoice charges the full quantity.',
  'הספק הוסיף פריט שלא הוזמן. העובד אישר את הקבלה.':
    'The supplier added an item nobody ordered. The receiver accepted it.',
  'התקבל 3.2 ק״ג בלבד. דנה תפסה — חויב על 4 ק״ג מלאים.':
    'Only 3.2 kg arrived. Dana caught it — the invoice charged the full 4 kg.',
  'מחיר עלה ב-8.2% מההזמנה. ממתין לבירור עם הספק.':
    'Price 8.2% above the order. Waiting on the supplier to explain.',
  'תוויות שיווק חינם מהספק. נרשם לתיעוד.':
    'Free marketing labels from the supplier. Logged for the record.',

  // ── Invoice-audit timeline ───────────────────────────────────────────────
  'PO #1234 הופעל לקבלה': 'PO #1234 opened for receiving',
  'צילם את החשבונית': 'Photographed the invoice',
  'צילמה את החשבונית': 'Photographed the invoice',
  'OCR בביטחון 94%': 'OCR confidence 94%',
  'זיהתה 3 חריגות': 'Found 3 variances',
  'זיהתה 2 חריגות': 'Found 2 variances',
  'זיהתה פריט לא בהזמנה': 'Found an item that was not ordered',
  'מחיר גבוה, כמות חסרה, פריט לא בהזמנה': 'Price up, short quantity, item not ordered',
  'עדכן כמות פלפל אדום': 'Corrected red pepper quantity',
  'עדכנה כמות סלמון': 'Corrected salmon quantity',
  'מ-3 ק״ג ל-2.5 ק״ג': 'From 3 kg to 2.5 kg',
  'מ-4 ל-3.2 ק״ג': 'From 4 to 3.2 kg',
  'סגר את הקבלה': 'Closed the receiving',
  'סגרה את הקבלה': 'Closed the receiving',
  '4 סטטוסים סודרו · 1 לאישור מנהל': '4 lines resolved · 1 sent for manager approval',
  'חשבונית כפולה זוהתה': 'Duplicate invoice detected',
  'INV-4882 כבר קיימת מ-12/05': 'INV-4882 already on file since 12/05',
  'תשלום נחסם אוטומטית': 'Payment blocked automatically',
  'נשלחה התראה לחשב + בעלים': 'Bookkeeper and owner alerted',
  'התאמה מלאה': 'Full match',
  '2/2 פריטים תואמים': '2/2 lines match',
  'אישר אוטומטית': 'Auto-approved',
  'כמות קצרה + מחיר גבוה': 'Short quantity + price up',
  'מחיר דניס מסומן לבירור': 'Sea bream price flagged for follow-up',
  'תוויות בעלות 0 — לא נדרשת התערבות': 'Zero-cost labels — no action needed',
  'אישר את הקבלה': 'Approved the receiving',

  // ── Supplier activity feed ───────────────────────────────────────────────
  'INV-7821 נסגרה': 'INV-7821 closed',
  'INV-7782 נסגרה': 'INV-7782 closed',
  'INV-7754 נסגרה': 'INV-7754 closed',
  'INV-4860 נסגרה': 'INV-4860 closed',
  'INV-9012 נסגרה': 'INV-9012 closed',
  'INV-2210 נסגרה': 'INV-2210 closed',
  'INV-3287 נסגרה': 'INV-3287 closed',
  'INV-3344 נסגרה עם 2 חריגות': 'INV-3344 closed with 2 variances',
  'INV-4882 חסומה — חשבונית כפולה': 'INV-4882 blocked — duplicate invoice',
  'יוסי תפס עליית מחיר עגבניות 21% · אישר ידנית':
    'Yossi caught a 21% tomato price rise · approved manually',
  'עגבניה שרי — קפיצה 21%': 'Cherry tomatoes — up 21%',
  'דניס — קפיצה 8.2%': 'Sea bream — up 8.2%',
  'מעל הממוצע ההיסטורי של 60 ימים': 'Above the 60-day historical average',
  'התאמה מלאה · 8 פריטים תאמו': 'Full match · 8 lines matched',
  'התאמה מלאה · 11 פריטים תאמו': 'Full match · 11 lines matched',
  'דיון פתוח על מחיר פלפל': 'Open dispute on pepper price',
  'הבקשה ממתינה לחזרת ספק': 'Waiting for the supplier to respond',
  '₪64 נחסכו בעקבות התאמת כמות סלמון': '₪64 saved after a salmon quantity correction',
  'אחור באספקה — 45 דק׳': 'Late delivery — 45 min',
  'הגיע ב-08:45 במקום 08:00 הצפוי': 'Arrived 08:45 instead of the expected 08:00',
  'תשלום חסום אוטומטית · ממתין לבירור': 'Payment blocked automatically · pending review',
  'דנה תפסה כמות חסרה בסלמון · ₪156 נחסכו': 'Dana caught a salmon shortfall · ₪156 saved',
  'גולדסטאר עלה ב-6.7%': 'Goldstar up 6.7%',
  'מ-₪4.5 ל-₪4.8 בקבוק. בדוק מול הסכם.': 'From ₪4.5 to ₪4.8 a bottle. Check against the agreement.',
  'יוסי תיקן 8 בקבוקים יין שלא הגיעו': 'Yossi corrected 8 bottles of wine that never arrived',
  'מחלוקת על חוסר במשלוח': 'Dispute over a short delivery',
  'חסרו 4 בקבוקי וודקה — ממתינים לתגובת הספק':
    '4 bottles of vodka missing — waiting on the supplier',

  // ── Owner dashboard live feed ────────────────────────────────────────────
  'INV-4882 מקצביית הכרם — נחסמה אוטומטית': 'INV-4882 from HaKerem Butchery — blocked automatically',
  'PO #1235 התקבל מלא': 'PO #1235 received in full',
  'יוסי אישר 8 פריטים · ₪3,420': 'Yossi approved 8 items · ₪3,420',
  'חריגת מחיר ממתינה לאישור': 'Price variance awaiting approval',
  'עגבניה שרי — עלייה 21% מעל ממוצע 60 ימים': 'Cherry tomatoes — 21% above the 60-day average',
  'סנכרון Market Man': 'MarketMan sync',
  '14 הזמנות חדשות נכנסו ל-PO queue': '14 new orders added to the PO queue',
  'PO #1234 בקבלה': 'PO #1234 being received',
  'ירקני אבי — 12 פריטים בתהליך': "Avi's Produce — 12 items in progress",

  // ── Approval rules ───────────────────────────────────────────────────────
  'חשבונית כפולה': 'Duplicate invoice',
  'אותו מספר חשבונית קיים כבר במערכת לאותו ספק':
    'The same invoice number is already on file for this supplier',
  'INV-4882 ‎(קצביית הכרם) זוהה כקיים מ-2026-05-12':
    'INV-4882 (HaKerem Butchery) already on file since 2026-05-12',
  'חשבונית > ₪5,000 ללא PO': 'Invoice over ₪5,000 with no PO',
  'חשבונית גדולה שלא נמצאה הזמנת רכש תואמת': 'A large invoice with no matching purchase order',
  'הסכמת ספק שזה משלוח חירום, אישור ידני': 'Supplier confirmed an emergency delivery; approved manually',
  'פריט שלא הוזמן (> ₪100)': 'Unordered item (over ₪100)',
  'שורה בחשבונית שאין לה PO line תואם, מעל ערך ₪100':
    'An invoice line with no matching PO line, worth more than ₪100',
  'מבצע לקראת חג': 'Holiday promotion',
  'הפרש מחיר > 10%': 'Price variance over 10%',
  'מחיר חויב חרג מעל סף ה-block המוגדר': 'The billed price exceeded the configured blocking threshold',
  'דרשנו הסבר מאבי הירקן': 'We asked Avi the greengrocer for an explanation',
  'הפרש מחיר 2-5%': 'Price variance 2–5%',
  'חריגה בינונית — דרושה סקירה של מנהל משמרת': 'Moderate variance — needs a shift manager review',
  'הפרשים < 2%': 'Variances under 2%',
  'תנודה זניחה — אישור אוטומטי, רישום בלבד': 'Negligible movement — auto-approved, logged only',
};

/** Mock string in the viewer's language (English twin when locale is `en`). */
export function mockText(value: string, locale: Locale): string;
export function mockText(value: string | undefined, locale: Locale): string | undefined;
export function mockText(value: string | undefined, locale: Locale): string | undefined {
  if (value === undefined || locale === 'he') return value;
  return EN[value] ?? value;
}

/** Exposed for the parity check script / tests. */
export const MOCK_TEXT_EN: Readonly<Record<string, string>> = EN;
