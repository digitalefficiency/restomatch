/**
 * order-reminders — daily cadence check. For every active supplier whose
 * `order_schedule` marks TODAY (Asia/Jerusalem weekday) as an order day, verify
 * an order was actually SENT today (AU-04 A5: a draft is not an order). If none
 * was, e-mail the owner, manager and chef (the chef orders directly) — linking the
 * supplier's unsent draft when there is one, else the new-order wizard. No ₪.
 * Deduped once per (recipient, supplier, IL day): `au:A5:<rid>:<userId>:<sid>:<day>`.
 *
 * Runs in the morning after daily-expectations (see cron.ts). Detection only —
 * delivery happens through outbox-dispatch.
 */
import {
  briefDedupeKey,
  briefOptionOn,
  enqueueNotification,
  newOrderPath,
  orderReminderBrief,
  recipientsForRestaurant,
} from '@restomatch/api';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';
import { makeWorker, type WorkerJob } from '../queue';
import {
  appBaseUrl,
  ilDateKey,
  ilWeekday,
  ilWeekdayLabel,
  startOfIlDay,
} from '../lib/notifyHelpers';
import { jobDb } from '../db';

export interface OrderRemindersJob {
  /** When omitted, sweeps ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

/**
 * Where the reminder lands: the new-order wizard with the supplier picked. The page
 * reads `supplierId` (it also accepts the old `supplier` alias, for reminders already
 * sitting in inboxes).
 */
export function orderReminderUrl(baseUrl: string, supplierId: string): string {
  return `${baseUrl}${newOrderPath(supplierId)}`;
}

/** A PO in one of these states with `sent_at` today counts as "ordered today". */
export const ORDERED_STATUSES = ['sent', 'confirmed', 'partial', 'closed'] as const;
/** Who hears the reminder: the chef orders directly (`chefProcedure`), so the chef too. */
export const ORDER_REMINDER_ROLES = ['owner', 'manager', 'chef'] as const;

export function startOrderRemindersWorker() {
  return makeWorker<OrderRemindersJob>('order-reminders', processOrderReminders);
}

/** The order-reminders job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processOrderReminders(job: WorkerJob<OrderRemindersJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
  const startToday = startOfIlDay(now);
  // +36 h always lands in the next IL day (days are 23–25 h around DST).
  const endToday = startOfIlDay(new Date(startToday.getTime() + 36 * 3600_000));
  const todayKey = ilDateKey(now); // the Israel date (not the UTC date of IL midnight)
  const weekday = ilWeekday(now);
  const weekdayLabel = ilWeekdayLabel(now);

  const restaurantRows = job.data.restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
    : await db.select().from(restaurants);

  let dueToday = 0;
  let enqueued = 0;
  let skipped = 0;

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

    if (!briefOptionOn(restaurant.settings, 'orderReminders')) {
      console.log(`[order-reminders] restaurant=${restaurant.id} skipped: option off`);
      skipped += 1;
      continue;
    }

    // "Ordered today" = SENT in today's Israel day (never keyed on created_at: a
    // draft prepared yesterday and sent this morning is ordered; a PO created
    // today but still a draft is not).
    const orderedToday = await db
      .selectDistinct({ supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          inArray(purchaseOrders.status, [...ORDERED_STATUSES]),
          gte(purchaseOrders.sentAt, startToday),
          lt(purchaseOrders.sentAt, endToday),
        ),
      );
    const orderedSet = new Set(orderedToday.map((r) => r.supplierId));

    const missing = supplierRows.filter((s) => {
      const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
      return Boolean(window) && !orderedSet.has(s.id);
    });
    if (missing.length === 0) continue;
    dueToday += missing.length;

    // Any open draft for those suppliers, whatever day it was created (AU-11's
    // prepared drafts are usually created the day before); the newest one wins.
    const drafts = await db
      .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          eq(purchaseOrders.status, 'draft'),
          inArray(
            purchaseOrders.supplierId,
            missing.map((s) => s.id),
          ),
        ),
      )
      .orderBy(desc(purchaseOrders.createdAt));
    const draftBySupplier = new Map<string, string>();
    for (const d of drafts) if (!draftBySupplier.has(d.supplierId)) draftBySupplier.set(d.supplierId, d.id);

    const recipients = await recipientsForRestaurant(db, restaurant.id, [...ORDER_REMINDER_ROLES]);
    if (recipients.length === 0) continue;

    for (const s of missing) {
      const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
      const msg = orderReminderBrief({
        restaurantId: restaurant.id,
        baseUrl: appBaseUrl(),
        ilDate: todayKey,
        supplierId: s.id,
        supplierName: s.name,
        orderDayLabel: weekdayLabel,
        cutoffLabel: window?.cutoff,
        draftPoId: draftBySupplier.get(s.id) ?? null,
      });
      for (const recipient of recipients) {
        // One call site: it becomes G-06 `notify()` (quiet hours, Shabbat, ≤6/day) when G-06 merges.
        const { deduped } = await enqueueNotification(db, {
          restaurantId: restaurant.id,
          channel: 'email',
          target: recipient.email,
          subject: msg.subject,
          body: msg.text,
          html: msg.html,
          payload: { automationId: msg.automationId },
          relatedEntityType: 'supplier',
          relatedEntityId: s.id,
          dedupeKey: briefDedupeKey(msg, restaurant.id, recipient.userId),
        });
        if (!deduped) enqueued += 1;
      }
    }
  }

  console.log(
    `[order-reminders] date=${todayKey} weekday=${weekday} restaurants=${restaurantRows.length} due=${dueToday} enqueued=${enqueued} skipped=${skipped}`,
  );
  return { date: todayKey, dueToday, enqueued, skipped };
}
