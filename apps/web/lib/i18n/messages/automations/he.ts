/**
 * 'automations' namespace (Hebrew — source of truth).
 * Owner: AU-01 — the owner's "אוטומציות" page (/dashboard/settings/automations)
 * and the admin console's read-only list. Copy never promises ₪ and never names a
 * target percentage; toward suppliers it says "בקשת זיכוי" (GLOSSARY §1–§2).
 */
export const he = {
  page: {
    title: 'אוטומציות',
    subtitle: 'מה רץ אצלכם, מתי ולמי, וכל שינוי נרשם ביומן.',
    readOnly: 'רק הבעלים יכולים להפעיל או לכבות.',
    forbiddenTitle: 'המסך ‘אוטומציות’ לא פתוח לתפקיד שלכם',
    forbiddenAllowed: 'המסך זמין ל: {roles}.',
    back: 'חזרה להגדרות',
    adminTitle: 'אוטומציות (קריאה בלבד)',
    adminHint: 'מה שהבעלים רואים, ודגלים משנים רק בפאנל התכונות.',
  },
  row: {
    what: 'מה זה עושה',
    when: 'מתי',
    who: 'מי מקבל',
    withIls: 'כולל סכומים ב-₪',
    noIls: 'ללא סכומים',
    lastRun: 'ריצה אחרונה: {when}',
    neverRan: 'עוד לא רץ',
    notMeasured: 'עוד לא נמדד',
    week: 'השבוע: {count}',
    on: 'פעיל',
    off: 'כבוי',
    killed: 'כבוי על ידי מנהל המערכת',
    blocked: 'לא פעיל: דורש ערוץ וואטסאפ',
    always: 'תמיד פעיל',
    adminOnly: 'מופעל על ידי צוות RestoMatch',
    switchLabel: '{name}: {state}',
  },
  confirm: {
    onTitle: 'להפעיל את ‘{name}’?',
    onBody: 'מעכשיו {roles} יקבלו את זה. הפעם הראשונה תהיה במועד הבא: {when}. שום דבר לא נשלח על העבר.',
    offTitle: 'לכבות את ‘{name}’?',
    offBody: 'מעכשיו {roles} לא יקבלו את זה. אפשר להפעיל שוב בכל רגע.',
    on: 'הפעלה',
    off: 'כיבוי',
    cancel: 'ביטול',
    saved: 'נשמר',
    killedNote: 'נשמר, אבל מנהל המערכת כיבה את זה לכולם כרגע.',
  },
  items: {
    priceAlerts: {
      name: 'התראה על עליית מחיר',
      what: 'ספק העלה מחיר של מוצר מעבר לרגיל: מייל עם המוצר, הספק והשינוי.',
      when: 'כל יום ב-07:00',
    },
    recovery: {
      name: 'תזכורת על בקשות זיכוי פתוחות',
      what: 'בקשת זיכוי שלא נסגרה אחרי 7 ימים: תזכורת עם רשימת הספקים.',
      when: 'כל יום ב-08:30',
    },
    monthlyReport: {
      name: 'דוח החודש',
      what: 'סיכום החודש שעבר: מה נמצא, מה נשלח ומה חזר.',
      when: 'ב-1 לכל חודש ב-07:45',
    },
    vatAtRisk: {
      name: 'מע״מ בסיכון',
      what: 'כרטיס בלוח הבקרה: חשבוניות מס בלי מספר הקצאה.',
      when: 'מוצג בלוח הבקרה, בלי הודעות',
    },
    orderReminders: {
      name: 'תזכורת להזמנה מספק',
      what: 'ביום ההזמנה הקבוע של ספק: תזכורת להכין הזמנה.',
      when: 'כל יום ב-09:00',
    },
    supplierDelays: {
      name: 'משלוח שמאחר',
      what: 'הזמנה שלא הגיעה בזמן: הודעה עם הספק ומספר ההזמנה.',
      when: 'כל יום ב-10:00',
    },
    eveningDigest: {
      name: 'סיכום ערב',
      what: 'מה התקבל היום, מה נבדק ומה מחכה להחלטה.',
      when: 'כל יום ב-19:00',
    },
    receiverBrief: {
      name: 'תדריך בוקר למקבל הסחורה',
      what: 'אילו משלוחים צפויים היום ומה לבדוק בקבלה.',
      when: 'כל יום ב-06:00',
    },
    matchAlerts: {
      name: 'התראה על פער בחשבונית',
      what: 'חשבונית נבדקה ונמצא פער מול ההזמנה או המחיר המוסכם.',
      when: 'ברגע שחשבונית נבדקת',
    },
    recoveryBookkeeper: {
      name: 'בקשות זיכוי גם להנהלת החשבונות',
      what: 'הנהלת החשבונות מקבלת גם את התזכורת על בקשות זיכוי פתוחות.',
      when: 'כל יום ב-08:30',
    },
    chaseAcknowledged: {
      name: 'תזכורת עדינה לספק שאישר',
      what: 'ספק אישר בקשת זיכוי ולא שלח חשבונית זיכוי: טיוטה מוכנה לשליחה.',
      when: 'כל יום ב-08:30',
    },
    orderCapture: {
      name: 'קליטת הזמנה מוואטסאפ',
      what: 'הזמנה שנשלחה בוואטסאפ נקלטת כטיוטה במערכת.',
      when: 'כשמגיעה הודעה',
    },
    priceCreepDigest: {
      name: 'סיכום עליות מחיר',
      what: 'כל עליות המחיר של אתמול במייל אחד.',
      when: 'כל יום ב-07:00',
    },
    contractExpiry: {
      name: 'מחיר מוסכם שעומד להסתיים',
      what: 'מחיר מוסכם עם ספק שמסתיים בתוך 14 יום.',
      when: 'כל יום ב-07:00',
    },
    priceListDiff: {
      name: 'שינויים במחירון ספק',
      what: 'נטען מחירון חדש: מה השתנה מול הקודם.',
      when: 'כל יום ב-07:00',
    },
  },
};
