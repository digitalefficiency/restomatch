/**
 * 'accounting' namespace (Hebrew — source of truth).
 * Owner: S5 operations UI — bookkeeper exports (CSV / uniform file 1000).
 */
export const he = {
  title: 'ייצואים להנהלת חשבונות',
  subtitle:
    'ייצוא חשבוניות שאושרו במערכת לקבצים מובנים — CSV לגיליונות, או "קובץ אחיד" (1000) להעלאה ישירה לתוכנת הנהלת החשבונות.',
  range: 'טווח תאריכים',
  from: 'מתאריך',
  to: 'עד תאריך',
  presets: {
    label: 'טווחים מהירים',
    thisMonth: 'החודש',
    lastMonth: 'החודש הקודם',
    last30: '30 הימים האחרונים',
    thisYear: 'השנה',
  },
  rangeInvalid: 'תאריך ההתחלה מאוחר מתאריך הסיום.',
  rangeMissing: 'בחרו תאריך התחלה וסיום.',
  csv: {
    title: 'CSV',
    body: 'לגיליונות Excel / Google Sheets (נפתח נכון בעברית)',
    button: 'הורדת CSV',
  },
  uniform: {
    title: 'קובץ אחיד (1000)',
    body: 'להעלאה לתוכנת הנהלת החשבונות / רשויות המס',
    button: 'הורדת קובץ אחיד',
  },
  downloaded: 'הקובץ ירד — {count} חשבוניות.',
  downloadedEmpty: 'אין חשבוניות מאושרות בטווח הזה. הקובץ ירד ריק (כותרות בלבד).',
  failed: 'ההורדה נכשלה.',
  note: 'נכללות רק חשבוניות בסטטוס "הותאמה", "אושרה" או "שולמה". חשבוניות עם חריגות פתוחות לא יופיעו.',
};
