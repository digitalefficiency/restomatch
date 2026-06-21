/**
 * supplier-delays — daily sweep for placed purchase orders that are PAST their
 * expected delivery date but still open (status sent/confirmed/partial, i.e. not
 * received or closed). Each overdue PO triggers one Hebrew email per manager,
 * deduped to once-per-PO-per-day via the outbox dedupe key.
 *
 * Runs after daily-expectations (see cron.ts). Pure detection: it reads POs and
 * enqueues notifications; real delivery happens through outbox-dispatch.
 */
import {
  enqueueNotification,
  recipientsForRestaurant,
  supplierDelayEmail,
} from '@restomatch/api';
import {
  and,
  asc,
  count,
  createDb,
  eq,
  inArray,
  isNotNull,
  lt,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';
import { makeWorker } from '../queue';
import { appBaseUrl, formatIlDate, startOfIlDay } from '../lib/notifyHelpers';

export interface SupplierDelaysJob {
  /** When omitted, sweeps ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

const OPEN_STATUSES = ['sent', 'confirmed', 'partial'] as const;

export function startSupplierDelaysWorker() {
  return makeWorker<SupplierDelaysJob>('supplier-delays', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
    const startToday = startOfIlDay(now);
    const todayKey = startToday.toISOString().slice(0, 10);

    const restaurantRows = job.data.restaurantId
      ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
      : await db.select().from(restaurants);

    let enqueued = 0;
    let overdue = 0;

    for (const restaurant of restaurantRows) {
      const rows = await db
        .select({
          poId: purchaseOrders.id,
          supplierName: suppliers.name,
          expectedAt: purchaseOrders.expectedDeliveryAt,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(
          and(
            eq(purchaseOrders.restaurantId, restaurant.id),
            isNotNull(purchaseOrders.expectedDeliveryAt),
            lt(purchaseOrders.expectedDeliveryAt, startToday),
            inArray(purchaseOrders.status, [...OPEN_STATUSES]),
          ),
        )
        .orderBy(asc(purchaseOrders.expectedDeliveryAt));

      if (rows.length === 0) continue;
      overdue += rows.length;

      const recipients = await recipientsForRestaurant(db, restaurant.id);
      if (recipients.length === 0) continue;

      // Line counts for the overdue POs (one grouped query).
      const poIds = rows.map((r) => r.poId);
      const lineCountMap = new Map<string, number>();
      const counts = await db
        .select({ poId: poLines.poId, c: count(poLines.id) })
        .from(poLines)
        .where(inArray(poLines.poId, poIds))
        .groupBy(poLines.poId);
      for (const c of counts) lineCountMap.set(c.poId, Number(c.c));

      for (const r of rows) {
        const expectedAt = r.expectedAt ?? startToday;
        const daysLate = Math.max(
          1,
          Math.floor((startToday.getTime() - startOfIlDay(expectedAt).getTime()) / 86_400_000),
        );
        const email = supplierDelayEmail({
          supplierName: r.supplierName,
          expectedAtLabel: formatIlDate(expectedAt),
          daysLate,
          lineCount: lineCountMap.get(r.poId) ?? 0,
          poUrl: `${appBaseUrl()}/dashboard/receiving/${r.poId}`,
        });

        for (const recipient of recipients) {
          const { deduped } = await enqueueNotification(db, {
            restaurantId: restaurant.id,
            channel: 'email',
            target: recipient.email,
            subject: email.subject,
            body: email.text,
            html: email.html,
            relatedEntityType: 'purchase_order',
            relatedEntityId: r.poId,
            dedupeKey: `po:${r.poId}:delay:${todayKey}:${recipient.email}`,
          });
          if (!deduped) enqueued += 1;
        }
      }
    }

    console.log(
      `[supplier-delays] date=${todayKey} restaurants=${restaurantRows.length} overdue=${overdue} enqueued=${enqueued}`,
    );
    return { date: todayKey, overdue, enqueued };
  });
}
