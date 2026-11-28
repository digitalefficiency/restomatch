import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, invoiceLines, invoices, poLines, purchaseOrders, restaurants, suppliers, testDbUrl, userCredentials, users } from '@restomatch/db';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/** W3-07a: every admin write carries a reason. */
const R = 'בדיקה אוטומטית';

/**
 * G-08 kill switch (rounds 10–11): admin.setFeatures + releaseOrderQuestionHolds.
 *   - the sweep throws → the save still stands and the result says how to recover;
 *   - an invoice held for an order question AND another reason is pruned (counted), not released.
 */
const sweep = { fail: false };
vi.mock('../routers/mapping', async (orig) => {
  const real = await orig<typeof import('../routers/mapping')>();
  return {
    ...real,
    releaseOrderQuestionHolds: async (...a: Parameters<typeof real.releaseOrderQuestionHolds>) => {
      if (sweep.fail) throw new Error('queue down');
      return real.releaseOrderQuestionHolds(...a);
    },
  };
});
vi.mock('@restomatch/queue', async (orig) => {
  const real = await orig<typeof import('@restomatch/queue')>();
  return { ...real, enqueue: async () => true };
});
const { appRouter } = await import('../index');
const { releaseOrderQuestionHolds } = await import('../routers/mapping');

const db = createDb(testDbUrl());
let T: Tenant;
let adminUserId = '';
const admin = () =>
  appRouter.createCaller({ db, session: { userId: adminUserId, restaurantId: null, role: null } as Session } as AppContext);

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  T = await seedTenant(db, 'OQ');
  const [u] = await db.insert(users).values({ email: 'ops-oq@restomatch.co', name: 'Ops', isPlatformAdmin: true }).returning();
  adminUserId = u!.id;
  await db.insert(userCredentials).values({ userId: adminUserId, totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() });
  sweep.fail = false;
});
afterAll(() => resetDb(db));

async function orderHeldInvoice(reasons: string[]) {
  const [s] = await db.insert(suppliers).values({ restaurantId: T.restaurantId, name: 'ירקות' }).returning({ id: suppliers.id });
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: T.restaurantId, supplierId: s!.id, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning({ id: purchaseOrders.id });
  await db.insert(poLines).values({ poId: po!.id, productId: null, rawDescription: 'בצל סגול', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '11' });
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: T.restaurantId,
      supplierId: s!.id,
      status: 'parsed',
      source: 'photo',
      invoiceDate: new Date(),
      ocrPayload: { provider: 'reconciled', raw: { reviewReasons: reasons }, heldPoId: po!.id } as never,
    })
    .returning({ id: invoices.id });
  await db.insert(invoiceLines).values({ invoiceId: inv!.id, productId: T.productId, rawDescription: 'עגבניה', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' });
  return inv!.id;
}

describe('admin.setFeatures orderQuestions OFF — a failed release', () => {
  it('the sweep throws → { ok: false, error } with the ops command; the flag IS saved', async () => {
    await orderHeldInvoice(['unlinkedPo']);
    sweep.fail = true;
    const res = await admin().admin.setFeatures({ reason: R, restaurantId: T.restaurantId, features: { orderQuestions: false } });
    expect(res).toMatchObject({ release: { ok: false } });
    expect((res as { release: { error: string } }).release.error).toContain(`release-order-holds --restaurant ${T.restaurantId}`);
    const [r] = await db.select({ s: restaurants.settings }).from(restaurants).where(eq(restaurants.id, T.restaurantId));
    expect((r!.s as unknown as { features: { orderQuestions: boolean } }).features.orderQuestions).toBe(false);
  });
});

describe('releaseOrderQuestionHolds — counts', () => {
  it("held for 'unlinkedPo' only → released; also 'confidence' → pruned (counted), still held", async () => {
    await db.update(restaurants).set({ settings: { features: { orderQuestions: false } } as never }).where(eq(restaurants.id, T.restaurantId));
    const only = await orderHeldInvoice(['unlinkedPo']);
    const both = await orderHeldInvoice(['confidence', 'unlinkedPo']);
    const out = await releaseOrderQuestionHolds(db, T.restaurantId);
    expect(out).toMatchObject({ restaurants: 1, released: 1, pruned: 1, requeued: 1, failed: 0 });
    const rows = await db.select({ id: invoices.id, status: invoices.status, p: invoices.ocrPayload }).from(invoices);
    expect(rows.find((r) => r.id === only)!.status).toBe('matched');
    const b = rows.find((r) => r.id === both)!;
    expect(b.status).toBe('parsed');
    expect((b.p as unknown as { raw: { reviewReasons: string[] } }).raw.reviewReasons).toEqual(['confidence']);
    // A second run finds nothing more to do (idempotent).
    expect(await releaseOrderQuestionHolds(db, T.restaurantId)).toMatchObject({ released: 0, pruned: 0 });
  });
});
