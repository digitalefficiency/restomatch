/**
 * 'team' namespace (Hebrew — source of truth).
 * Owner: S4 auth/security — team page.
 */
export const he = {
  title: 'צוות',
  subtitle: 'הזמינו עובדים, הגדירו תפקידים ושפת אפליקציה, ונהלו את הגישה למסעדה.',
  managerNote: 'כמנהל/ת אפשר לראות את הצוות ולקבוע לכל עובד את שפת האפליקציה. הזמנות ותפקידים — בידי הבעלים.',
  invite: {
    title: 'הזמנת עובד',
    subtitle: 'מנהל משמרת שמקבל סחורה — בחרו "מקבל סחורה". עובד שלא דובר עברית — בחרו שפה English. נשלח קישור הצטרפות לכתובת המייל.',
    email: 'כתובת מייל',
    role: 'תפקיד',
    language: 'שפת האפליקציה',
    submit: 'שליחת הזמנה',
    sent: 'הזמנה נשלחה ל-{email}.',
    resent: 'הזמנה נשלחה שוב ל-{email}.',
    revoked: 'ההזמנה בוטלה.',
    failed: 'שליחת ההזמנה נכשלה.',
    resendFailed: 'שליחה חוזרת נכשלה.',
    revokeFailed: 'ביטול ההזמנה נכשל.',
    copyLink: 'העתקת קישור',
    copyLinkTitle: 'העתקת קישור ההזמנה (אין ספק מייל מוגדר)',
    copied: 'הועתק',
  },
  members: {
    title: 'חברי צוות',
    you: '(את/ה)',
    roleFor: 'תפקיד עבור {email}',
    languageFor: 'שפת האפליקציה עבור {email}',
    remove: 'הסרת {email}',
    confirmRemove: 'להסיר את {email} מהצוות? הגישה שלו/ה למסעדה תיחסם.',
    roleUpdated: 'התפקיד עודכן.',
    roleFailed: 'עדכון התפקיד נכשל.',
    removed: 'החבר הוסר מהצוות.',
    removeFailed: 'הסרת החבר נכשלה.',
    localeUpdated: 'שפת האפליקציה של {email} עודכנה.',
    localeFailed: 'עדכון השפה נכשל.',
    joined: 'הצטרף/ה {date}',
  },
  language: {
    device: 'לפי המכשיר',
    he: 'עברית',
    en: 'English',
  },
  pending: {
    title: 'הזמנות ממתינות',
    validUntil: 'בתוקף עד {date}',
    resend: 'שליחה חוזרת',
    revoke: 'ביטול',
  },
  empty: {
    title: 'עדיין אין חברי צוות',
    description: 'הזמינו את העובד הראשון למעלה.',
  },
};
