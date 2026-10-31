import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, poLines, purchaseOrders, restaurants, supplierContractPrices } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Owner decision 31.10 (pilot, train A): the chef orders for their own restaurant
 * freely — creates, edits, sends and cancels, no manager approval, and sees prices
 * and totals on the orders screens. Document settings and PO import stay owner /
 * manager; the receiver writes nothing; the bookkeeper reads only.
 */
const db = createDb(testDbUrl());
let A: Tenant;

type Role = NonNullable<Session['role']>;
const ROLES: Role[] = ['owner', 'manager', 'chef', 'receiver', 'bookkeeper'];
const WRITERS: Role[] = ['owner', 'manager', 'chef'];
const MANAGERS: Role[] = ['owner', 'manager'];

function callerFor(role: Role) {
  const session: Session = { userId: A.ownerUserId, restaurantId: A.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

const LINE = { rawDescription: 'עגבניות', qty: 4, unit: 'ק״ג', unitPriceExpected: 6.5 };

/** A fresh draft (made by the owner) with one line. */
async function draft() {
  const { poId } = await callerFor('owner').orders.createDraft({ supplierId: A.supplierId, lines: [LINE, { ...LINE, rawDescription: 'מלפפונים' }] });
  const [line] = await db.select({ id: poLines.id }).from(poLines).where(eq(poLines.poId, poId)).limit(1);
  return { poId, lineId: line!.id };
}

/** Every order write, each from a fresh draft. Returns the call's outcome. */
const WRITES: Record<string, (role: Role) => Promise<unknown>> = {
  createDraft: (role) => callerFor(role).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] }),
  captureFromText: (role) => callerFor(role).orders.captureFromText({ text: `הזמנה ל${A.supplierName}:\n3 ק״ג עגבניות`, supplierId: A.supplierId }),
  updateOrderLine: async (role) => {
    const { lineId } = await draft();
    return callerFor(role).orders.updateOrderLine({ lineId, patch: { qtyOrdered: 7 } });
  },
  deleteOrderLine: async (role) => {
    const { lineId } = await draft();
    return callerFor(role).orders.deleteOrderLine({ lineId });
  },
  cancelOrder: async (role) => {
    const { poId } = await draft();
    return callerFor(role).orders.cancelOrder({ poId });
  },
  placeOrder: async (role) => {
    const { poId } = await draft();
    return callerFor(role).orders.placeOrder({ poId, channel: 'none' });
  },
  documentPreview: async (role) => {
    const { poId } = await draft();
    return callerFor(role).orders.documentPreview({ poId });
  },
};

describe('orders · role × procedure (chef orders freely)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db
      .update(restaurants)
      .set({ settings: { features: { orderCapture: true, orderPricesOut: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  for (const [name, call] of Object.entries(WRITES)) {
    it(`${name}: owner / manager / chef allowed; receiver and bookkeeper FORBIDDEN`, async () => {
      for (const role of ROLES) {
        const run = call(role);
        if (WRITERS.includes(role)) await expect(run, `${name} as ${role}`).resolves.toBeDefined();
        else await expect(run, `${name} as ${role}`).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });
  }

  it('the chef places a record-only order end to end, and sees its prices and total', async () => {
    const chef = callerFor('chef');
    const { poId } = await chef.orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    await expect(chef.orders.placeOrder({ poId, channel: 'none' })).resolves.toMatchObject({ ok: true, sentChannel: null });
    const got = await chef.orders.get({ poId });
    expect(got.po).toMatchObject({ status: 'sent', sentChannel: null, totalEstimated: '26.00' });
    expect(got.lines[0]).toMatchObject({ unitPriceExpected: '6.5000' });
    const listed = await chef.orders.list();
    expect(listed.find((o) => o.id === poId)).toMatchObject({ totalEstimated: '26.00', sentChannel: null });
    await expect(chef.orders.sendStatus({ poId })).resolves.toMatchObject({ state: 'none', final: true });
  });

  it('a receiver write leaves nothing behind', async () => {
    const before = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, A.restaurantId));
    await expect(callerFor('receiver').orders.createDraft({ supplierId: A.supplierId, lines: [LINE] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const after = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, A.restaurantId));
    expect(after).toHaveLength(before.length);
  });

  it('the bookkeeper reads: list, get, sendStatus, documentSettings', async () => {
    const { poId } = await draft();
    const bk = callerFor('bookkeeper');
    await expect(bk.orders.list()).resolves.toBeInstanceOf(Array);
    await expect(bk.orders.get({ poId })).resolves.toMatchObject({ po: { id: poId } });
    await expect(bk.orders.sendStatus({ poId })).resolves.toMatchObject({ state: 'none' });
    await expect(bk.orders.documentSettings()).resolves.toMatchObject({ enabled: true });
  });

  it('document settings: owner / manager only', async () => {
    for (const role of ROLES) {
      const run = callerFor(role).orders.setDocumentSettings({ showPrices: false });
      if (MANAGERS.includes(role)) await expect(run, role).resolves.toEqual({ showPrices: false });
      else await expect(run, role).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('contracts.orderPrices: the chef reorders at CONTRACT prices; receiver / bookkeeper FORBIDDEN; a foreign supplier NOT_FOUND', async () => {
    await db
      .update(restaurants)
      .set({ settings: { features: { orderCapture: true, orderPricesOut: true, contracts: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
    await db.insert(supplierContractPrices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: '40',
      validFrom: '2020-01-01',
      validTo: null,
      unit: 'kg',
    });
    const items = [{ productId: A.productId, unit: 'kg' }];
    // A chef's "הזמן שוב" gets the contract price, never the list price (a PO at list price would mask an over-contract invoice).
    await expect(callerFor('chef').contracts.orderPrices({ supplierId: A.supplierId, items })).resolves.toEqual({
      enabled: true,
      prices: [{ productId: A.productId, unit: 'kg', contractPrice: 40 }],
    });
    for (const role of ['receiver', 'bookkeeper'] as const) {
      await expect(callerFor(role).contracts.orderPrices({ supplierId: A.supplierId, items }), role).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const B = await seedTenant(db, 'B');
    await expect(callerFor('chef').contracts.orderPrices({ supplierId: B.supplierId, items })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('PO import: owner / manager only (the role gate comes before the OCR gate)', async () => {
    for (const role of ['chef', 'receiver', 'bookkeeper'] as const) {
      await expect(
        callerFor(role).orders.importPo({ platform: 'zestt', file: { filename: 'po.pdf', base64: 'JVBERi0=' } }),
        role,
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
