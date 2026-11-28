/**
 * Fixed Hebrew copy of the WhatsApp agent (WA-02). Every string the agent can
 * send without the model lives here. Partner wording toward suppliers
 * (GLOSSARY §1–§2): "בקשת זיכוי", never a demand or a dispute.
 */
export const HE = {
  /** Closed intents (design §A.3): the fixed refusal for anything off-list. */
  offList: (restaurant: string) =>
    `אני עוזר רק בענייני חשבוניות, הזמנות, משלוחים ובקשות זיכוי של ${restaurant}. לכל השאר: האפליקציה או "אדם".`,
  /** A tap before WA-07's token handler exists. */
  actionSoon: 'הפעולה תהיה זמינה בקרוב',
  /** Media goes to ingest (WA-05ʰ); never to the model. */
  mediaReceived: 'קיבלתי את הקובץ. הוא יעבור לקליטת חשבוניות ויופיע באפליקציה.',
  unsupported: 'אני מבין רק הודעות טקסט, תמונות ומסמכים. לכל השאר: האפליקציה.',
  help:
    'אפשר לשאול על: החלטות שמחכות לך, דליפה לפי ספק או חודש, בקשות זיכוי, הזמנות, משלוחים של היום ומע"מ בסיכון. ' +
    'פקודות: "עצור" · "אדם" · "עזרה" · "החלף מסעדה" · "החלף תפקיד".',
  human: 'העברתי את הבקשה לאדם. נחזור אליך בהקדם; בינתיים כל הפעולות זמינות גם באפליקציה.',
  stop: 'הבנתי. לא אשלח יותר הודעות לטלפון הזה. אפשר לחבר מחדש מההגדרות באפליקציה.',
  switchRestaurant: 'החלפת מסעדה תהיה זמינה בקרוב. בינתיים: מההגדרות באפליקציה.',
  switchRole: 'החלפת תפקיד תהיה זמינה בקרוב. בינתיים: מההגדרות באפליקציה.',
  /** Per-person day cap (WD8: 30 model turns). */
  budgetPerson: 'הגעתם למכסת השאלות להיום. הכפתורים ממשיכים לעבוד.',
  budgetRestaurant: 'המסעדה הגיעה למכסת השאלות להיום. הכפתורים ממשיכים לעבוד.',
  /** A second message while the first is still being answered. */
  busy: 'אני עוד עונה על ההודעה הקודמת. רגע אחד.',
  off: 'העוזר בוואטסאפ כבוי במסעדה הזו. הכול זמין באפליקציה.',
  roleNotYet: 'העוזר בוואטסאפ עדיין לא זמין לתפקיד שלך. הכול זמין באפליקציה.',
  noData: 'לא מצאתי נתונים שעונים על זה. כדאי לבדוק באפליקציה.',
  factsPrefix: 'לפי הנתונים:',
  supplierNotFound: 'לא מצאתי ספק בשם הזה',
  noSupplierLeak: (supplier: string) => `אין דליפה פתוחה מול ${supplier} החודש.`,
  supplierLeak: (supplier: string, money: string, lines: number) =>
    `הדליפה הפתוחה מול ${supplier} החודש: ${money} (${lines} שורות).`,
  linkLabel: 'לפרטים:',
} as const;

/** Hebrew names of the screens a citation or a link points to. */
export const SCREEN_HE: Record<string, string> = {
  overview: 'סקירה',
  leaks: 'דליפות',
  report: 'דוח החודש',
  breakdown: 'פירוט הדליפה',
  claims: 'בקשות זיכוי',
  invoice: 'חשבונית',
  supplier: 'ספק',
  approvals: 'החלטות',
  orders: 'הזמנות',
  receiving: 'קבלת סחורה',
  vat: 'מע"מ בסיכון',
  payRun: 'ריצת תשלומים',
  recovery: 'בקשות זיכוי',
};

/** The commands the deterministic router answers without the model. */
export const COMMANDS = ['עצור', 'אדם', 'עזרה', 'החלף מסעדה', 'החלף תפקיד'] as const;
export type AgentCommand = (typeof COMMANDS)[number];
