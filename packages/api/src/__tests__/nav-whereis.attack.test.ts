import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, memberships, withRestaurant, withUser } from '@restomatch/db';
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

  // Warden notes (11.11): add-only negative cases.
  it('claim and count kinds: a non-member gets the same as a random uuid', async () => {
    const a = await seedStaffed('A');
    await seedStaffed('B');
    for (const kind of ['claim', 'count'] as const) {
      expect(await as(a, 'owner').nav.whereIs({ kind, id: randomUUID() })).toEqual({ found: false });
    }
  });

  it('a role that cannot open the page in the other branch is not searched (no in-branch existence hint)', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await db.insert(memberships).values({ userId: a.ownerUserId, restaurantId: b.restaurantId, role: 'receiver' });
    expect(await as(a, 'owner').nav.whereIs({ kind: 'invoice', id: b.invoiceId })).toEqual({ found: false });
    const spy = vi.fn(withRestaurant);
    await withUser(db, a.ownerUserId, (tx) => whereIs(tx, a.ownerUserId, a.restaurantId, 'invoice', b.invoiceId, { scoped: spy as typeof withRestaurant }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('two roles in one branch → one lookup', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await db.insert(memberships).values([
      { userId: a.ownerUserId, restaurantId: b.restaurantId, role: 'manager' },
      { userId: a.ownerUserId, restaurantId: b.restaurantId, role: 'bookkeeper' },
    ]);
    const spy = vi.fn(withRestaurant);
    await withUser(db, a.ownerUserId, (tx) => whereIs(tx, a.ownerUserId, a.restaurantId, 'invoice', randomUUID(), { scoped: spy as typeof withRestaurant }));
    expect(spy.mock.calls.map((c) => c[1])).toEqual([b.restaurantId]);
  });

  it('a removed membership (row deleted) no longer finds the record', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await db.insert(memberships).values({ userId: a.ownerUserId, restaurantId: b.restaurantId, role: 'owner' });
    expect((await as(a, 'owner').nav.whereIs({ kind: 'invoice', id: b.invoiceId })).found).toBe(true);
    await db.delete(memberships).where(and(eq(memberships.userId, a.ownerUserId), eq(memberships.restaurantId, b.restaurantId)));
    expect(await as(a, 'owner').nav.whereIs({ kind: 'invoice', id: b.invoiceId })).toEqual({ found: false });
  });

  it('a non-uuid id or an unknown kind is rejected (BAD_REQUEST)', async () => {
    const a = await seedStaffed('A');
    await expect(as(a, 'owner').nav.whereIs({ kind: 'invoice', id: 'not-a-uuid' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(as(a, 'owner').nav.whereIs({ kind: 'recipe' as never, id: randomUUID() })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
