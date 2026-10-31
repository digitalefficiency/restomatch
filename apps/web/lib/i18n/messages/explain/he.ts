/**
 * 'explain' namespace (Hebrew — source of truth). Owner: W2-16 (copy focus).
 *
 * One wording per explanation that repeats across screens of TWO OR MORE namespaces, plus the
 * labels of the in-place fold toggle (`<Explain>`, lib/components/Explain.tsx). An idea used by one
 * namespace only lives in that namespace as `<ns>.explain.<concept>`.
 *
 * Rules (enforced by lib/copy/__tests__/copy-budget.test.ts): ≤40 words, ≤12 words a sentence, no ₪
 * and no money placeholder (the ₪ lives on the visible, role-gated line, so every role — receiver and
 * chef too — may render any body), no "יעד", house terms only (מרכזת, פער, דרישת זיכוי, קבלת סחורה,
 * דליפה = the month's leak, "מחירים שעלו"). T4 concepts read calm and neutral.
 * Other packages request a new concept by message; they never write here.
 */
export const he = {
  /** The visible label of the fold toggle (`<ExplainToggle label>`). */
  toggle: {
    why: 'למה?',
    details: 'פרטים',
    how: 'איך חישבנו?',
  },
  // ── folds (`<Explain body>`) ──
  threeWayMatch: 'כל חשבונית נבדקת מול ההזמנה ומול קבלת הסחורה. בלי הזמנה אין מול מה לבדוק.',
  leakRule:
    'נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה", "ממתינה לשיוך להזמנה" ו"שורת הזמנה לא חויבה".',
  pendingLink: 'לרוב חשבונית מרכזת שמחכה לשיוך. עד השיוך הסכום שלה לא נכנס להוצאה שנבדקה.',
  creepHow:
    'מסומן כשהמחיר האחרון בין 10% הגבוהים אצל הספק, ולפחות 5% מעל המחיר הרגיל. העודף = (מחיר − מחיר רגיל) × כמות ב-30 יום.',
  reviewNotGap: 'שורה לבדיקה היא לא פער. סמנו אותה לפי מה שהגיע.',
  possibleDuplicate: 'מספר החשבונית כבר קיים אצל הספק. היא תיבדק לפני תשלום.',
  englishName: 'מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.',
  foodCostTwoCounts: 'עלות המזון בפועל מחושבת בין שתי ספירות.',
  // ── short shared lines and tags (rendered visible) ──
  notInLeak: 'לא חלק מהדליפה',
  capBadge: 'מוגבל לסכום החשבונית',
  caught: 'עוד אפשר לעצור לפני תשלום',
  inLetter: 'במכתב רק פערים שאושרו לדרישה ועוד לא נשלחו.',
  noSendWithoutTap: 'שום דבר לא נשלח לספק בלי לחיצה שלכם.',
  amountAfterClose: 'הסכום ייקבע אחרי סגירת קבלת הסחורה.',
  viewOnly: 'צפייה בלבד',
  leakAfterFirstMatch: 'הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה.',
  thinBase: 'מעט מדי נתונים לאחוז.',
};
