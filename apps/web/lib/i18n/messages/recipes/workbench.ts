/**
 * W3-02 · the recipe workbench (live preview, share of plate, sandbox). A
 * sub-tree of the `recipes` namespace (`t('workbench.…')`), kept in its own
 * file so W2-16b's copy rows in he.ts / en.ts never collide with it.
 */
import type { Shape } from '../../translate';

export const workbenchHe = {
  live: 'עלות המנה עכשיו',
  liveBatch: 'עלות המנה המלאה עכשיו',
  updating: 'מחשבים…',
  stale: 'מוצג החישוב האחרון',
  partial: 'חישוב חלקי: {count} רכיבים בלי מחיר או בלי יחידה מתאימה',
  gapAbove: '{gap} מעל העלות הרצויה ({target})',
  gapBelow: '{gap} מתחת לעלות הרצויה ({target})',
  gapOn: 'בדיוק בעלות הרצויה ({target})',
  noMenuPrice: 'הוסיפו מחיר בתפריט כדי לראות אחוז עלות מזון',
  shareTitle: 'חלק כל רכיב במנה',
  shareOf: '{pct} מהמנה',
  sandbox: {
    toggle: 'נסה בלי לשמור',
    on: 'מצב ניסיון: אפשר לשנות כמויות ומחירים, ושום דבר לא נשמר.',
    reset: 'חזרה למתכון השמור',
    exit: 'סיום הניסיון',
  },
  qtyAmbiguous: '״{raw}״: 1,250 או 1.25? כתבו עם נקודה עשרונית.',
  qtyInvalid: 'כמות לא תקינה',
  previewError: 'לא הצלחנו לחשב כרגע. המתכון עצמו לא השתנה.',
  readOnly: 'צפייה בלבד: אפשר לראות את העלויות, בלי לשנות את המתכון.',
};

export const workbenchEn: Shape<typeof workbenchHe> = {
  live: 'Plate cost now',
  liveBatch: 'Batch cost now',
  updating: 'Updating…',
  stale: 'Showing the last result',
  partial: 'Partial: {count} ingredients have no price or no matching unit',
  gapAbove: '{gap} above the target food cost ({target})',
  gapBelow: '{gap} below the target food cost ({target})',
  gapOn: 'Exactly on the target food cost ({target})',
  noMenuPrice: 'Add a menu price to see the food-cost %',
  shareTitle: 'Share of the plate',
  shareOf: '{pct} of the plate',
  sandbox: {
    toggle: 'Try without saving',
    on: 'Trial mode: change quantities and prices freely — nothing is saved.',
    reset: 'Back to the saved recipe',
    exit: 'End the trial',
  },
  qtyAmbiguous: '"{raw}": 1,250 or 1.25? Use a decimal point.',
  qtyInvalid: 'Invalid quantity',
  previewError: "We couldn't calculate right now. The recipe itself is unchanged.",
  readOnly: 'View only: you can see the costs, not change the recipe.',
};
