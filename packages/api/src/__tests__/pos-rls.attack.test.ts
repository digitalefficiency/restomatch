import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  eq,
  ensureRlsAppRole,
  posSales,
  posSalesImports,
  restaurants,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * RLS attack suite for 0058 (pos_sales / pos_sales_imports) on the real
 * non-owner app role: the migration's own tenant policies must hold even for
 * raw SQL that forgets a restaurant filter, and no row can be written into
 * another restaurant.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;

const fx = join(__dirname, '..', 'integrations', 'pos', '__tests__', 'fixtures', 'pos-sales-en-utf8.csv');
const file = { filename: 'sales.csv', base64: readFileSync(fx).toString('base64') };

function callerFor(t: Tenant) {
  const ctx: AppContext = { db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  for (const t of [A, B]) {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { integrations: true } } } as never)
      .where(eq(restaurants.id, t.restaurantId));
  }
  // Both import through the router on the RLS-enforced role.
  await callerFor(B).integrations.posImport(file);
  await callerFor(A).integrations.posImport(file);
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('0058 POS tables under RLS (app role)', () => {
  it('both tables have row security on', async () => {
    const rows = (await ownerDb.execute(sql`
      select relname, relrowsecurity from pg_class
      where relname in ('pos_sales', 'pos_sales_imports') order by relname
    `)) as unknown as Array<{ relname: string; relrowsecurity: boolean }>;
    expect(rows.map((r) => r.relrowsecurity)).toEqual([true, true]);
  });

  it('an unfiltered select as A sees only A rows', async () => {
    const seen = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ r: posSales.restaurantId }).from(posSales),
    );
    expect(seen.length).toBe(3);
    expect(new Set(seen.map((s) => s.r))).toEqual(new Set([A.restaurantId]));
    const imports = await withRestaurant(appDb, A.restaurantId, (tx) => tx.select().from(posSalesImports));
    expect(imports.every((i) => i.restaurantId === A.restaurantId)).toBe(true);
  });

  it('without a restaurant GUC nothing is visible', async () => {
    const rows = await appDb.select().from(posSales);
    expect(rows).toHaveLength(0);
  });

  it("A cannot write a row into B, nor delete B's rows", async () => {
    const [bImport] = await ownerDb
      .select({ id: posSalesImports.id })
      .from(posSalesImports)
      .where(eq(posSalesImports.restaurantId, B.restaurantId));
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(posSales).values({
          restaurantId: B.restaurantId,
          importId: bImport!.id,
          soldOn: '2026-12-01',
          itemRef: 'X',
          itemName: 'forged',
          qty: '1',
          netAmount: '1',
        }),
      ),
    ).rejects.toThrow(/row-level security/);
    await withRestaurant(appDb, A.restaurantId, (tx) => tx.delete(posSales).where(eq(posSales.restaurantId, B.restaurantId)));
    const bRows = await ownerDb.select().from(posSales).where(eq(posSales.restaurantId, B.restaurantId));
    expect(bRows).toHaveLength(3);
  });
});
