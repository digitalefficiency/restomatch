/**
 * order-reminders — daily cadence check. For every active supplier whose
 * `order_schedule` marks TODAY (Asia/Jerusalem weekday) as an order day, verify
 * a purchase order was actually created today. If none was, email the managers a
 * Hebrew "לא בוצעה הזמנה" reminder (deduped once-per-supplier-per-day).
 *
 * Runs in the morning after daily-expectations (see cron.ts). Detection only —
 * delivery happens through outbox-dispatch.
 */
import {
  enqueueNotification,
  orderNotPlacedEmail,
  recipientsForRestaurant,
} from '@restomatch/api';
import {
  and,
  createDb,
  eq,
  gte,
  isNotNull,
  ne,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';
import { makeWorker } from '../queue';
import {
  appBaseUrl,
  ilWeekday,
  ilWeekdayLabel,
  startOfIlDay,
} from '../lib/notifyHelpers';

export interface OrderRemindersJob {
  /** When omitted, sweeps ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

export function startOrderRemindersWorker() {
  return makeWorker<OrderRemindersJob>('order-reminders', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
    const startToday = startOfIlDay(now);
    const todayKey = startToday.toISOString().slice(0, 10);
    const weekday = ilWeekday(now);
    const weekdayLabel = ilWeekdayLabel(now);

    const restaurantRows = job.data.restaurantId
      ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
      : await db.select().from(restaurants);

    let dueToday = 0;
    let enqueued = 0;

    for (const restaurant of restaurantRows) {
      const supplierRows = await db
        .select({
          id: suppliers.id,
          name: suppliers.name,
          orderSchedule: suppliers.orderSchedule,
        })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.restaurantId, restaurant.id),
            eq(suppliers.active, true),
            isNotNull(suppliers.orderSchedule),
          ),
        );

      // Suppliers that DO have a PO created today (any non-cancelled order).
      const orderedToday = await db
        .selectDistinct({ supplierId: purchaseOrders.supplierId })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.restaurantId, restaurant.id),
            gte(purchaseOrders.createdAt, startToday),
            ne(purchaseOrders.status, 'cancelled'),
          ),
        );
      const orderedSet = new Set(orderedToday.map((r) => r.supplierId));

      const missing = supplierRows.filter((s) => {
        const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
        return Boolean(window) && !orderedSet.has(s.id);
      });
      if (missing.length === 0) continue;
      dueToday += missing.length;

      const recipients = await recipientsForRestaurant(db, restaurant.id);
      if (recipients.length === 0) continue;

      for (const s of missing) {
        const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
        const email = orderNotPlacedEmail({
          supplierName: s.name,
          orderDayLabel: weekdayLabel,
          cutoffLabel: window?.cutoff,
          ordersUrl: `${appBaseUrl()}/dashboard/orders/new?supplier=${s.id}`,
        });
        for (const recipient of recipients) {
          const { deduped } = await enqueueNotification(db, {
            restaurantId: restaurant.id,
            channel: 'email',
            target: recipient.email,
            subject: email.subject,
            body: email.text,
            html: email.html,
            relatedEntityType: 'supplier',
            relatedEntityId: s.id,
            dedupeKey: `supplier:${s.id}:order-reminder:${todayKey}:${recipient.email}`,
          });
          if (!deduped) enqueued += 1;
        }
      }
    }

    console.log(
      `[order-reminders] date=${todayKey} weekday=${weekday} restaurants=${restaurantRows.length} due=${dueToday} enqueued=${enqueued}`,
    );
    return { date: todayKey, dueToday, enqueued };
  });
}
