import type { BriefCopy } from './types';

const days = (n: number) => (n === 0 ? 'מהיום' : n === 1 ? 'יום אחד' : `${n} ימים`);
const hours = (n: number) => (n === 1 ? 'שעה אחת' : `${n} שעות`);
const lines = (n: number) => (n === 1 ? 'שורה אחת' : `${n} שורות`);

/**
 * Hebrew copy. Glossary 7.11 (`docs/ux/terms/GLOSSARY.md` §1–§2): "בקשת זיכוי",
 * "בלי תשובה 7+ ימים"; never דרישה / תביעה / מחלוקת / חוב / דליפה; late DELIVERIES
 * keep "מאחר". The supplier draft asks, it does not demand.
 */
export const he: BriefCopy = {
  receiverMorning: {
    subject: (n) => (n === 1 ? 'בוקר טוב · היום צפוי משלוח אחד' : `בוקר טוב · היום צפויים ${n} משלוחים`),
    heading: 'המשלוחים של היום',
    delivery: (s, t, l) => `${s} ${t ? `~${t}` : '(ללא שעה)'} (${lines(l)})`,
    lead: (n) => (n === 1 ? 'בוקר טוב · היום צפוי משלוח אחד:' : `בוקר טוב · היום צפויים ${n} משלוחים:`),
    cta: 'לקבלת סחורה',
  },
  evening: {
    subject: (n) => (n === 1 ? 'לסיום היום · דבר אחד מחכה לך' : `לסיום היום · ${n} דברים מחכים לך`),
    heading: 'מה מחכה לך לפני מחר',
    awaiting: (n, ils, d) => `מחכות להחלטה שלך: ${n} · ${ils} · הוותיקה ביותר ${days(d)}`,
    dueSoonHeld: (n) => `חשבוניות לתשלום תוך יומיים שעדיין בהשהיה: ${n}`,
    openReceiptsToday: (n) => `קבלות סחורה פתוחות מהיום: ${n}`,
    noReplyClaims: (n, ils) => `בקשות זיכוי בלי תשובה 7+ ימים: ${n} · ${ils}`,
    intake: (n, h) => `מסמכים ממתינים לבדיקה: ${n} · הוותיק ${hours(h)}`,
    open: 'פתיחה',
  },
  lateTruck: {
    managerSubject: (s) => `המשלוח מ${s} עדיין לא הגיע`,
    managerLine: (s, ref, d, late, l) =>
      `ההזמנה ${ref} מ${s} תוכננה ל-${d} ועדיין לא הגיעה (${days(late)}, ${lines(l)}).`,
    sendToSupplier: 'שלחו לספק:',
    whatsapp: 'וואטסאפ',
    email: 'מייל',
    noContact: 'אין פרטי קשר לספק · הוסיפו בכרטיס הספק',
    openPo: 'צפייה בהזמנה',
    supplierText: (s, ref, d, r) =>
      `שלום ${s}, ההזמנה ${ref} שתוכננה ל-${d} עדיין לא הגיעה. מתי צפוי המשלוח? תודה, ${r}`,
    supplierSubject: (ref) => `ההזמנה ${ref}: מתי צפוי המשלוח?`,
    receiverSubject: (s) => `המשלוח מ${s} מאחר`,
    receiverLine: (s, d) => `המשלוח מ${s} מאחר (תוכנן ל-${d}). ההנהלה מטפלת מול הספק.`,
    receiverCta: 'לקבלת סחורה',
  },
  matchAlert: {
    subject: (n, s) => (n === 1 ? `פער חדש בחשבונית של ${s}` : `${n} פערים חדשים בחשבונית של ${s}`),
    line: (n, ref, s) =>
      n === 1 ? `נמצא פער חדש בחשבונית ${ref} של ${s}.` : `נמצאו ${n} פערים חדשים בחשבונית ${ref} של ${s}.`,
    ils: (ils) => `אפשר לבקש זיכוי: ${ils}`,
    cta: 'לבדיקת החשבונית',
  },
};
