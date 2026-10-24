/**
 * 'approvals' namespace (Hebrew — source of truth).
 * Owner: S3 money engine — approvals queue. Also the home of the shared
 * discrepancy vocabulary (12 types, severities, statuses, routing reasons) that
 * the overview and leaks pages reuse.
 */
export const he = {
  title: 'תור אישורים',
  subtitle:
    'חריגות שמחכות להחלטה שלך. אישור = נדרוש את הכסף מהספק (נספר כחיסכון). דחייה = מוותרים, ההחלטה מתועדת.',
  empty: {
    title: 'אין חריגות בתור כרגע',
    description:
      'כל ההפרשים טופלו. חריגות חדשות יופיעו כאן ברגע שהמערכת תזהה אותן בקבלות ובחשבוניות.',
  },
  summary: {
    inQueue: 'בתור',
    atRisk: 'סכום בסיכון',
    blockers: 'חוסמים',
  },
  card: {
    estimatedLoss: 'ההפסד המוערך',
    invoice: 'חשבונית {number}',
    fixInvoice: 'פתח חשבונית / תקן OCR',
    whyFlagged: 'למה סומן?',
    expected: 'צפוי',
    actual: 'בפועל',
    threshold: 'סף',
    routing: 'ניתוב',
    reject: 'דחה',
    approve: 'אשר',
    escalate: 'העבר לבעלים',
    cancel: 'ביטול',
    confirmReject: 'אשר דחייה',
    rejectReason: 'סיבת דחייה (חובה)',
    error: 'הפעולה נכשלה. נסו שוב.',
    forbidden: 'אין לך הרשאה להחליט על חריגה זו.',
    loadMore: 'טען עוד',
  },
  severity: {
    block: 'חוסם',
    warn: 'אזהרה',
    info: 'מידע',
  },
  resolution: {
    open: 'פתוח',
    accepted: 'נדרש מהספק',
    rejected: 'ויתור',
    escalated: 'הועבר לבעלים',
    resolved: 'טופל',
  },
  types: {
    PRICE_HIGHER: {
      label: 'מחיר גבוה מהמצופה',
      explain: 'הספק חייב מחיר ליחידה גבוה מהמחיר בהזמנה או מהמחיר ההיסטורי.',
    },
    PRICE_LOWER: {
      label: 'מחיר נמוך מהמצופה',
      explain: 'הספק חייב פחות מהמצופה — לא דליפה, רק לידיעה.',
    },
    QTY_SHORT: {
      label: 'חסר בכמות שהתקבלה',
      explain: 'התקבלו פחות יחידות ממה שהוזמן.',
    },
    QTY_OVER: {
      label: 'חיוב על יותר ממה שהתקבל',
      explain: 'החשבונית מחייבת על יחידות שלא נקלטו בקבלה.',
    },
    UNORDERED_ITEM: {
      label: 'פריט בחשבונית ללא הזמנה',
      explain: 'שורה בחשבונית שאין לה שורה מקבילה בהזמנה.',
    },
    MISSING_ON_INVOICE: {
      label: 'שורת הזמנה לא חויבה',
      explain: 'פריט שהוזמן לא מופיע בחשבונית — ייתכן שיגיע בחשבונית אחרת.',
    },
    UNIT_MISMATCH: {
      label: 'אי-התאמת יחידות',
      explain: 'יחידת המידה בחשבונית שונה מזו שבהזמנה ואין המרה ביניהן.',
    },
    UNORDERED_ARRIVAL: {
      label: 'ממתינה לשיוך להזמנה',
      explain:
        'לא נמצאה הזמנה תואמת — לרוב חשבונית ריכוז או חשבונית שהגיעה מחוץ לחלון התאריכים. לא נספר כדליפה עד שיוך.',
    },
    DUPLICATE_INVOICE: {
      label: 'חשבונית כפולה',
      explain: 'מספר החשבונית כבר נקלט מאותו ספק — סכנה לתשלום כפול.',
    },
    DATE_ANOMALY: {
      label: 'תאריך חריג',
      explain: 'תאריך החשבונית רחוק ביותר משבוע ממועד האספקה הצפוי.',
    },
    VAT_MISMATCH: {
      label: 'אי-התאמת מע״מ',
      explain: 'סכום המע״מ אינו תואם את שיעור המע״מ על הסכום לפני מע״מ.',
    },
    TOTAL_MISMATCH: {
      label: 'סה״כ לא תואם לשורות',
      explain: 'סכום השורות שונה מהסה״כ המופיע בחשבונית.',
    },
  },
  tolerance: {
    price: '±{pct} מהמחיר או {amount}',
    qty: '±{pct} מהכמות או {units} יחידות',
    duplicate: 'מספר חשבונית ייחודי לכל ספק',
    date: '±{days} ימים ממועד האספקה הצפוי',
    poRequired: 'לכל חשבונית חייבת להיות הזמנה',
    unit: 'יחידת המידה חייבת להתאים בין ההזמנה לחשבונית',
    billedOverReceived: 'הכמות שחויבה עולה על הכמות שהתקבלה',
    missingLine: 'כל שורת הזמנה חייבת להופיע בחשבונית',
    unorderedLine: 'כל שורת חשבונית חייבת להתאים לשורת הזמנה',
    total: '±{amount}',
    vat: 'מע״מ {rate} על הסכום לפני מע״מ, ±{amount}',
    p90: 'מעל אחוזון 90 ההיסטורי ({amount})',
  },
  rules: {
    'duplicate-invoice': 'חשבונית כפולה — סומנה: לא לשלם עד החלטה (הנהלת חשבונות)',
    'large-invoice-without-po': 'חשבונית גדולה ללא הזמנה — אישור בעלים',
    'unordered-item-significant': 'פריט משמעותי שלא הוזמן — אישור בעלים',
    'severity-block': 'חומרה גבוהה — אישור בעלים',
    'cumulative-large': 'הפרש מצטבר גבוה בחשבונית — בעלים',
    'cumulative-medium': 'הפרש מצטבר בינוני בחשבונית — מנהל',
    'minor-info': 'הפרש זניח — אושר אוטומטית',
    fallback: 'ברירת מחדל — מנהל',
  },
};
