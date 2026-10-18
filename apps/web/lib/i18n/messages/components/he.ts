/**
 * 'components' namespace (Hebrew — source of truth).
 * Owner: S5 operations UI — shared lib/components (EmptyState, LoadMore, Toast, …).
 */
export const he = {
  spinner: { loading: 'טוען' },
  loadMore: { label: 'טען עוד' },
  breadcrumbs: { label: 'פירורי לחם' },
  toast: {
    region: 'הודעות',
    dismiss: 'סגירת הודעה',
  },
  errors: {
    generic: 'הפעולה נכשלה. נסו שוב.',
    network: 'אין חיבור לשרת. בדקו את החיבור ונסו שוב.',
    forbidden: 'אין לכם הרשאה לפעולה הזו.',
    notFound: 'הפריט לא נמצא — ייתכן שנמחק.',
    validation: 'חלק מהשדות אינם תקינים. בדקו ונסו שוב.',
    tooMany: 'יותר מדי ניסיונות. המתינו רגע ונסו שוב.',
  },
  entitlement: {
    features: {
      advanced_analytics: 'אנליטיקה מתקדמת',
      accounting_export: 'ייצוא להנהלת חשבונות',
      whatsapp_alerts: 'התראות וואטסאפ',
      integrations: 'אינטגרציות',
    },
    compactTitle: 'שדרגו כדי לפתוח את {feature}',
    compactBody: 'התכונה הזו זמינה במסלולים בתשלום.',
    compactCta: 'צפו במסלולים',
    title: 'שדרגו את המנוי כדי לפתוח את {feature}',
    body: '{feature} זמינה במסלולים בתשלום. שדרגו את החשבון כדי לקבל גישה מלאה.',
    cta: 'צפו במסלולים ושדרגו',
  },
  errorNotice: { title: 'משהו השתבש' },
  activity: {
    types: {
      invoice_received: 'חשבונית התקבלה',
      invoice_matched: 'חשבונית הותאמה',
      discrepancy_approved: 'חריגה אושרה',
      discrepancy_rejected: 'חריגה נדחתה',
      alias_learned: 'המערכת למדה שם מוצר',
      sync_completed: 'סנכרון הושלם',
      other: 'עדכון',
    },
    invoiceReceivedNumbered: 'חשבונית {number} התקבלה',
    consolidatedReceivedNumbered: 'חשבונית ריכוז {number} התקבלה',
    inclVat: '{amount} כולל מע״מ',
    matchesOrder: 'תואמת להזמנה ולקבלה',
    awaitingDeliveryNotes: 'ממתינה להתאמה מול תעודות המשלוח של השבוע',
    invoiceMatchedNumbered: 'חשבונית {number} הותאמה',
    discrepancyOne: 'חריגה אחת',
    discrepancies: '{count} חריגות',
    potentialLoss: 'הפסד פוטנציאלי {amount}',
    savings: 'חיסכון {amount}',
    inclVat: '{amount} כולל מע״מ',
    matchesOrderAndReceipt: 'תואמת להזמנה ולקבלה',
    awaitingMonthlyMatch: 'ממתינה להתאמה מול תעודות המשלוח של החודש',
    empty: 'עוד אין פעילות להצגה.',
  },
};
