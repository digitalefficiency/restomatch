import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, priceHistory, purchaseOrders, restaurants, supplierCatalogItems } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * H-11 · least-privilege money visibility (owner decision 6; wave-2 README §7).
 * The receiver and the chef get no purchase or leak ₪ from the server; the chef
 * is exempt on orders.* (and the catalog list prices the order wizard reads).
 * A stripped key stays with a null value; owner / manager / bookkeeper values
 * are unchanged.
 */
const db = createDb(testDbUrl());
let A: Tenant;

type Role = NonNullable<Session['role']>;
const MONEY_ROLES: Role[] = ['owner', 'manager', 'bookkeeper'];

function callerFor(role: Role) {
  const session: Session = { userId: A.ownerUserId, restaurantId: A.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('H-11 · receiver and chef get no ₪ (chef exempt on orders)', () => {
  beforeEach(async () => {
    await resetDb(db);
    await seedPlans(db);
    A = await seedTenant(db, 'A');
    await attachSubscription(db, A.restaurantId, { planKey: 'pro', status: 'active' });
    await db
      .update(restaurants)
      .set({ settings: { features: { recovery: true, orderPricesOut: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
    await db.update(purchaseOrders).set({ totalEstimated: '123.45' }).where(eq(purchaseOrders.id, A.poId));
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierNameRaw: 'עגבניה ארגז',
      unit: 'ק״ג',
      listPrice: '9.9',
    });
    await db.insert(priceHistory).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      unitPrice: '9.5',
      observedAt: new Date('2026-10-20T08:00:00Z'),
    } as never);
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('orders.list: receiver gets totalEstimated null; chef and money roles keep it; other keys equal', async () => {
    const owner = await callerFor('owner').orders.list();
    expect(owner[0]?.totalEstimated).toBe('123.45');
    for (const role of [...MONEY_ROLES, 'chef'] as Role[]) {
      expect(await callerFor(role).orders.list(), role).toEqual(owner);
    }
    const receiver = await callerFor('receiver').orders.list();
    expect(receiver).toHaveLength(owner.length);
    expect(receiver[0]).toHaveProperty('totalEstimated', null);
    expect(receiver).toEqual(owner.map((r) => ({ ...r, totalEstimated: null })));
  });

  it('orders.get: receiver gets po.totalEstimated and every unitPriceExpected null; chef keeps them', async () => {
    const owner = await callerFor('owner').orders.get({ poId: A.poId });
    expect(owner.po?.totalEstimated).toBe('123.45');
    expect(owner.lines[0]?.unitPriceExpected).not.toBeNull();
    expect(await callerFor('chef').orders.get({ poId: A.poId })).toEqual(owner);
    expect(await callerFor('bookkeeper').orders.get({ poId: A.poId })).toEqual(owner);
    const receiver = await callerFor('receiver').orders.get({ poId: A.poId });
    expect(receiver.po).toHaveProperty('totalEstimated', null);
    expect(receiver.lines.every((l) => l.unitPriceExpected === null)).toBe(true);
    expect(receiver.lines.map((l) => ({ ...l, unitPriceExpected: 'x' }))).toEqual(
      owner.lines.map((l) => ({ ...l, unitPriceExpected: 'x' })),
    );
    expect({ ...receiver.po, totalEstimated: 'x' }).toEqual({ ...owner.po, totalEstimated: 'x' });
  });

  it('orders.supplierMessagePreview + guardrail: receiver FORBIDDEN; chef allowed', async () => {
    const preview = (role: Role) => callerFor(role).orders.supplierMessagePreview({ poId: A.poId });
    const guard = (role: Role) =>
      callerFor(role).orders.guardrail({ supplierId: A.supplierId, lines: [{ productId: A.productId, unitPriceExpected: 9 }] });
    await expect(preview('receiver')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(guard('receiver')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const role of ['owner', 'manager', 'chef', 'bookkeeper'] as Role[]) {
      await expect(preview(role), role).resolves.toBeDefined();
      await expect(guard(role), role).resolves.toBeDefined();
    }
  });

  it('catalog.items: receiver gets listPrice null; chef (order wizard) keeps it', async () => {
    const owner = await callerFor('owner').catalog.items();
    expect(owner[0]?.listPrice).toBe('9.9000');
    for (const role of [...MONEY_ROLES, 'chef'] as Role[]) {
      expect(await callerFor(role).catalog.items(), role).toEqual(owner);
    }
    expect(await callerFor('receiver').catalog.items()).toEqual(owner.map((r) => ({ ...r, listPrice: null })));
  });

  it('catalog.productDetail: receiver and chef get every price null; money roles unchanged', async () => {
    const owner = await callerFor('owner').catalog.productDetail({ productId: A.productId });
    expect(owner?.items.some((it) => it.listPrice !== null)).toBe(true);
    expect(owner?.history.length).toBeGreaterThan(0);
    for (const role of MONEY_ROLES) {
      expect(await callerFor(role).catalog.productDetail({ productId: A.productId }), role).toEqual(owner);
    }
    for (const role of ['receiver', 'chef'] as Role[]) {
      const d = await callerFor(role).catalog.productDetail({ productId: A.productId });
      expect(d, role).toEqual({
        product: owner!.product,
        items: owner!.items.map((it) => ({ ...it, listPrice: null, unitPricePerDefaultUnit: null })),
        cheapestUnitPrice: null,
        history: owner!.history.map((h) => ({ ...h, unitPrice: null })),
      });
    }
  });

  it('recovery.returnedThisMonth: receiver and chef get returnedAgorot null; the count stays', async () => {
    const owner = await callerFor('owner').recovery.returnedThisMonth();
    expect(typeof owner.returnedAgorot).toBe('number');
    for (const role of MONEY_ROLES) {
      expect(await callerFor(role).recovery.returnedThisMonth(), role).toEqual(owner);
    }
    for (const role of ['receiver', 'chef'] as Role[]) {
      expect(await callerFor(role).recovery.returnedThisMonth(), role).toEqual({ ...owner, returnedAgorot: null });
    }
  });
});
