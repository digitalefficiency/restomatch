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
  briefOptionOn,
  newOrderPath,
  orderReminderBrief,
  recipientsForRestaurant,
} from '@restomatch/api';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  notificationsOutbox,
  or,
  purchaseOrders,
  restaurants,
  sql,
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
import { sendBrief } from '../lib/briefSend';

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

/**
 * DEPLOY-DAY GUARD (one-time; delete after B2 deploy day + 1, i.e. from 14.11.2026).
 * The reminder used to dedupe on `supplier:<sid>:order-reminder:<day>:<email>`; it
 * now dedupes on `au:A5:<rid>:<userId>:<sid>:<day>`. On the deploy day a 09:00 run on
 * the old code followed by any same-day re-run on the new code (retry, catch-up, a
 * manual run) would send everyone the reminder twice. A recipient who already has
 * an old-format row for this supplier today is skipped. A new recipient (the chef)
 * has no old row and is not affected. After the deploy day no old-format row is ever
 * written again, so the guard is inert.
 */
export function legacyOrderReminderKey(supplierId: string, ilDay: string, email: string): string {
  return `supplier:${supplierId}:order-reminder:${ilDay}:${email}`;
}

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

    // "Ordered today" = SENT in today's Israel day (never keyed on created_at for a
    // manual PO: a draft prepared yesterday and sent this morning is ordered; a PO
    // created today but still a draft is not). Imported / synced platform orders
    // were placed on the platform: they carry no sent_at (importPo.ts,
    // syncPlatforms.ts), so their created_at is the send time, and a checksum-held
    // platform 'draft' still counts as ordered.
    const sentOrCreated = sql`coalesce(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt})`;
    const orderedToday = await db
      .selectDistinct({ supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          or(
            inArray(purchaseOrders.status, [...ORDERED_STATUSES]),
            and(eq(purchaseOrders.status, 'draft'), ne(purchaseOrders.source, 'manual')),
          ),
          sql`${sentOrCreated} >= ${startToday.toISOString()}::timestamptz`,
          sql`${sentOrCreated} < ${endToday.toISOString()}::timestamptz`,
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
          eq(purchaseOrders.source, 'manual'), // the buyer's own drafts, never a held import
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

    // Deploy-day guard (see legacyOrderReminderKey): today's keys in either earlier
    // format — `supplier:<sid>:order-reminder:<day>:<email>` (before #269) and
    // `au:A5:<rid>:<userId>:<sid>:<day>` (#269, before notify()).
    const legacyToday = new Set(
      (
        await db
          .select({ key: notificationsOutbox.dedupeKey })
          .from(notificationsOutbox)
          .where(
            and(
              eq(notificationsOutbox.restaurantId, restaurant.id),
              sql`(${notificationsOutbox.dedupeKey} like ${`supplier:%:order-reminder:${todayKey}:%`}
                   or ${notificationsOutbox.dedupeKey} like ${`au:A5:${restaurant.id}:%:${todayKey}`})`,
            ),
          )
      ).map((r) => r.key),
    );

    for (const s of missing) {
      const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
      const told = (r: { userId: string; email: string }) =>
        legacyToday.has(legacyOrderReminderKey(s.id, todayKey, r.email)) ||
        legacyToday.has(`au:A5:${restaurant.id}:${r.userId}:${s.id}:${todayKey}`);
      const userIds = recipients.filter((r) => !told(r)).map((r) => r.userId);
      if (userIds.length === 0) continue;
      // G-06 notify(): quiet hours / Shabbat / ≤6 a day; perishable (a 09:00 reminder
      // after noon is noise). Key = au:A5:<IL day>:<rid>:<sid>:<userId>:email.
      const res = await sendBrief(db, {
        restaurantId: restaurant.id,
        now,
        event: `au:A5:${todayKey}`,
        audience: { userIds },
        entity: { type: 'supplier', id: s.id },
        perishable: true,
        payload: { automationId: 'A5' },
        build: ({ locale }) =>
          orderReminderBrief({
            restaurantId: restaurant.id,
            baseUrl: appBaseUrl(),
            locale,
            ilDate: todayKey,
            supplierId: s.id,
            supplierName: s.name,
            orderDayLabel: weekdayLabel,
            cutoffLabel: window?.cutoff,
            draftPoId: draftBySupplier.get(s.id) ?? null,
          }),
      });
      enqueued += res.enqueued;
    }
  }

  console.log(
    `[order-reminders] date=${todayKey} weekday=${weekday} restaurants=${restaurantRows.length} due=${dueToday} enqueued=${enqueued} skipped=${skipped}`,
  );
  // The result shape is pinned (reminderDay.db.test.ts); option-off is in the log line.
  return { date: todayKey, dueToday, enqueued };
}
