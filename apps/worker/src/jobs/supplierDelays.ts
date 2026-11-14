/**
 * supplier-delays — daily sweep (10:00 IL) for placed purchase orders whose
 * delivery never arrived. A PO is chased when:
 *   • it is OPEN: status sent | confirmed (not partial/closed/cancelled/draft), AND
 *   • it has NO goods receipt at all — receiving never moves a PO out of 'sent',
 *     so the PO status alone said "late" for orders already received (G-01), AND
 *   • it is late (deliveryState: expected + 60 min, no receipt), at most
 *     LOOKBACK_DAYS old — and only on days 1, 3 and 7 after the expected day.
 * One e-mail per owner/manager per (PO, step) via notify(), deduped by
 * `au:A6:d1|d3|d7:<rid>:<poId>:<userId>:email`, so a re-run never re-sends a step
 * (the old `po:<id>:late:d<n>:<email>` keys are honoured on deploy day).
 *
 * Pure detection: it reads POs and enqueues notifications; real delivery happens
 * through outbox-dispatch. Recipient routing is unchanged (recipientsForRestaurant).
 */
import {
  briefOptionOn,
  deliveryState,
  lateTruckManagerBrief,
  lateTruckReceiverBrief,
  localDaysBetween,
  startOfDayInTz,
} from '@restomatch/api';
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notificationsOutbox,
  poLines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
} from '@restomatch/db';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl, ilDateKey } from '../lib/notifyHelpers';
import { sendBrief } from '../lib/briefSend';
import { jobDb } from '../db';

