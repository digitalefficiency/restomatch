import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import {
  and,
  auditLog,
  catalogImports,
  createDb,
  eq,
  poLines,
  purchaseOrders,
  supplierCatalogItems,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { orderPriceKey, resolveExpectedPrice } from '../orders/expectedPrice';
import { pendingListDiffs } from '../priceAlerts/priceListDiff';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · review round 2 of catalog.revertImport (orchestrator 21.11): one
 * test per finding. The worker-side findings (MINOR 4 double commit, MINOR 5
 * chunks, a failing chunk) are in apps/worker importCatalogChunks.db.test.ts.
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

type Row = { sku: string | null; name?: string; price: number | null; unit?: string; pack?: number | null };
const toRow = (r: Row) => ({
  supplierSku: r.sku,
  supplierNameRaw: r.name ?? r.sku ?? '',
  unit: r.unit ?? 'ק״ג',
  listPrice: r.price,
  barcodeEan: null,
  packSize: r.pack ?? null,
});

async function importRows(rows: Row[]) {
  const [imp] = await db
    .insert(catalogImports)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, filename: 'p.csv', status: 'committed', createdBy: A.ownerUserId })
    .returning({ id: catalogImports.id });
  const res = await commitCatalogRows(
    db,
    { restaurantId: A.restaurantId, supplierId: A.supplierId, sourceImportId: imp!.id, userId: A.ownerUserId },
    rows.map(toRow),
    embedder,
  );
  return { id: imp!.id, res };
}

async function item(sku: string) {
  const [r] = await db
    .select({
      id: supplierCatalogItems.id,
      productId: supplierCatalogItems.productId,
      price: supplierCatalogItems.listPrice,
      unit: supplierCatalogItems.unit,
      pack: supplierCatalogItems.packSize,
      active: supplierCatalogItems.active,
      sourceImportId: supplierCatalogItems.sourceImportId,
      updatedAt: supplierCatalogItems.updatedAt,
      observedAt: supplierCatalogItems.observedAt,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
  return r!;
}
const revert = (id: string) => callerFor(A).catalog.revertImport({ importId: id });
const auditRows = (action: string) =>
  db
    .select({ entityId: auditLog.entityId, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, action)));

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('round 2 MAJOR 1 · a blank price keeps its unit and pack', () => {
  it('12.00/kg stays 12.00/kg when the file has no price but says "case of 12"', async () => {
    await importRows([{ sku: 'M', price: 12, unit: 'ק״ג', pack: null }]);
    const { res } = await importRows([{ sku: 'M', price: null, unit: 'ארגז', pack: 12 }]);
    const m = await item('M');
    expect(Number(m.price)).toBe(12);
    expect(m.unit).toBe('ק״ג');
    expect(m.pack).toBeNull();
    // Nothing else moved, so the row is not written at all.
    expect(res).toMatchObject({ keptPriceOnBlank: 1, updated: 0, unchanged: 1 });
  });
});

describe('round 2 MAJOR 2 · blank and unchanged rows keep their times', () => {
  it('a file with no prices does not restamp the list over a newer PO price', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const before = await item('M');
    const sentAt = new Date(before.updatedAt.getTime() + 60_000);
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'sent', source: 'manual', sentAt, createdAt: sentAt })
      .returning({ id: purchaseOrders.id });
    await db.insert(poLines).values({ poId: po!.id, productId: before.productId, qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '4.5' });

    await importRows([{ sku: 'M', price: null }]);
    const after = await item('M');
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.observedAt?.getTime()).toBe(before.observedAt?.getTime());
    const expected = await resolveExpectedPrice(db, {
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      at: new Date(sentAt.getTime() + 3_600_000),
      lines: [{ productId: before.productId!, unit: 'ק״ג' }],
    });
    expect(expected.get(orderPriceKey(before.productId!, 'ק״ג'))).toMatchObject({ source: 'last_po', unitPrice: 4.5 });
  });
});

describe('round 2 MAJOR 3 · a no-op write takes no ownership', () => {
  it("B re-listing A's 6 as 6 leaves the row A's; reverting B then A brings 5 back", async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'M', price: 6 }]);
    const b = await importRows([{ sku: 'M', price: 6 }]);
    expect((await item('M')).sourceImportId).toBe(a.id);
    const rb = await revert(b.id);
    expect(rb).toMatchObject({ restored: 0, skipped: [] });
    expect((await revert(a.id)).restored).toBe(1);
    expect(Number((await item('M')).price)).toBe(5);
  });
});

describe('round 2 decision (b) · only the latest import can be undone', () => {
  it('an older import is refused with its own reason and no audit row; the list offers only the latest', async () => {
    const a = await importRows([{ sku: 'M', price: 5 }]);
    const b = await importRows([{ sku: 'M', price: 6 }]);
    await expect(revert(a.id)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('CATALOG_IMPORT_NOT_LATEST'),
    });
    expect(await auditRows('catalog.import_reverted')).toEqual([]);
    const list = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    expect(list.find((i) => i.id === a.id)).toMatchObject({ revertable: false });
    expect(list.find((i) => i.id === b.id)).toMatchObject({ revertable: true });
    await revert(b.id);
    const after = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    expect(after.find((i) => i.id === a.id)).toMatchObject({ revertable: true });
    expect(after.find((i) => i.id === b.id)).toMatchObject({ revertable: false, reverted: true });
  });
});

