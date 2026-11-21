/**
 * Shared set-up for the W2-07 inventory suites (sales, roles, guard, hand-off,
 * truth): two tenants with the flag on, members per role, products, prices and
 * receipts — all through the same test DB as the other inventory suites.
 */
import {
  createDb,
  eq,
  goodsReceipts,
  grLines,
  invoices,
  memberships,
  poLines,
  priceHistory,
  products,
  purchaseOrders,
  restaurants,
  testDbUrl,
  users,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { localToday } from '../inventory/data';
import { resetDb, seedTenant, type Tenant } from './fixtures';

export const db = createDb(testDbUrl());
export const TZ = 'Asia/Jerusalem';
const DAY = 86_400_000;
export const ymdAgo = (n: number) => localToday(TZ, new Date(Date.now() - n * DAY));
export const atAgo = (n: number) => new Date(`${ymdAgo(n)}T09:00:00Z`);

export type Role = NonNullable<Session['role']>;
export interface Lab {
  t: Tenant;
  /** userId per role (the owner is the tenant's owner). */
  users: Record<Role, string>;
}

export async function freshLab(tags: string[]): Promise<Lab[]> {
  await resetDb(db);
  const out: Lab[] = [];
  for (const tag of tags) {
    const t = await seedTenant(db, tag);
    await db
      .update(restaurants)
      .set({ settings: { features: { inventoryCount: true } } as unknown as RestaurantSettings })
      .where(eq(restaurants.id, t.restaurantId));
    await db.delete(invoices).where(eq(invoices.restaurantId, t.restaurantId));
    const ids = { owner: t.ownerUserId } as Record<Role, string>;
    for (const role of ['manager', 'chef', 'bookkeeper', 'receiver'] as const) {
      const [u] = await db.insert(users).values({ email: `${role}-${tag}@w207.test`, name: `${role} ${tag}`, emailVerified: new Date() }).returning();
      await db.insert(memberships).values({ userId: u!.id, restaurantId: t.restaurantId, role });
      ids[role] = u!.id;
    }
    out.push({ t, users: ids });
  }
  return out;
}

export const callerAs = (lab: Lab, role: Role) =>
  appRouter.createCaller({ db, session: { userId: lab.users[role], restaurantId: lab.t.restaurantId, role } } as AppContext);

export async function product(t: Tenant, name: string, unit: string, category: string | null) {
  const [p] = await db.insert(products).values({ restaurantId: t.restaurantId, canonicalName: name, defaultUnit: unit, category }).returning();
  return p!.id;
}

export const price = (t: Tenant, productId: string, daysAgo: number, unitPrice: string) =>
  db.insert(priceHistory).values({ restaurantId: t.restaurantId, productId, supplierId: t.supplierId, observedAt: atAgo(daysAgo), unitPrice });

/** A goods receipt of one product: `received` is NET accepted (as _count.ts writes it), `rejected` on top. */
export async function receipt(t: Tenant, productId: string, unit: string, daysAgo: number, received: string, rejected: string | null, status: 'completed' | 'partial' | 'pending') {
  const [po] = await db.insert(purchaseOrders).values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'closed' }).returning();
  const [pl] = await db.insert(poLines).values({ poId: po!.id, productId, rawDescription: 'x', qtyOrdered: '10', unit, unitPriceExpected: '1.0000' }).returning();
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId: t.restaurantId, poId: po!.id, receivedAt: atAgo(daysAgo), status }).returning();
  await db.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId, qtyReceived: received, qtyRejected: rejected ?? '0' });
}

/** Start a count on `daysAgo`, save `qty` per product, and (optionally) close it as the owner. */
export async function count(lab: Lab, daysAgo: number, qty: Record<string, string>, close = true, role: Role = 'owner') {
  const c = callerAs(lab, role);
  const { id } = await c.inventory.start({ countDate: ymdAgo(daysAgo) });
  await c.inventory.saveLines({ countId: id, lines: Object.entries(qty).map(([productId, q]) => ({ productId, qty: q })) });
  if (close) await callerAs(lab, 'owner').inventory.complete({ countId: id, acceptUncounted: true });
  return id;
}
