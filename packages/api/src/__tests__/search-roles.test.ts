import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, recipes } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { SEARCH_KINDS } from '../routers/search';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-04: `search.global` is role-filtered on the server and finds purchase
 * orders and recipes (add-only). The receiver finds no records; the chef finds
 * orders and recipes only; no result row carries a ₪ amount. Tenant-scoped.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const callerFor = (t: Tenant, role: Session['role']) =>
  appRouter.createCaller({
    db,
    session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role },
  } as AppContext);

const MONEY_KEYS = /total|price|amount|agorot|vat/i;

describe('search.global — roles, orders and recipes (W3-04)', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    await db.insert(recipes).values([
      { restaurantId: A.restaurantId, name: 'שקשוקה A', menuPriceAgorot: 5_400 },
      { restaurantId: B.restaurantId, name: 'שקשוקה B', menuPriceAgorot: 5_400 },
    ]);
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('owner finds orders by supplier name and recipes by name, own tenant only', async () => {
    // 'ספק' matches BOTH tenants' suppliers ('ספק A' / 'ספק B'): A must still get only its own POs.
    const shared = await callerFor(A, 'owner').search.global({ q: 'ספק' });
    expect(shared.orders.map((o) => o.id)).toContain(A.poId);
    expect(shared.orders.map((o) => o.id)).not.toContain(B.poId);
    expect(shared.orders.every((o) => o.supplierName === A.supplierName)).toBe(true);
    expect(shared.suppliers.map((s) => s.id)).not.toContain(B.supplierId);

    const rec = await callerFor(A, 'owner').search.global({ q: 'שקשוקה' });
    expect(rec.recipes.map((r) => r.name)).toEqual(['שקשוקה A']);
  });

  it('chef finds only orders and recipes', async () => {
    const out = await callerFor(A, 'chef').search.global({ q: A.supplierName });
    expect(out.suppliers).toEqual([]);
    expect(out.products).toEqual([]);
    expect(out.invoices).toEqual([]);
    expect(out.orders.map((o) => o.id)).toContain(A.poId);
    const rec = await callerFor(A, 'chef').search.global({ q: 'שקשוקה' });
    expect(rec.recipes).toHaveLength(1);
  });

  it('receiver finds no records at all (screens only)', async () => {
    for (const q of [A.supplierName, 'עגבניה', 'INV', 'שקשוקה']) {
      const out = await callerFor(A, 'receiver').search.global({ q });
      expect(out).toEqual({ suppliers: [], products: [], invoices: [], orders: [], recipes: [] });
    }
  });

  it('bookkeeper finds money records, not kitchen ones', async () => {
    const out = await callerFor(A, 'bookkeeper').search.global({ q: A.supplierName });
    expect(out.suppliers.map((s) => s.id)).toContain(A.supplierId);
    expect(out.orders).toEqual([]);
    expect((await callerFor(A, 'bookkeeper').search.global({ q: 'שקשוקה' })).recipes).toEqual([]);
  });

  it('no result row carries a ₪ field, for any role', async () => {
    // One query per kind-bearing word, so order AND recipe rows are both inspected.
    let inspected = 0;
    for (const role of Object.keys(SEARCH_KINDS) as Session['role'][]) {
      for (const q of [A.supplierName, 'שקשוקה']) {
        const out = await callerFor(A, role).search.global({ q });
        for (const rows of Object.values(out)) {
          for (const row of rows) {
            inspected += 1;
            expect(Object.keys(row).filter((k) => MONEY_KEYS.test(k))).toEqual([]);
          }
        }
      }
    }
    const owner = await callerFor(A, 'owner').search.global({ q: 'שקשוקה' });
    expect(owner.recipes.length).toBeGreaterThan(0);
    expect(inspected).toBeGreaterThan(0);
  });
});