describe('round 2 MINOR 4 · committed twice', () => {
  it('two import_committed records for one import → not revertable, nothing written', async () => {
    const a = await importRows([{ sku: 'M', price: 5 }]);
    const [rec] = await auditRows('catalog.import_committed');
    await db.insert(auditLog).values({
      restaurantId: A.restaurantId,
      action: 'catalog.import_committed',
      entityType: 'catalog_import',
      entityId: a.id,
      after: rec!.after as never,
    });
    await expect(revert(a.id)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('CATALOG_IMPORT_NOT_REVERTABLE'),
    });
    expect((await item('M')).active).toBe(true);
    const list = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    expect(list.find((i) => i.id === a.id)).toMatchObject({ revertable: false });
  });
});

describe('round 2 MINOR 6 · the preview judges the row the commit writes', () => {
  const mapping = { sku: 'sku', name: 'name', unit: 'unit', price: 'price' };
  const preview = (text: string) =>
    callerFor(A).catalog.parsePreview({ supplierId: A.supplierId, file: { filename: 'p.csv', text }, mapping });

  it('an inactive row the commit will reprice is still checked for outliers', async () => {
    await importRows([{ sku: 'M', price: 10 }]);
    await db.update(supplierCatalogItems).set({ active: false }).where(eq(supplierCatalogItems.id, (await item('M')).id));
    const p = await preview('sku,name,unit,price\nM,חלב,ק״ג,100\n');
    expect(p.check.rows[0]).toMatchObject({ currentPrice: 10, flag: 'HIGH' });
  });

  it('a blank cell on a priced row says the current price is kept; a no-SKU row matches by the name key', async () => {
    await importRows([{ sku: 'M', price: 10 }, { sku: null, name: 'שמן  זית', price: 30 }]);
    const p = await preview('sku,name,unit,price\nM,חלב,ק״ג,\n,שמן זית,ק״ג,31\n');
    expect(p.check.rows[0]).toMatchObject({ price: null, currentPrice: 10, keepsPrice: true });
    expect(p.check.rows[1]).toMatchObject({ currentPrice: 30, keepsPrice: false });
  });
});

describe('round 2 MINOR 7 · a revert-off expires', () => {
  it('a row a person turned off after the revert stays off on re-import', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'NEW', price: 9 }]);
    await revert(a.id);
    const id = (await item('NEW')).id;
    await callerFor(A).catalog.setItemActive({ itemId: id, active: true });
    await callerFor(A).catalog.setItemActive({ itemId: id, active: false });
    await importRows([{ sku: 'NEW', price: 8 }]);
    const n = await item('NEW');
    expect(n.active).toBe(false);
    expect(Number(n.price)).toBe(8);
  });
});

describe('round 2 MINOR 8 · pack size at the stored scale', () => {
  it('12.3456 is recorded as stored (12.346): the revert matches and a re-import is a no-op', async () => {
    await importRows([{ sku: 'M', price: 5, pack: null }]);
    const b = await importRows([{ sku: 'M', price: 5, pack: 12.3456 }]);
    expect((await item('M')).pack).toBe('12.346');
    const again = await importRows([{ sku: 'M', price: 5, pack: 12.3456 }]);
    expect(again.res).toMatchObject({ updated: 0, unchanged: 1 });
    await revert(again.id);
    expect((await revert(b.id)).restored).toBe(1);
    expect((await item('M')).pack).toBeNull();
  });
});

describe('round 2 MINOR 9 · AU-13 does not announce a reverted import', () => {
  it('a reverted import with a rise is left out of the morning list', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const b = await importRows([{ sku: 'M', price: 6 }]);
    const before = await pendingListDiffs(db, A.restaurantId, new Date(), 'Asia/Jerusalem');
    expect(before.map((s) => s.importId)).toEqual([b.id]);
    await revert(b.id);
    expect(await pendingListDiffs(db, A.restaurantId, new Date(), 'Asia/Jerusalem')).toEqual([]);
  });
});

describe('round 2 MINOR 10 · concurrency and deleted rows', () => {
  it('two reverts at once: one succeeds, one CONFLICT, one import_reverted row', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const b = await importRows([{ sku: 'M', price: 6 }, { sku: 'NEW', price: 9 }]);
    const out = await Promise.allSettled([revert(b.id), revert(b.id)]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = out.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    expect(await auditRows('catalog.import_reverted')).toHaveLength(1);
    expect(Number((await item('M')).price)).toBe(5);
  });

  it('a row deleted since the import is skipped as GONE', async () => {
    await importRows([{ sku: 'M', price: 5 }, { sku: 'K', price: 2 }]);
    const b = await importRows([{ sku: 'M', price: 6 }, { sku: 'K', price: 3 }]);
    const k = await item('K');
    await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.id, k.id));
    const r = await revert(b.id);
    expect(r.restored).toBe(1);
    expect(r.skipped).toEqual([{ itemId: k.id, name: 'K', reason: 'GONE' }]);
  });
});

describe('round 2 nits · the revert record', () => {
  it('restoredItems[].to carries the restored times and owner', async () => {
    const a = await importRows([{ sku: 'M', price: 5 }]);
    const before = await item('M');
    const b = await importRows([{ sku: 'M', price: 6 }]);
    await revert(b.id);
    const [rec] = await auditRows('catalog.import_reverted');
    const to = (rec!.after as { restoredItems: Array<{ to: Record<string, unknown>; from: Record<string, unknown> }> })
      .restoredItems[0]!;
    expect(to.to).toMatchObject({
      listPrice: before.price,
      updatedAt: before.updatedAt.toISOString(),
      observedAt: before.observedAt!.toISOString(),
      sourceImportId: a.id,
    });
    expect(to.from).toMatchObject({ sourceImportId: b.id });
  });
});
