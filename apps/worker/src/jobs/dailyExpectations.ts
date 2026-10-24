import {
  and,
  asc,
  auditLog,
  count,
  eq,
  gte,
  inArray,
  lte,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';
import { makeWorker, type WorkerJob } from '../queue';
import { jobDb } from '../db';
import { IL_TZ, startOfIlDay } from '../lib/notifyHelpers';

export interface DailyExpectationsJob {
  /** When omitted, computes for ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (used in tests). */
  forDate?: string;
}

export interface DailyExpectationsEntry {
  poId: string;
  supplierId: string;
  supplierName: string;
  expectedAt: string;
  lineCount: number;
  status: string;
}

/**
 * The Israel calendar day containing `ref` — whatever the host's time zone. The
 * job used to take the process-local midnight: right on the owner's Mac (IL), a
 * day off on a UTC host such as the web app's serverless runner. `date` is the
 * IL date (the old label was the UTC date of IL midnight — the day before).
 */
export function ilDayWindow(ref: Date): { startOfDay: Date; endOfDay: Date; date: string } {
  const startOfDay = startOfIlDay(ref);
  // +36 h always lands in the next IL day (days are 23–25 h around DST).
  const endOfDay = new Date(startOfIlDay(new Date(startOfDay.getTime() + 36 * 3600_000)).getTime() - 1);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: IL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ref);
  return { startOfDay, endOfDay, date };
}

export function startDailyExpectationsWorker() {
  return makeWorker<DailyExpectationsJob>('daily-expectations', processDailyExpectations);
}

/** The daily-expectations job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processDailyExpectations(job: WorkerJob<DailyExpectationsJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  const targetDate = job.data.forDate ? new Date(job.data.forDate) : new Date();
  const { startOfDay, endOfDay, date: forDate } = ilDayWindow(targetDate);

  const restaurantRows = job.data.restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
    : await db.select().from(restaurants);

  const summary: Array<{ restaurantId: string; count: number }> = [];

  for (const restaurant of restaurantRows) {
    const rows = await db
      .select({
        poId: purchaseOrders.id,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        expectedAt: purchaseOrders.expectedDeliveryAt,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurant.id),
          gte(purchaseOrders.expectedDeliveryAt, startOfDay),
          lte(purchaseOrders.expectedDeliveryAt, endOfDay),
          inArray(purchaseOrders.status, ['sent', 'confirmed', 'partial']),
        ),
      )
      .orderBy(asc(purchaseOrders.expectedDeliveryAt));

    const poIds = rows.map((r) => r.poId);
    const lineCountMap = new Map<string, number>();
    if (poIds.length > 0) {
      const counts = await db
        .select({ poId: poLines.poId, c: count(poLines.id) })
        .from(poLines)
        .where(inArray(poLines.poId, poIds))
        .groupBy(poLines.poId);
      for (const c of counts) lineCountMap.set(c.poId, Number(c.c));
    }

    const expectations: DailyExpectationsEntry[] = rows.map((r) => ({
      poId: r.poId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      expectedAt: r.expectedAt?.toISOString() ?? startOfDay.toISOString(),
      lineCount: lineCountMap.get(r.poId) ?? 0,
      status: r.status,
    }));

    await db.insert(auditLog).values({
      restaurantId: restaurant.id,
      action: 'daily_expectations.computed',
      entityType: 'restaurant',
      entityId: restaurant.id,
      after: {
        forDate,
        expectations,
      },
    });

    summary.push({ restaurantId: restaurant.id, count: expectations.length });
  }

  console.log(
    `[daily-expectations] forDate=${forDate} ` +
      `restaurants=${summary.length} ` +
      `total_pos=${summary.reduce((s, r) => s + r.count, 0)}`,
  );

  return { date: forDate, summary };
}
