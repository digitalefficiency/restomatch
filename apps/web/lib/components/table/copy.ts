import type { Locale } from '@/lib/i18n/config';

/**
 * Built-in strings for the desk primitives. They live beside the components
 * (not in an i18n namespace) because wave 1 adds no namespaces (plan §0.2.3);
 * W2-13 folds them into `components` with the copy system. Same shape in he
 * and en (parity is unit-tested). Hebrew uses plural/neutral forms.
 */
export interface DeskCopy {
  selected: (n: number) => string;
  clear: string;
  clearHint: string;
  overCap: (n: number, cap: string) => string;
  overCapDisabled: (cap: string) => string;
  unknownDisabled: string;
  plusUnknown: (n: number) => string;
  notEnforced: string;
  batchFailed: (n: number) => string;
  blockReason: string;
  selectRow: (name: string) => string;
  selectAll: string;
  totals: (n: number) => string;
  showing: (from: number, to: number, total: number) => string;
  prev: string;
  next: string;
  pager: string;
  columns: string;
  export: string;
  exportCsv: string;
  copyLink: string;
  linkCopied: string;
  print: string;
  density: string;
  densities: { compact: string; default: string; touch: string };
  sortBy: (col: string) => string;
  na: string;
  pending: string;
  unavailable: string;
  retry: string;
  loadError: string;
  noResults: string;
  clearFilters: string;
  empty: string;
  actions: string;
  more: string;
  peekTitle: string;
  close: string;
  openFull: string;
  views: string;
  exportMeta: { period: string; scope: string; filters: string; generatedAt: string; none: string };
  keysHint: string;
}

const he: DeskCopy = {
  selected: (n) => `${n} נבחרו`,
  clear: 'ניקוי',
  clearHint: 'Esc',
  overCap: (n, cap) => (n === 1 ? `שורה אחת מעל ${cap} — לטיפול פרטני` : `${n} שורות מעל ${cap} — לטיפול פרטני`),
  overCapDisabled: (cap) => `אישור מרוכז רק עד ${cap} לחשבונית — הסירו מהבחירה את השורות שמעל`,
  unknownDisabled: 'בבחירה יש שורות שהסכום שלהן עוד לא ידוע — הסירו אותן כדי לאשר במרוכז',
  plusUnknown: (n) => (n === 1 ? '+ שורה אחת ללא סכום ידוע' : `+ ${n} ללא סכום ידוע`),
  notEnforced: 'אישור מרוכז ייפתח כשהשרת יאכוף את התקרה לחשבונית',
  batchFailed: (n) => (n === 1 ? 'שורה אחת לא עודכנה ונשארה מסומנת' : `${n} שורות לא עודכנו ונשארו מסומנות`),
  blockReason: 'דורש בדיקה פרטנית',
  selectRow: (name) => `בחירת ${name}`,
  selectAll: 'בחירת כל השורות המתאימות',
  totals: (n) => (n === 1 ? 'סה״כ (שורה אחת)' : `סה״כ (${n} שורות)`),
  showing: (from, to, total) => `מוצגות ${from}–${to} מתוך ${total}`,
  prev: 'הקודם',
  next: 'הבא',
  pager: 'דפדוף',
  columns: 'עמודות',
  export: 'ייצוא',
  exportCsv: 'הורדת CSV (Excel)',
  copyLink: 'העתקת קישור לתצוגה',
  linkCopied: 'הקישור הועתק',
  print: 'הדפסה',
  density: 'צפיפות',
  densities: { compact: 'צפופה', default: 'רגילה', touch: 'מגע' },
  sortBy: (col) => `מיון לפי ${col}`,
  na: 'לא רלוונטי',
  pending: 'ממתין',
  unavailable: 'לא נטען',
  retry: 'ניסיון חוזר',
  loadError: 'הנתונים לא נטענו',
  noResults: 'אין שורות שתואמות לסינון',
  clearFilters: 'ניקוי הסינון',
  empty: 'אין עדיין שורות',
  actions: 'פעולות',
  more: 'עוד פעולות',
  peekTitle: 'תצוגה מהירה',
  close: 'סגירה',
  openFull: 'פתיחה במסך מלא',
  views: 'תצוגות',
  exportMeta: { period: 'תקופה', scope: 'היקף', filters: 'סינון', generatedAt: 'הופק', none: 'ללא' },
  keysHint: 'J/K מעבר · רווח תצוגה מהירה · X בחירה · Enter פתיחה · Esc ניקוי',
};

const en: DeskCopy = {
  selected: (n) => `${n} selected`,
  clear: 'Clear',
  clearHint: 'Esc',
  overCap: (n, cap) => (n === 1 ? `1 row above ${cap} — review it one by one` : `${n} rows above ${cap} — review them one by one`),
  overCapDisabled: (cap) => `Batch approval only up to ${cap} per invoice — remove the rows above it`,
  unknownDisabled: 'Some selected rows have no known amount yet — remove them to approve in a batch',
  plusUnknown: (n) => (n === 1 ? '+ 1 with no known amount' : `+ ${n} with no known amount`),
  notEnforced: 'Batch approval opens once the server enforces the per-invoice cap',
  batchFailed: (n) => (n === 1 ? '1 row was not updated and stays selected' : `${n} rows were not updated and stay selected`),
  blockReason: 'Needs individual review',
  selectRow: (name) => `Select ${name}`,
  selectAll: 'Select all eligible rows',
  totals: (n) => (n === 1 ? 'Total (1 row)' : `Total (${n} rows)`),
  showing: (from, to, total) => `Showing ${from}–${to} of ${total}`,
  prev: 'Previous',
  next: 'Next',
  pager: 'Pagination',
  columns: 'Columns',
  export: 'Export',
  exportCsv: 'Download CSV (Excel)',
  copyLink: 'Copy link to this view',
  linkCopied: 'Link copied',
  print: 'Print',
  density: 'Density',
  densities: { compact: 'Compact', default: 'Default', touch: 'Touch' },
  sortBy: (col) => `Sort by ${col}`,
  na: 'Not applicable',
  pending: 'Pending',
  unavailable: 'Not loaded',
  retry: 'Retry',
  loadError: 'The data did not load',
  noResults: 'No rows match the filter',
  clearFilters: 'Clear filters',
  empty: 'No rows yet',
  actions: 'Actions',
  more: 'More actions',
  peekTitle: 'Quick view',
  close: 'Close',
  openFull: 'Open full page',
  views: 'Views',
  exportMeta: { period: 'Period', scope: 'Scope', filters: 'Filters', generatedAt: 'Generated', none: 'None' },
  keysHint: 'J/K move · Space quick view · X select · Enter open · Esc clear',
};

export const DESK_COPY: Record<Locale, DeskCopy> = { he, en };

export function deskCopy(locale: Locale): DeskCopy {
  return DESK_COPY[locale] ?? he;
}
