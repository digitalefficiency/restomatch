/**
 * 'vat' namespace (Hebrew — source of truth).
 * Owner: S13 — VAT at risk (flag vatAtRisk): tax invoices without an allocation number.
 */
export const he = {
  card: {
    title: 'מע״מ בסיכון — חשבוניות ללא מספר הקצאה',
    subtitle: 'חשבונית מס מעל {threshold} בלי מספר הקצאה — אי אפשר לקזז את המע״מ. יש 6 חודשים לתקן.',
    count: '{count} חשבוניות',
    countOne: 'חשבונית אחת',
    amountLabel: 'מע״מ בסיכון',
    separate: 'לא חלק מהדליפה',
    cta: 'בקשו מהספק מספר הקצאה',
    clear: 'כל החשבוניות מעל {threshold} כוללות מספר הקצאה ✓',
    clearHint: 'נבדקו 6 החודשים האחרונים.',
    more: 'ועוד {count} חשבוניות',
    noNumber: 'ללא מספר הקצאה',
    badNumber: 'מספר הקצאה לא תקין',
    invoiceNo: 'חשבונית {number}',
    noInvoiceNo: 'חשבונית ללא מספר',
    daysLeft: 'נותרו כ-{days} ימים לניכוי',
    lastDay: 'היום האחרון לניכוי (בערך)',
  },
  request: {
    title: 'בקשה לספק',
    hint: 'העתיקו ושלחו לספק. המערכת לא שולחת דבר.',
    copy: 'העתקת הנוסח',
    copied: 'הועתק ✓',
    close: 'סגירה',
  },
  invoice: {
    badge: 'מע״מ בסיכון: {amount}',
    missing: 'חסר מספר הקצאה — אי אפשר לקזז את המע״מ.',
    invalid: 'מספר ההקצאה בחשבונית לא תקין — אי אפשר לקזז את המע״מ.',
    deadline: 'אפשר לנכות עד {date} בערך, עם חשבונית מתוקנת.',
    closed: 'חלון הניכוי נסגר בערך ב-{date}.',
  },
} as const;
