import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  productAliases,
  supplierCatalogItems,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-08 · mapping.unmapped now also lists price-list rows the link policy sent to
 * review (saved unlinked, SKU-keyed). Cross-tenant: B's review rows never list
 * for A, and confirming with B's supplier is NOT_FOUND with nothing written.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function reviewRow(t: Tenant, sku: string, name: string) {
  const [r] = await db
    .insert(supplierCatalogItems)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, productId: null, supplierSku: sku, supplierNameRaw: name })
    .returning({ id: supplierCatalogItems.id });
  return r!.id;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => resetDb(db));

describe('G-08 mapping.unmapped — catalog review rows', () => {
  it('lists an unlinked SKU-keyed price-list row for its own tenant', async () => {
    await reviewRow(A, 'G08-A', 'פלפל אדום חריף');
    const rows = await callerFor(A).mapping.unmapped();
    expect(rows).toContainEqual(
      expect.objectContaining({ supplierId: A.supplierId, supplierSku: 'G08-A', sampleDescription: 'פלפל אדום חריף' }),
    );
  });

  it("tenant B's review rows never list for A", async () => {
    await reviewRow(B, 'G08-B', 'שורה של B');
    const rows = await callerFor(A).mapping.unmapped();
    expect(rows.some((r) => r.supplierSku === 'G08-B' || r.supplierId === B.supplierId)).toBe(false);
    const filtered = await callerFor(A).mapping.unmapped({ supplierId: B.supplierId });
    expect(filtered).toEqual([]);
  });

  it("confirm with B's supplierId → NOT_FOUND, and nothing is written", async () => {
    const itemB = await reviewRow(B, 'G08-B', 'שורה של B');
    const aliasesBefore = await db.select({ id: productAliases.id }).from(productAliases);
    await expect(
      callerFor(A).mapping.confirm({
        supplierId: B.supplierId,
        supplierSku: 'G08-B',
        rawName: 'שורה של B',
        productId: A.productId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [item] = await db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, itemB));
    expect(item?.productId).toBeNull();
    expect(await db.select({ id: productAliases.id }).from(productAliases)).toEqual(aliasesBefore);
  });

  it('confirm links the review row with a 1.000 (human) alias', async () => {
    const itemA = await reviewRow(A, 'G08-A', 'פלפל אדום חריף');
    await callerFor(A, 'manager').mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: 'G08-A',
      rawName: 'פלפל אדום חריף',
      productId: A.productId,
    });
    const [item] = await db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, itemA));
    expect(item?.productId).toBe(A.productId);
    const [alias] = await db
      .select({ confidence: productAliases.confidence })
      .from(productAliases)
      .where(eq(productAliases.supplierNameRaw, 'פלפל אדום חריף'));
    expect(alias?.confidence).toBe('1.000');
    expect((await callerFor(A).mapping.unmapped()).some((r) => r.supplierSku === 'G08-A')).toBe(false);
  });
});
