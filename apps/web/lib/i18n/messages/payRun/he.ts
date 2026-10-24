/**
 * Pay run (/dashboard/approvals/pay-run, flag payRun). Owner: S8.
 * "לא סומנה כשולמה" — the app has no payment rail; status is what the team marked.
 */
export const he = {
  title: 'ריצת תשלומים',
  subtitle: 'החשבוניות של {month} שנבדקו ולא סומנו כשולמו — מה אפשר לשלם, מה להשהות ועל מה לבקש זיכוי.',
  open: 'ריצת תשלומים',
  month: {
    this: 'החודש',
    last: 'חודש קודם',
    label: 'חודש',
  },
  status: {
    pay: 'ניתן לשלם',
    hold: 'להשהות — ממתין להחלטה',
    holdLink: 'להשהות — ממתינה לשיוך להזמנה',
    holdDuplicate: 'להשהות — עותק כפול, לא לשלם',
    claim: 'לבקש זיכוי {amount}',
  },
  kpis: {
    pay: 'ניתן לשלם',
    payHint: '{count} חשבוניות · סכומי חשבונית כולל מע״מ',
    hold: 'להשהות',
    holdHint: '{count} חשבוניות ממתינות להחלטה · כולל מע״מ',
    credit: 'זיכויים לבקש',
    creditHint: 'מחריגות שאישרת לדרישה · הבסיס של כל סכום מצוין לידו',
  },
  table: {
    invoice: 'חשבונית',
    date: 'תאריך',
    total: 'סכום החשבונית',
    totalBasis: 'כולל מע״מ',
    status: 'סטטוס',
    action: 'פעולה',
    pending: 'ממתין להחלטה: {amount}',
    toApprovals: 'לתור האישורים',
    openInvoice: 'פתח חשבונית',
  },
  supplier: {
    subtotal: 'ביניים לספק',
    pay: 'לתשלום: {amount}',
    hold: 'בהשהיה: {amount}',
    claim: 'עם זיכוי: {amount}',
    credit: 'זיכוי לבקש: {amount}',
  },
  basis: {
    excl: 'לפני מע״מ',
    incl: 'כולל מע״מ',
    vat: 'סכום המע״מ',
  },
  csv: {
    button: 'ייצוא CSV להנהלת חשבונות',
    file: 'ריצת-תשלומים-{month}',
    supplier: 'ספק',
    invoice: 'מספר חשבונית',
    date: 'תאריך',
    total: 'סכום החשבונית (כולל מע״מ)',
    status: 'סטטוס',
    credit: 'זיכוי לבקש',
    creditBasis: 'בסיס הזיכוי',
    pending: 'ממתין להחלטה',
  },
  note: 'סטטוס התשלום הוא מה שסומן במערכת — RestoMatch לא מבצעת תשלומים. סכומי הזיכוי זהים למכתבי דרישת הזיכוי של אותו חודש.',
  letters: 'מכתבי דרישת זיכוי',
  empty: 'אין חשבוניות שנבדקו ולא סומנו כשולמו ב{month}.',
  disabled: 'ריצת התשלומים עוד לא הופעלה למסעדה הזו.',
  mixedBasis: 'בסיסי מע״מ שונים',
};
