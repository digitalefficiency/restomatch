import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memberships, withRestaurant, withUser } from '@restomatch/db';
import { whereIs } from '../tasks/whereIs';
import { as, db, fresh, seedStaffed } from './tasks-fixtures';

beforeEach(fresh);
afterAll(fresh);

describe('nav.whereIs (W2-08 §5.6) — cross-branch 404, no existence oracle', () => {
  it("a non-member asking for B's invoice gets exactly what a random uuid gets", async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    const c = as(a, 'owner');
    const foreign = await c.nav.whereIs({ kind: 'invoice', id: b.invoiceId });
    const random = await c.nav.whereIs({ kind: 'invoice', id: randomUUID() });
    expect(foreign).toEqual({ found: false });
    expect(foreign).toEqual(random);
    for (const [kind, id] of [['po', b.poId], ['supplier', b.supplierId]] as const) {
      expect(await c.nav.whereIs({ kind, id })).toEqual({ found: false });
    }
  });

  it('a member of both gets {restaurantId, name, path}', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await db.insert(memberships).values({ userId: a.ownerUserId, restaurantId: b.restaurantId, role: 'owner' });
    const r = await as(a, 'owner').nav.whereIs({ kind: 'invoice', id: b.invoiceId });
    expect(r).toEqual({ found: true, restaurantId: b.restaurantId, name: 'Resto B', path: `/dashboard/invoices/${b.invoiceId}` });
    // Its own branch's record is not "elsewhere".
    expect(await as(a, 'owner').nav.whereIs({ kind: 'invoice', id: a.invoiceId })).toEqual({ found: false });
  });

  it('every lookup runs inside withRestaurant, one per membership', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await db.insert(memberships).values({ userId: a.ownerUserId, restaurantId: b.restaurantId, role: 'manager' });
    const spy = vi.fn(withRestaurant);
    await withUser(db, a.ownerUserId, (tx) => whereIs(tx, a.ownerUserId, a.restaurantId, 'po', randomUUID(), { scoped: spy as typeof withRestaurant }));
    // One scoped lookup per OTHER membership, never an unscoped query.
    expect(spy.mock.calls.map((c) => c[1])).toEqual([b.restaurantId]);
  });
});