export interface SupplierDelaysJob {
  /** When omitted, sweeps ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

/** Only these PO statuses can still be waiting for a delivery. */
export const OPEN_STATUSES = ['sent', 'confirmed'] as const;
/** A PO more than this many days past its expected day is no longer chased. */
export const LOOKBACK_DAYS = 14;
/** Days after the expected day on which a missing delivery is chased. */
export const CHASE_DAYS = [1, 3, 7] as const;

const DEFAULT_TZ = 'Asia/Jerusalem';

export function startSupplierDelaysWorker() {
  return makeWorker<SupplierDelaysJob>('supplier-delays', processSupplierDelays);
}

/** The supplier-delays job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processSupplierDelays(job: WorkerJob<SupplierDelaysJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
  const todayKey = ilDateKey(now); // the Israel date (not the UTC date of IL midnight)

  const restaurantRows = job.data.restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
    : await db.select().from(restaurants);

  let enqueued = 0;
  let overdue = 0;

  for (const restaurant of restaurantRows) {
    const tz = restaurant.timezone ?? DEFAULT_TZ;
    const startToday = startOfDayInTz(now, tz);
    const lookbackStart = new Date(startToday.getTime() - (LOOKBACK_DAYS + 1) * 86_400_000);
    const candidates = await db
      .select({
        poId: purchaseOrders.id,
        status: purchaseOrders.status,
        supplierName: suppliers.name,
        contactWhatsapp: suppliers.contactWhatsapp,
        contactEmail: suppliers.contactEmail,
        customerRef: purchaseOrders.customerRef,
        sourceRef: purchaseOrders.sourceRef,
        expectedAt: purchaseOrders.expectedDeliveryAt,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          inArray(purchaseOrders.status, [...OPEN_STATUSES]),
          isNotNull(purchaseOrders.expectedDeliveryAt),
          lt(purchaseOrders.expectedDeliveryAt, startToday), // expected before today (IL)
          gte(purchaseOrders.expectedDeliveryAt, lookbackStart), // 14-day cap (+1 day DST slack)
          // Any goods receipt (pending/partial/completed/rejected) means the delivery came.
          sql`NOT EXISTS (SELECT 1 FROM goods_receipts g
                          WHERE g.po_id = "purchase_orders"."id" AND g.restaurant_id = ${restaurant.id})`,
        ),
      )
      .orderBy(asc(purchaseOrders.expectedDeliveryAt));

    // Same rules as every other delivery view; then only the chase days.
    const rows = candidates
      .map((r) => ({ ...r, daysLate: localDaysBetween(r.expectedAt!, now, tz) }))
      .filter(
        (r) =>
          deliveryState({
            po: { status: r.status, expectedDeliveryAt: r.expectedAt },
            latestReceipt: null,
            now,
            tz,
          }) === 'late' && r.daysLate <= LOOKBACK_DAYS,
      );
    overdue += rows.length;
    const toChase = rows.filter((r) => (CHASE_DAYS as readonly number[]).includes(r.daysLate));
    if (toChase.length === 0) continue;

    if (!briefOptionOn(restaurant.settings, 'supplierDelays')) {
      console.log(`[supplier-delays] restaurant=${restaurant.id} skipped: option off`);
      continue;
    }

    // Line counts for the POs chased today (one grouped query).
    const poIds = toChase.map((r) => r.poId);
    const lineCountMap = new Map<string, number>();
    const counts = await db
      .select({ poId: poLines.poId, c: count(poLines.id) })
      .from(poLines)
      .where(inArray(poLines.poId, poIds))
      .groupBy(poLines.poId);
    for (const c of counts) lineCountMap.set(c.poId, Number(c.c));

    for (const r of toChase) {
      const base = {
        restaurantId: restaurant.id,
        baseUrl: appBaseUrl(),
        poId: r.poId,
        // The order number the supplier knows; a short id when it has none.
        poRef: r.customerRef?.trim() || r.sourceRef?.trim() || r.poId.slice(0, 8),
        supplierName: r.supplierName,
        restaurantName: restaurant.name,
        expectedAt: r.expectedAt!,
        daysLate: r.daysLate,
        lineCount: lineCountMap.get(r.poId) ?? 0,
        contactWhatsapp: r.contactWhatsapp,
        contactEmail: r.contactEmail,
      };

      // DEPLOY-DAY GUARD (one-time; delete once live a full day): the old key was
      // `po:<id>:late:d<n>:<email>`. If this step already went out under it today,
      // the managers were told — send nothing new for this PO and step.
      const [legacy] = await db
        .select({ id: notificationsOutbox.id })
        .from(notificationsOutbox)
        .where(
          and(
            eq(notificationsOutbox.restaurantId, restaurant.id),
            sql`${notificationsOutbox.dedupeKey} like ${`po:${r.poId}:late:d${r.daysLate}:%`}`,
          ),
        )
        .limit(1);
      if (legacy) continue;

      // Owner + manager: the late PO and a pre-addressed question to the supplier
      // (a wa.me / mailto draft: nothing is ever sent to the supplier by the server).
      // NOT perishable: CHASE_DAYS steps are one-off, so a step on Shabbat (or over the
      // daily cap) is delayed to the next send window, never dropped.
      const managers = await sendBrief(db, {
        restaurantId: restaurant.id,
        now,
        event: `au:A6:d${r.daysLate}`,
        audience: { roles: ['owner', 'manager'] },
        entity: { type: 'purchase_order', id: r.poId },
        perishable: false,
        payload: { automationId: 'A6' },
        build: ({ locale }) => lateTruckManagerBrief({ ...base, locale }),
      });
      enqueued += managers.enqueued;

      // Day 1 only: the receivers hear the truck is late (no ₪, no supplier link). A NEW
      // send for existing tenants → also behind receiverBrief (default OFF). Perishable:
      // "the truck is late today" is useless tomorrow.
      if (r.daysLate === 1 && briefOptionOn(restaurant.settings, 'receiverBrief')) {
        const receivers = await sendBrief(db, {
          restaurantId: restaurant.id,
          now,
          event: 'au:A6:d1:receiver',
          audience: { roles: ['receiver'] },
          entity: { type: 'purchase_order', id: r.poId },
          perishable: true,
          payload: { automationId: 'A6' },
          build: ({ locale }) => lateTruckReceiverBrief({ ...base, locale }),
        });
        enqueued += receivers.enqueued;
      }
    }
  }

  console.log(
    `[supplier-delays] date=${todayKey} restaurants=${restaurantRows.length} overdue=${overdue} enqueued=${enqueued}`,
  );
  return { date: todayKey, overdue, enqueued };
}
