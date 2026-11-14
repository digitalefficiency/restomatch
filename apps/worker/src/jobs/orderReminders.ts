/**
 * order-reminders — daily cadence check. For every active supplier whose
 * `order_schedule` marks TODAY (Asia/Jerusalem weekday) as an order day, verify
 * an order was actually SENT today (AU-04 A5: a draft is not an order). If none
 * was, e-mail the owner, manager and chef (the chef orders directly) — linking the
 * supplier's unsent draft when there is one, else the new-order wizard. No ₪.
 * Deduped once per (recipient, supplier, IL day): `au:A5:<rid>:<userId>:<sid>:<day>`.
 *
 * W3-09 / AU-11 (option `preparedOrderDraft`, default off): for a supplier due
 * today, a draft is PREPARED from the order guide and the A5 line is replaced by
 * "טיוטה מוכנה ל<ספק> · N פריטים" (one message per supplier per person, dedupe
 * `au:A16:<rid>:<userId>:<sid>:<day>`). A supplier whose cut-off is before 09:30
 * gets TOMORROW's draft today, when tomorrow is one of its order days. Nothing
 * is sent to a supplier; the draft waits for a person. Then (option `sendRescue`)
 * placed orders whose send failed in the last 48 h are reported to their sender.
 *
 * Runs in the morning after daily-expectations (see cron.ts). Detection only —
 * delivery happens through outbox-dispatch.
 */
