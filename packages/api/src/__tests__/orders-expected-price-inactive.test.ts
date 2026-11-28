import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, supplierCatalogItems } from '@restomatch/db';
import { orderPriceKey, resolveExpectedPrice } from '../orders/expectedPrice';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 review m7 — a deactivated catalog row (e.g. one an import revert
 * switched off) is never an expected 'list' price.
 */
const db = createDb(testDbUrl());
let A: Tenant;
const KG = 'kg';
const T0 = new Date('2026-09-01T08:00:00Z');
const T1 = new Date('2026-10-01T08:00:00Z');
const NOW = new Date('2026-10-25T08:00:00Z');

async function listRow(price: string, updatedAt: Date, active: boolean) {
  await db.insert(supplierCatalogItems).values({
    restaurantId: A.restaurantId,
    supplierId: A.supplierId,
    productId: A.productId,
    supplierNameRaw: `tomato-${price}-${active ? 'on' : 'off'}`,
    unit: KG,
    listPrice: price,
    active,
    updatedAt,
  });
}

const resolve = () =>
  resolveExpectedPrice(db, {
    restaurantId: A.restaurantId,
    supplierId: A.supplierId,
    at: NOW,
    lines: [{ productId: A.productId, unit: KG }],
  }).then((m) => m.get(orderPriceKey(A.productId, KG)) ?? null);

describe('resolveExpectedPrice — inactive catalog rows (m7)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('the only priced row is inactive → no entry', async () => {
    await listRow('12.0000', T0, false);
    expect(await resolve()).toBeNull();
  });

  it('an inactive row never stands in, even when it is newer', async () => {
    await listRow('12.0000', T0, true);
    await listRow('99.0000', T1, false);
    expect(await resolve()).toEqual({ unitPrice: 12, source: 'list', asOf: T0.toISOString() });
  });
});
