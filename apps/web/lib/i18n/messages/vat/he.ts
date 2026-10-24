/**
 * 'vat' namespace (Hebrew — source of truth).
 * Owner: S13 — VAT at risk (flag vatAtRisk): tax invoices without an allocation number.
 */
export const he = {
  card: {
    title: 'מע״מ בסיכון — חשבוניות ללא מספר הקצאה',
    subtitle:
      'חשבונית מס מעל {threshold} לפני מע״מ בלי מספר הקצאה — אי אפשר לקזז את המע״מ שלה. יש 6 חודשים מתאריך החשבונית לקבל חשבונית מתוקנת.',
    count: '{count} חשבוניות',
    countOne: 'חשבונית אחת',
    amountLabel: 'מע״מ שלא יקוזז',
    separate: 'נפרד מהדליפה — זה מע״מ, לא פער מול הספק.',
    cta: 'בקשו מהספק חשבונית עם מספר הקצאה',
    clear: 'כל החשבוניות מעל {threshold} כוללות מספר הקצאה ✓',
    clearHint: 'נבדקו חשבוניות המס שעדיין אפשר לקזז (6 החודשים האחרונים).',
    more: 'ועוד {count} חשבוניות',
    noNumber: 'ללא מספר הקצאה',
    badNumber: 'מספר הקצאה לא תקין',
    invoiceNo: 'חשבונית {number}',
    noInvoiceNo: 'חשבונית ללא מספר',
    daysLeft: 'נותרו {days} ימים לקיזוז',
    lastDay: 'היום אחרון לקיזוז',
  },
  request: {
    title: 'בקשה לספק',
    hint: 'העתיקו ושלחו לספק בוואטסאפ או במייל. המערכת לא שולחת דבר.',
    copy: 'העתקת הנוסח',
    copied: 'הועתק ✓',
    close: 'סגירה',
  },
  invoice: {
    badge: 'מע״מ בסיכון: {amount}',
    missing: 'חסר מספר הקצאה — אי אפשר לקזז את המע״מ.',
    invalid: 'מספר ההקצאה בחשבונית לא תקין — אי אפשר לקזז את המע״מ.',
    deadline: 'אפשר לקזז עד {date} אם תתקבל חשבונית מתוקנת.',
    closed: 'חלון הקיזוז (6 חודשים) נסגר ב-{date}.',
  },
} as const;
