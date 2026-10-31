import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, eq, goodsReceipts, purchaseOrders, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { processDailyExpectations } from '../jobs/dailyExpectations';
import type { WorkerJob } from '../queue';

/**
 * G-01: daily-expectations (06:00 IL) lists the deliveries expected today. It uses
 * the same delivery state as the late-delivery e-mail, so a PO that already has a
 * goods receipt — being counted, partially or fully received — never appears.
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });

// Tue 3 Nov 2026, 06:00 IST; deliveries expected at 09:00 IST the same day.
const RUN_AT = '2026-11-03T04:00:00Z';
const EXPECTED = new Date('2026-11-03T07:00:00Z');
const restaurantIds: string[] = [];

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(async () => {
  for (const id of restaurantIds) await db.delete(restaurants).where(eq(restaurants.id, id));
});

describe('daily-expectations uses the delivery state (G-01)', () => {
  it('lists only today\'s POs without a goods receipt', async () => {
    const [r] = await db.insert(restaurants).values({ name: `g01 expect ${RUN}` }).returning();
    restaurantIds.push(r!.id);
    const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק בוקר' }).returning();
    const mk = async (status: 'sent' | 'confirmed' | 'partial' = 'sent') => {
      const [row] = await db
        .insert(purchaseOrders)
        .values({ restaurantId: r!.id, supplierId: s!.id, status, expectedDeliveryAt: EXPECTED })
        .returning();
      return row!.id;
    };
    const waiting = await mk();
    const waitingConfirmed = await mk('confirmed');
    const received = await mk();
    const partiallyReceived = await mk();
    const beingCounted = await mk();
    await db.insert(goodsReceipts).values([
      { restaurantId: r!.id, poId: received, status: 'completed' },
      { restaurantId: r!.id, poId: partiallyReceived, status: 'partial' },
      { restaurantId: r!.id, poId: beingCounted, status: 'pending' },
    ]);

    const res = await processDailyExpectations(job({ restaurantId: r!.id, forDate: RUN_AT }));
    expect(res.date).toBe('2026-11-03');
    expect(res.summary).toEqual([{ restaurantId: r!.id, count: 2 }]);

    const [entry] = await db.query.auditLog.findMany({
      where: (a, { and, eq: e }) => and(e(a.restaurantId, r!.id), e(a.action, 'daily_expectations.computed')),
    });
    const listed = ((entry?.after as { expectations: Array<{ poId: string }> }).expectations ?? []).map((x) => x.poId);
    expect(listed.sort()).toEqual([waiting, waitingConfirmed].sort());
  });
});
