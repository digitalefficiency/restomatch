/**
 * 'invoices' namespace (Hebrew — source of truth).
 * Owner: S2 invoice pipeline — invoice detail / correction pages.
 */
export const he = {
  correction: {
    title: 'תיקון חשבונית',
    subtitle:
      'תקנו ערכים שזוהו שגוי ב-OCR (כמות / מחיר / סכום) והריצו התאמה מחדש — מספר הדליפה מחושב מהשורות האלה.',
    details: 'פרטי החשבונית',
    supplier: 'ספק',
    viewScan: 'צפה בסריקה',
    rerun: 'הרץ התאמה מחדש',
    leak: 'דליפה:',
    discrepancies: '{count} חריגות',
    noMatchingPo: 'ללא הזמנה תואמת',
    number: 'מספר חשבונית',
    date: 'תאריך',
    exclVat: 'סכום לפני מע״מ (₪)',
    vat: 'מע״מ (₪)',
    inclVat: 'סכום כולל מע״מ (₪)',
    saveDetails: 'שמור פרטים',
    colDescription: 'תיאור',
    colQty: 'כמות',
    colUnit: 'יחידה',
    colUnitPrice: 'מחיר יח׳',
    colLineTotal: 'סה״כ שורה',
    save: 'שמור',
    edit: 'ערוך',
    cancel: 'ביטול',
    noLines: 'אין שורות בחשבונית זו.',
    rerunHint: 'אחרי תיקון שורות או סכומים — הריצו "התאמה מחדש" כדי לחשב מחדש את החריגות ואת מספר הדליפה.',
    savedHeader: 'פרטי החשבונית נשמרו.',
    savedLine: 'השורה נשמרה.',
    failed: 'הפעולה נכשלה.',
    ocrFailed: 'לא הצלחנו לקרוא את החשבונית אוטומטית. הזינו את הסכומים והשורות ידנית, או צלמו אותה שוב מקליטת הסחורה.',
    ocrQuota: 'מכסת סריקות החשבוניות לחודש הסתיימה, ולכן החשבונית לא נקראה אוטומטית. אפשר להזין את הנתונים ידנית.',
    ocrPending: 'החשבונית עדיין בקריאה. רעננו את העמוד בעוד דקה.',
    showHebrew: 'הצג מקור בעברית',
  },
  status: {
    clean: 'נקי — אין חריגות',
    minor: 'חריגות קלות',
    major: 'חריגות חמורות',
    blocked: 'נחסם',
  },
};
