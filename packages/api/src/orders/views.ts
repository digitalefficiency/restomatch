import { purchaseOrders, sql } from '@restomatch/db';
import { latestReceiptStatusSql } from '../lib/deliveryState';
import { addCalendarDaysInTz, startOfDayInTz } from '../lib/time';

type SQL = ReturnType<typeof sql>;

/**
 * The orders list as a queue (W2-06 §5.6, orders-15): five views with live
 * counts, one definition shared by `orders.viewCounts` and `orders.list`, so a
 * tab's count always equals the rows it shows.
 *
 * - drafts: every unsent draft;
 * - late:   sent/confirmed, no completed receipt, expected before today;
 * - today:  the same, expected today (restaurant-local);
 * - week:   the same, expected from today through the next 7 days;
 * - action: drafts + late (what needs someone now).
 */
export const ORDER_VIEWS = ['action', 'today', 'late', 'drafts', 'week'] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

export function orderViewConditions(restaurantId: string, tz: string, now: Date = new Date()): Record<OrderView, SQL> {
  const receipt = latestReceiptStatusSql(restaurantId);
  const dayStart = startOfDayInTz(now, tz);
  const tomorrow = addCalendarDaysInTz(dayStart, 1, tz);
  const weekEnd = addCalendarDaysInTz(dayStart, 8, tz);
  const open = sql`(${purchaseOrders.status} in ('sent','confirmed') and coalesce(${receipt}, 'pending') not in ('completed','partial'))`;
  const at = purchaseOrders.expectedDeliveryAt;
  const drafts = sql`(${purchaseOrders.status} = 'draft')`;
  const late = sql`(${open} and ${at} < ${dayStart.toISOString()}::timestamptz)`;
  return {
    drafts,
    late,
    today: sql`(${open} and ${at} >= ${dayStart.toISOString()}::timestamptz and ${at} < ${tomorrow.toISOString()}::timestamptz)`,
    week: sql`(${open} and ${at} >= ${dayStart.toISOString()}::timestamptz and ${at} < ${weekEnd.toISOString()}::timestamptz)`,
    action: sql`(${drafts} or ${late})`,
  };
}
