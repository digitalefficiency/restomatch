import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  inArray,
  memberships,
  purchaseOrders,
  restaurants,
  supplierConfirmLinks,
  suppliers,
  testDbUrl,
  users,
  type RestaurantSettings,
} from '@restomatch/db';
import { lookupPortalContact } from '../contactLookup';

/**
 * The supplier portal's call/WhatsApp contact (tenant-security review of W1-09):
 * only a CURRENT member of the ordering restaurant, only for a live link to a
 * non-cancelled order, only name + phone.
 */
const db = createDb(testDbUrl());
const conn = { adminDb: db, db };
const tag = `w109-${randomBytes(4).toString('hex')}`;
// Same token shape + hash as supplierConfirm/service (mintToken / hashSupplierToken).
const mintToken = () => randomBytes(32).toString('base64url');
const hashSupplierToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const ON = { features: { supplierConfirm: true } } as RestaurantSettings;

let restA = '';
let restB = '';
let ordererA = '';
let poA = '';
let poB = '';

async function link(restaurantId: string, poId: string, opts: { revoked?: boolean } = {}) {
  const token = mintToken();
  await db.insert(supplierConfirmLinks).values({
    restaurantId,
    poId,
    tokenHash: hashSupplierToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: opts.revoked ? new Date() : null,
  });
  return token;
}

beforeAll(async () => {
  const [a, b] = await db
    .insert(restaurants)
    .values([
      { name: `${tag} A`, settings: ON },
      { name: `${tag} B`, settings: ON },
    ])
    .returning({ id: restaurants.id });
  restA = a!.id;
  restB = b!.id;
  const [ua, ub] = await db
    .insert(users)
    .values([
      { email: `${tag}-a@test.local`, name: 'דנה', phone: '050-123-4567' },
      { email: `${tag}-b@test.local`, name: 'Bob', phone: '052-765-4321' },
    ])
    .returning({ id: users.id });
  ordererA = ua!.id;
  await db.insert(memberships).values([
    { userId: ua!.id, restaurantId: restA, role: 'manager' },
    { userId: ub!.id, restaurantId: restB, role: 'manager' },
  ]);
  const [sa, sb] = await db
    .insert(suppliers)
    .values([
      { restaurantId: restA, name: `${tag} sup A` },
      { restaurantId: restB, name: `${tag} sup B` },
    ])
    .returning({ id: suppliers.id });
  const [pa, pb] = await db
    .insert(purchaseOrders)
    .values([
      { restaurantId: restA, supplierId: sa!.id, status: 'sent', createdBy: ua!.id },
      { restaurantId: restB, supplierId: sb!.id, status: 'sent', createdBy: ub!.id },
    ])
    .returning({ id: purchaseOrders.id });
  poA = pa!.id;
  poB = pb!.id;
});

beforeEach(async () => {
  await db.update(purchaseOrders).set({ status: 'sent' }).where(eq(purchaseOrders.id, poA));
  await db
    .insert(memberships)
    .values({ userId: ordererA, restaurantId: restA, role: 'manager' })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(restaurants).where(inArray(restaurants.id, [restA, restB]));
  await db.delete(users).where(inArray(users.email, [`${tag}-a@test.local`, `${tag}-b@test.local`]));
});

describe('supplier portal contact', () => {
  it('a live link to a sent order → the orderer\'s name and phone, nothing else', async () => {
    const c = await lookupPortalContact(conn, await link(restA, poA));
    expect(c).toEqual({ name: 'דנה', tel: '+972501234567', wa: '972501234567' });
    expect(Object.keys(c!).sort()).toEqual(['name', 'tel', 'wa']);
    expect(JSON.stringify(c)).not.toContain('@');
  });

  it('unknown, revoked and expired links → null', async () => {
    expect(await lookupPortalContact(conn, mintToken())).toBeNull();
    expect(await lookupPortalContact(conn, 'not-a-token')).toBeNull();
    expect(await lookupPortalContact(conn, await link(restA, poA, { revoked: true }))).toBeNull();
    // A 1-hour link read 2 hours later.
    expect(await lookupPortalContact(conn, await link(restA, poA), new Date(Date.now() + 7_200_000))).toBeNull();
  });

  it('a cancelled order → null', async () => {
    const token = await link(restA, poA);
    await db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, poA));
    expect(await lookupPortalContact(conn, token)).toBeNull();
  });

  it('an orderer who left the restaurant → null', async () => {
    const token = await link(restA, poA);
    await db.delete(memberships).where(eq(memberships.userId, ordererA));
    expect(await lookupPortalContact(conn, token)).toBeNull();
  });

  it('a link can never point at another tenant\'s order (same-tenant FK)', async () => {
    await expect(link(restA, poB)).rejects.toThrow();
    // B's own link only ever yields B's orderer.
    expect((await lookupPortalContact(conn, await link(restB, poB)))?.name).toBe('Bob');
  });
});