import {
  autopilotDeepLink,
  autopilotOption,
  briefDedupeKey,
  briefOptionOn,
  briefPayload,
  enqueueNotification,
  findSendRescues,
  newOrderPath,
  notifySendRescue,
  orderReminderBrief,
  ordersAutopilotHe,
  prepareOrderDraft,
  recipientsForRestaurant,
} from '@restomatch/api';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
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
import { ilMinuteOfDay, parseCutoff } from './orderCutoff';

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
/** AU-11: a cut-off before 09:30 IL gets tomorrow's prepared draft at today's 09:00 run. */
export const EARLY_CUTOFF_MIN = 9 * 60 + 30;

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
  let prepared = 0;
  let rescued = 0;
  const nowMin = ilMinuteOfDay(now);
  const tomorrowRef = new Date(endToday.getTime() + 3600_000);
  const tomorrowKey = ilDateKey(tomorrowRef);
  const tomorrowWeekday = ilWeekday(tomorrowRef);
  const endTomorrow = startOfIlDay(new Date(endToday.getTime() + 36 * 3600_000));

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

    // AU-11 c · failed-send rescue: its own option, independent of the reminder.
    if (autopilotOption(restaurant.settings, 'sendRescue')) {
      for (const r of await findSendRescues(db, restaurant.id, now)) {
        await notifySendRescue(db, { restaurantId: restaurant.id, poId: r.poId, supplierName: r.supplierName, createdBy: r.createdBy, now });
        rescued += 1;
      }
    }

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
            // A held platform/import draft counts; the buyer's own drafts (manual,
            // or AU-11's prepared 'recurring' ones) are not orders.
            and(eq(purchaseOrders.status, 'draft'), sql`${purchaseOrders.source} not in ('manual', 'recurring')`),
          ),
          sql`${sentOrCreated} >= ${startToday.toISOString()}::timestamptz`,
          sql`${sentOrCreated} < ${endToday.toISOString()}::timestamptz`,
        ),
      );
    const orderedSet = new Set(orderedToday.map((r) => r.supplierId));
    // AU-11: a prepared draft FOR today that someone already sent (yesterday, for an
    // early cut-off) is today's order — no "you haven't ordered" nag for it.
    const sentPrepared = await db
      .select({ supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          inArray(purchaseOrders.status, [...ORDERED_STATUSES]),
          sql`${purchaseOrders.sourceRef} like ${`au:A16:%:${todayKey}`}`,
        ),
      );
    for (const r of sentPrepared) orderedSet.add(r.supplierId);

    const missing = supplierRows.filter((s) => {
      const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
      return Boolean(window) && !orderedSet.has(s.id);
    });
    // AU-11 a · TOMORROW's draft today for an early cut-off (before 09:30): the
    // 09:00 message is the only one that reaches them in time (H-05a's slot later).
    const preparedOn = autopilotOption(restaurant.settings, 'preparedOrderDraft');
    const early = preparedOn
      ? supplierRows.filter((s) => {
          const w = s.orderSchedule?.windows?.find((x) => x.orderDays.includes(tomorrowWeekday));
          const c = parseCutoff(w?.cutoff);
          return c !== null && c < EARLY_CUTOFF_MIN;
        })
      : [];

    if (missing.length === 0 && early.length === 0) continue;
    dueToday += missing.length;

    // AU-11 a · prepare today's draft for each due supplier whose cut-off is still ahead.
    type Prepared = { poId: string; lines: number; cutoff: string | null; tomorrow: boolean };
    // Today's prepared draft REPLACES that supplier's A5 line; tomorrow's is an extra
    // message and never hides today's reminder.
    const preparedBySupplier = new Map<string, Prepared>();
    const preparedTomorrow = new Map<string, Prepared>();
    if (preparedOn) {
      for (const s of missing) {
        const w = s.orderSchedule?.windows?.find((x) => x.orderDays.includes(weekday));
        const c = parseCutoff(w?.cutoff);
        if (c !== null && c <= nowMin) continue; // past today's cut-off: the A5 line (or nothing) as before
        const r = await db.transaction((tx) =>
          prepareOrderDraft(tx as unknown as typeof db, {
            restaurantId: restaurant.id,
            supplierId: s.id,
            orderDay: todayKey,
            dayStart: startToday,
            dayEnd: endToday,
            now,
            optionChecked: true,
          }),
        );
        if (r.status === 'skipped' || r.lineCount === 0) continue;
        if (r.status === 'created') prepared += 1;
        preparedBySupplier.set(s.id, { poId: r.poId, lines: r.lineCount, cutoff: w?.cutoff ?? null, tomorrow: false });
      }
      for (const s of early) {
        const w = s.orderSchedule?.windows?.find((x) => x.orderDays.includes(tomorrowWeekday));
        // An order created today AFTER today's cut-off (or any order today, when today is
        // not an order day for it) is tomorrow's order: no second draft for it.
        const todayCut = parseCutoff(s.orderSchedule?.windows?.find((x) => x.orderDays.includes(weekday))?.cutoff);
        const forTomorrowFrom = todayCut === null ? startToday : new Date(startToday.getTime() + todayCut * 60_000);
        const r = await db.transaction((tx) =>
          prepareOrderDraft(tx as unknown as typeof db, {
            restaurantId: restaurant.id,
            supplierId: s.id,
            orderDay: tomorrowKey,
            dayStart: forTomorrowFrom,
            dayEnd: endTomorrow,
            now,
            optionChecked: true,
          }),
        );
        if (r.status === 'skipped' || r.lineCount === 0) continue;
        if (r.status === 'created') prepared += 1;
        preparedTomorrow.set(s.id, { poId: r.poId, lines: r.lineCount, cutoff: w?.cutoff ?? null, tomorrow: true });
      }
    }

    // Any open draft for those suppliers, whatever day it was created (AU-11's
    // prepared drafts are usually created the day before); the newest one wins.
    const drafts = await db
      .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          eq(purchaseOrders.status, 'draft'),
          inArray(purchaseOrders.source, ['manual', 'recurring']), // the buyer's own (or prepared) drafts, never a held import
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

    // Deploy-day guard (see legacyOrderReminderKey): today's old-format keys.
    const legacyToday = new Set(
      (
        await db
          .select({ key: notificationsOutbox.dedupeKey })
          .from(notificationsOutbox)
          .where(
            and(
              eq(notificationsOutbox.restaurantId, restaurant.id),
              sql`${notificationsOutbox.dedupeKey} like ${`supplier:%:order-reminder:${todayKey}:%`}`,
            ),
          )
      ).map((r) => r.key),
    );

    // AU-11 a · one prepared-draft message per supplier per person; it REPLACES
    // that supplier's A5 line (never both). No ₪, even though the chef may see it on screen.
    for (const [supplierId, p] of [...preparedBySupplier, ...preparedTomorrow]) {
      const name = supplierRows.find((x) => x.id === supplierId)?.name ?? '';
      const link = `${appBaseUrl()}${autopilotDeepLink(restaurant.id, p.poId)}`;
      for (const recipient of recipients) {
        const t = ordersAutopilotHe; // the reminder is Hebrew, like AU-04's A5 line
        const title = p.tomorrow ? t.preparedTomorrowTitle(name, p.lines, p.cutoff) : t.preparedTitle(name, p.lines, p.cutoff);
        const { deduped } = await enqueueNotification(db, {
          restaurantId: restaurant.id,
          channel: 'email',
          target: recipient.email,
          subject: title,
          body: `${title}\n${t.preparedCta}: ${link}`,
          payload: { userId: recipient.userId, event: 'au:A16', poId: p.poId, deepLink: link },
          relatedEntityType: 'purchase_order',
          relatedEntityId: p.poId,
          dedupeKey: `au:A16:${restaurant.id}:${recipient.userId}:${supplierId}:${p.tomorrow ? tomorrowKey : todayKey}`,
        });
        if (!deduped) enqueued += 1;
      }
    }

    for (const s of missing) {
      if (preparedBySupplier.has(s.id)) continue; // the prepared message replaced the A5 line
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
        if (legacyToday.has(legacyOrderReminderKey(s.id, todayKey, recipient.email))) continue;
        // One call site: it becomes G-06 `notify()` (quiet hours, Shabbat, ≤6/day) when G-06 merges.
        const { deduped } = await enqueueNotification(db, {
          restaurantId: restaurant.id,
          channel: 'email',
          target: recipient.email,
          subject: msg.subject,
          body: msg.text,
          html: msg.html,
          payload: briefPayload(msg),
          relatedEntityType: 'supplier',
          relatedEntityId: s.id,
          dedupeKey: briefDedupeKey(msg, restaurant.id, recipient.userId),
        });
        if (!deduped) enqueued += 1;
      }
    }
  }

  console.log(
    `[order-reminders] date=${todayKey} weekday=${weekday} restaurants=${restaurantRows.length} due=${dueToday} enqueued=${enqueued} skipped=${skipped} prepared=${prepared} rescued=${rescued}`,
  );
  // The result shape is pinned (reminderDay.db.test.ts); option-off is in the log line.
  return { date: todayKey, dueToday, enqueued };
}
