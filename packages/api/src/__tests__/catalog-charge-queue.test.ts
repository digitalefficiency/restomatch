import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, invoiceLines, invoices, sql, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-08 review round 5 HIGH-1: learning a charge key locks the restaurant row
 * (lost-update guard). With FOR UPDATE that lock blocked the re-match enqueue
 * (the queue insert's FK takes KEY SHARE on restaurants from its own
 * connection): every re-match waited and failed. FOR NO KEY UPDATE still
 * serialises the settings writers but lets the enqueue through. REAL queue here.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let S = '';

beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`delete from job_queue`);
  A = await seedTenant(db, 'A');
  const [s] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'הובלות הצפון' }).returning({ id: suppliers.id });
  S = s!.id;
});
afterAll(async () => {
  await db.execute(sql`delete from job_queue`);
  await resetDb(db);
});

describe('R5 HIGH-1: a charge mark over many invoices enqueues every re-match', () => {
  it('a key on 6 held invoices → 6 re-matches queued, none failed, in seconds', async () => {
    for (let n = 0; n < 6; n++) {
      const [inv] = await db
        .insert(invoices)
        .values({
          restaurantId: A.restaurantId,
          supplierId: S,
          status: 'parsed',
          source: 'photo',
          invoiceDate: new Date(),
          totalExclVat: '30.00',
          vatAmount: '5.40',
          totalInclVat: '35.40',
          ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinked'] } } as never,
        })
        .returning({ id: invoices.id });
      await db.insert(invoiceLines).values({
        invoiceId: inv!.id,
        productId: null,
        rawDescription: 'הובלה',
        qtyBilled: '1',
        unit: 'יח׳',
        unitPriceBilled: '30',
        lineTotal: '30',
      });
    }
    const caller = appRouter.createCaller({
      db,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);
    const t0 = Date.now();
    const r = await caller.mapping.markCharge({ supplierId: S, rawName: 'הובלה' });
    expect(r.invoiceLinesMarked).toBe(6);
    expect(r.learnedKey).toBe(true);
    expect(r.rematch).toMatchObject({ requeued: 6, failed: 0 });
    expect(Date.now() - t0).toBeLessThan(10_000);
    const [q] = (await db.execute(sql`select count(*)::int as n from job_queue where queue = 'match-invoice'`)) as unknown as Array<{ n: number }>;
    expect(Number(q!.n)).toBe(6);
  });
});
