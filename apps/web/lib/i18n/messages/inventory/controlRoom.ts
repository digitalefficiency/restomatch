/**
 * W3-02b · the food-cost control room card: a sub-tree of the `inventory`
 * namespace (`t('controlRoom.…')`), in its own file so inventory he.ts / en.ts
 * copy rows never collide with it.
 */
import type { Shape } from '../../translate';

export const controlRoomHe = {
  title: 'חדר הבקרה של עלות המזון',
  subtitle: 'איך נבנה האחוז, ולאן ללחוץ כדי לבדוק כל חלק',
  trend: 'עלות מזון בפועל בתקופות האחרונות',
  trendLabel: 'מגמת עלות המזון בפועל: {points}, העלות הרצויה {target}',
  latest: '{pct} בתקופה האחרונה',
  delta: '{delta} מהתקופה הקודמת',
  target: 'רצוי {pct}',
  noData: 'צריך לפחות שתי ספירות סגורות כדי לחשב עלות מזון בפועל.',
  check: 'האחוז נראה חריג או שהספירה חלקית: כדאי לבדוק אותה קודם',
  terms: {
    opening: 'מלאי פתיחה',
    purchases: 'קניות',
    credits: 'זיכויים שהתקבלו',
    closing: 'מלאי סגירה',
    usage: 'שימוש בפועל',
    sales: 'מכירות מזון',
    pct: 'עלות מזון',
  },
  noSales: 'אין מכירות לתקופה: הזינו אותן בספירה הסוגרת',
  open: 'פתיחה: {what}',
  period: '{from} – {to}',
};

export const controlRoomEn: Shape<typeof controlRoomHe> = {
  title: 'Food-cost control room',
  subtitle: 'How the % is built, and where to click to check each part',
  trend: 'Actual food cost over recent periods',
  trendLabel: 'Actual food cost trend: {points}, target {target}',
  latest: '{pct} in the latest period',
  delta: '{delta} vs the previous period',
  target: 'Target {pct}',
  noData: 'At least two closed counts are needed for an actual food cost.',
  check: 'This % looks off or the count is partial: check it first',
  terms: {
    opening: 'Opening stock',
    purchases: 'Purchases',
    credits: 'Credits received',
    closing: 'Closing stock',
    usage: 'Actual usage',
    sales: 'Food sales',
    pct: 'Food cost',
  },
  noSales: 'No sales for this period: enter them on the closing count',
  open: 'Open: {what}',
  period: '{from} – {to}',
};
