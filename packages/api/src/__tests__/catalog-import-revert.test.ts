import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, catalogImports, createDb, eq, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · catalog.revertImport undoes one committed import from its own audit
 * record: changed prices go back (only where untouched since), created rows are
 * turned off, one revert per import, restaurant-scoped, owner / manager only.
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;
let B: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

const row = (sku: string, name: string, price: number) => ({
  supplierSku: sku,
  supplierNameRaw: name,
  unit: 'ק״ג',
  listPrice: price,
  barcodeEan: null,
  packSize: null,
});

async function importRows(t: Tenant, rows: ReturnType<typeof row>[]) {
  const [imp] = await db
    .insert(catalogImports)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, filename: 'p.csv', status: 'committed', createdBy: t.ownerUserId })
    .returning({ id: catalogImports.id });
  await commitCatalogRows(db, { restaurantId: t.restaurantId, supplierId: t.supplierId, sourceImportId: imp!.id, userId: t.ownerUserId }, rows, embedder);
  return imp!.id;
}

async function item(t: Tenant, sku: string) {
  const [r] = await db
    .select({ price: supplierCatalogItems.listPrice, active: supplierCatalogItems.active })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, t.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
  return r!;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => resetDb(db));

describe('W3-10 catalog.revertImport', () => {
  it('restores changed prices, keeps a later change, turns off created rows; a second revert is refused', async () => {
    await importRows(A, [row('M-1', 'חלב', 5.9), row('S-1', 'סוכר', 4)]);
    const second = await importRows(A, [row('M-1', 'חלב', 6.08), row('S-1', 'סוכר', 4.5), row('N-1', 'חדש', 9)]);
    // Someone edits סוכר after the import: the revert must not overwrite that.
    await db.update(supplierCatalogItems).set({ listPrice: '4.7000' }).where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, 'S-1')));

    const res = await callerFor(A).catalog.revertImport({ importId: second });
    expect(res.restored).toBe(1);
    expect(res.deactivated).toBe(1);
    expect(res.skipped).toEqual([expect.objectContaining({ name: 'סוכר', reason: 'CHANGED_SINCE' })]);
    expect(Number((await item(A, 'M-1')).price)).toBe(5.9);
    expect(Number((await item(A, 'S-1')).price)).toBe(4.7);
    expect((await item(A, 'N-1')).active).toBe(false);

    const list = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    // Reverted: no longer offered (round 2 — only the latest un-reverted import is).
    expect(list.find((i) => i.id === second)).toMatchObject({ revertable: false, reverted: true });

    await expect(callerFor(A).catalog.revertImport({ importId: second })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("B's import id from A → NOT_FOUND, B's rows untouched", async () => {
    await importRows(B, [row('B-1', 'של B', 1)]);
    const bImport = await importRows(B, [row('B-1', 'של B', 2)]);
    await expect(callerFor(A).catalog.revertImport({ importId: bImport })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(Number((await item(B, 'B-1')).price)).toBe(2);
  });

  it.each(['chef', 'receiver', 'bookkeeper'] as const)('%s → FORBIDDEN', async (role) => {
    const id = await importRows(A, [row('M-1', 'חלב', 5.9)]);
    await expect(callerFor(A, role).catalog.revertImport({ importId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
