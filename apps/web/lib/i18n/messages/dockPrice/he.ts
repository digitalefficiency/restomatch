export const he = {
  /** Muted sub-line on a price-higher line at the dock / on the invoice: "<usual> ₪8.50 <window>". */
  usual: 'המחיר הרגיל שלך:',
  /** H-11: the same hint for a role without ₪, no price. */
  higher: 'מחיר גבוה מהרגיל',
  window: '({days} יום)',
  title: 'החציון של מה ששילמת לספק הזה על הפריט ב-{days} הימים האחרונים ({count} חשבוניות)',
} as const;
