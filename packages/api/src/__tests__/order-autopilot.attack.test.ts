import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, poLines, purchaseOrders } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { PRICE_KEY } from '../orders/access';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-09 / AU-11 cross-tenant + role attacks on the autopilot procedures:
 * orders.preparedDrafts (isolation) and orders.dismissPreparedDraft (attack).
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let aDraft: string;
let bDraft: string;

const callerFor = (t: Tenant, role: Session['role'] = 'manager') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

/** An unopened autopilot draft (what prepareOrderDraft inserts), with one priced line. */
async function autopilotDraft(t: Tenant, ref: string) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'draft', source: 'recurring', sourceRef: ref, createdBy: null, totalEstimated: '85.00' })
    .returning({ id: purchaseOrders.id });
  await db.insert(poLines).values({ poId: po!.id, productId: t.productId, rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' });
  return po!.id;
}

const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), keysDeep(x, out));
  return out;
};

describe('W3-09 order autopilot — A → B attacks and roles', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    aDraft = await autopilotDraft(A, `au:A16:${A.supplierId}:2026-11-15`);
    bDraft = await autopilotDraft(B, `au:A16:${B.supplierId}:2026-11-15`);
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it("preparedDrafts: A's banner lists only A's drafts, never B's", async () => {
    const rows = await callerFor(A).orders.preparedDrafts();
    expect(rows.map((r) => r.poId)).toEqual([aDraft]);
    expect(rows.some((r) => r.poId === bDraft || r.supplierId === B.supplierId)).toBe(false);
  });

  it("dismissPreparedDraft: B's poId → NOT_FOUND, B's draft stays a draft", async () => {
    await expect(callerFor(A).orders.dismissPreparedDraft({ poId: bDraft, clientMutationId: 'atk-w309-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [b] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, bDraft));
    expect(b).toMatchObject({ status: 'draft', createdBy: null });
  });

  it('receiver and bookkeeper: FORBIDDEN on both, nothing changes', async () => {
    for (const role of ['receiver', 'bookkeeper'] as const) {
      await expect(callerFor(A, role).orders.preparedDrafts()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A, role).orders.dismissPreparedDraft({ poId: aDraft, clientMutationId: `atk-w309-${role}` })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    const [a] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, aDraft));
    expect(a!.status).toBe('draft');
  });

  it('the chef sees ₪ on orders; the owner/manager too', async () => {
    for (const role of ['chef', 'owner', 'manager'] as const) {
      const rows = await callerFor(A, role).orders.preparedDrafts();
      expect(rows[0]!.totalEstimated).toBe('85.00');
    }
    // and the payload only ever carries price keys the orders redaction knows
    const keys = keysDeep(await callerFor(A, 'chef').orders.preparedDrafts());
    expect(keys.filter((k) => PRICE_KEY.test(k))).toEqual(['totalEstimated']);
  });

  it('dismiss: the owner cancels A’s unopened draft; a replay returns the same answer; a human draft → CONFLICT', async () => {
    const c = callerFor(A, 'owner');
    expect(await c.orders.dismissPreparedDraft({ poId: aDraft, clientMutationId: 'w309-dismiss-1' })).toEqual({ status: 'cancelled' });
    expect(await c.orders.dismissPreparedDraft({ poId: aDraft, clientMutationId: 'w309-dismiss-1' })).toEqual({ status: 'cancelled' });
    await expect(c.orders.dismissPreparedDraft({ poId: A.poId, clientMutationId: 'w309-dismiss-2' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
