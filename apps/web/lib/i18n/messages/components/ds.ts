import type { Shape } from '../../translate';

/**
 * Design-system v2 strings (W1-01) — merged into the 'components' namespace as
 * `ds.*` by ./index.ts. Kept apart from ./he.ts so the complete receiver-locale
 * overlays of ./he.ts keep type-checking; receiver locales fall back to English.
 */
export const dsHe = {
  money: {
    unavailable: 'לא זמין · נסו שוב',
    pending: 'ממתין',
    na: 'לא רלוונטי',
    exact: 'סכום מדויק: {amount}',
    credit: 'זיכוי',
  },
  delta: { up: 'עלייה', down: 'ירידה', same: 'ללא שינוי' },
  priceMove: { label: 'המחיר השתנה מ-{from} ל-{to}' },
  token: { copy: 'העתקת המספר {value}', copied: 'הועתק' },
  deadline: {
    late: '{days, plural, one {באיחור של יום} two {באיחור של יומיים} other {באיחור של # ימים}} · מ-{date}',
    today: 'היום האחרון · {date}',
    left: '{days, plural, one {נותר יום אחד} two {נותרו יומיים} other {נותרו # ימים}} · עד {date}',
  },
  banner: { dismiss: 'סגירת ההודעה' },
  emptyState: { clearFilters: 'ניקוי הסינון', retry: 'ניסיון נוסף' },
  button: { done: 'בוצע' },
  rowActions: { more: 'פעולות נוספות' },
  field: { optional: '(רשות)' },
  moneyInput: { invalid: 'רק מספרים, למשל 7,5 או 1,250.50' },
  quantity: { decrease: 'הפחתה', increase: 'הוספה', invalid: 'רק מספרים, למשל 2.5' },
  dateField: {
    placeholder: 'יום.חודש.שנה',
    invalid: 'תאריך בצורה יום.חודש.שנה, למשל 25.10.2026',
    open: 'בחירת תאריך מלוח השנה',
    prev: 'החודש הקודם',
    next: 'החודש הבא',
    today: 'היום',
  },
  steps: { progress: 'שלב {current} מתוך {total}', done: 'הושלם' },
  filterChip: { remove: 'הסרת הסינון {label}' },
  sheet: { close: 'סגירה', resize: 'שינוי גובה החלונית' },
  keypad: {
    backspace: 'מחיקת ספרה',
    confirm: 'אישור',
    ordered: 'הוזמן {qty}',
    variance: 'סטייה {pct}',
    confirmAgain: 'הסטייה גבוהה מ-{pct}. לאשר בכל זאת?',
  },
};

export const dsEn: Shape<typeof dsHe> = {
  money: {
    unavailable: 'Unavailable · try again',
    pending: 'Pending',
    na: 'Not applicable',
    exact: 'Exact amount: {amount}',
    credit: 'Credit',
  },
  delta: { up: 'Up', down: 'Down', same: 'No change' },
  priceMove: { label: 'Price moved from {from} to {to}' },
  token: { copy: 'Copy number {value}', copied: 'Copied' },
  deadline: {
    late: '{days, plural, one {# day late} other {# days late}} · since {date}',
    today: 'Last day · {date}',
    left: '{days, plural, one {# day left} other {# days left}} · until {date}',
  },
  banner: { dismiss: 'Dismiss message' },
  emptyState: { clearFilters: 'Clear filters', retry: 'Try again' },
  button: { done: 'Done' },
  rowActions: { more: 'More actions' },
  field: { optional: '(optional)' },
  moneyInput: { invalid: 'Numbers only, e.g. 7.5 or 1,250.50' },
  quantity: { decrease: 'Decrease', increase: 'Increase', invalid: 'Numbers only, e.g. 2.5' },
  dateField: {
    placeholder: 'dd.mm.yyyy',
    invalid: 'Use day.month.year, e.g. 25.10.2026',
    open: 'Pick a date from the calendar',
    prev: 'Previous month',
    next: 'Next month',
    today: 'Today',
  },
  steps: { progress: 'Step {current} of {total}', done: 'Completed' },
  filterChip: { remove: 'Remove filter {label}' },
  sheet: { close: 'Close', resize: 'Resize panel' },
  keypad: {
    backspace: 'Delete digit',
    confirm: 'Confirm',
    ordered: 'Ordered {qty}',
    variance: 'Variance {pct}',
    confirmAgain: 'Variance is above {pct}. Confirm anyway?',
  },
};
