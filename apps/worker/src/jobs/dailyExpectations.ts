import {
  and,
  asc,
  auditLog,
  count,
  createDb,
  eq,
  gte,
  inArray,
  lte,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';
import { makeWorker } from '../queue';

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

export function startDailyExpectationsWorker() {
  return makeWorker<DailyExpectationsJob>('daily-expectations', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const targetDate = job.data.forDate ? new Date(job.data.forDate) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

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
          forDate: startOfDay.toISOString().slice(0, 10),
          expectations,
        },
      });

      summary.push({ restaurantId: restaurant.id, count: expectations.length });
    }

    console.log(
      `[daily-expectations] forDate=${startOfDay.toISOString().slice(0, 10)} ` +
        `restaurants=${summary.length} ` +
        `total_pos=${summary.reduce((s, r) => s + r.count, 0)}`,
    );

    return { date: startOfDay.toISOString().slice(0, 10), summary };
  });
}
