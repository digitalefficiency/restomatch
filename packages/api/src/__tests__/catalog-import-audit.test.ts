import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, auditLog, createDb, eq, testDbUrl } from '@restomatch/db';
import { commitCatalogRows, IMPORT_COMMITTED_AUDIT_ACTION, type ImportPriceChange } from '../catalog/commit';
import { IMPORT_COMMITTED_AUDIT, listDiffSection, type PriceChange } from '../priceAlerts/priceListDiff';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · every committed price-list import writes ONE `catalog.import_committed`
 * audit row carrying the list-price changes — the record AU-13's priceListDiff
 * reads (its own reader is exercised here, so the two can never drift).
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

const row = (o: { sku: string; name: string; price: number | null; unit?: string }) => ({
  supplierSku: o.sku,
  supplierNameRaw: o.name,
  unit: o.unit ?? 'ק״ג',
  listPrice: o.price,
  barcodeEan: null,
  packSize: null,
});

async function audits(t: Tenant) {
  return db
    .select({ entityId: auditLog.entityId, userId: auditLog.userId, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, t.restaurantId), eq(auditLog.action, IMPORT_COMMITTED_AUDIT_ACTION)));
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('W3-10 catalog.import_committed', () => {
  it('uses the action name AU-13 reads', () => {
    expect(IMPORT_COMMITTED_AUDIT_ACTION).toBe(IMPORT_COMMITTED_AUDIT);
  });

  it('records only real list-price changes (integer price units), with who and which import', async () => {
    const args = { restaurantId: A.restaurantId, supplierId: A.supplierId };
    await commitCatalogRows(
      db,
      args,
      [row({ sku: 'M-1', name: 'חלב', price: 5.9, unit: 'ל' }), row({ sku: 'S-1', name: 'סוכר', price: 4 }), row({ sku: 'N-1', name: 'בלי מחיר', price: null })],
      embedder,
    );
    const first = await audits(A);
    expect(first).toHaveLength(1);
    expect((first[0]!.after as { priceChanges: unknown[] }).priceChanges).toEqual([]); // first import: nothing to compare

    const res = await commitCatalogRows(
      db,
      { ...args, sourceImportId: null, userId: A.ownerUserId },
      [
        row({ sku: 'M-1', name: 'חלב', price: 6.08, unit: 'ל' }), // rise
        row({ sku: 'S-1', name: 'סוכר', price: 4.0 }), // same price in another spelling → not a change
        row({ sku: 'N-1', name: 'בלי מחיר', price: 3 }), // had no price → not a change
        row({ sku: 'X-1', name: 'חדש', price: 9 }), // new row → not a change
      ],
      embedder,
    );
    expect(res.priceChanges).toHaveLength(1);
    const rows = await audits(A);
    expect(rows).toHaveLength(2);
    const second = rows.find((r) => r.userId === A.ownerUserId)!;
    const after = second.after as { supplierId: string; updated: number; created: number; priceChanges: ImportPriceChange[] };
    expect(after).toMatchObject({ supplierId: A.supplierId, updated: 3, created: 1 });
    expect(after.priceChanges).toHaveLength(1);
    expect(after.priceChanges[0]).toMatchObject({ name: 'חלב', sku: 'M-1', unit: 'ל' });
    expect(Number(after.priceChanges[0]!.oldListPrice)).toBe(5.9);
    expect(Number(after.priceChanges[0]!.newListPrice)).toBe(6.08);
    expect(after.priceChanges[0]!.productId).toEqual(expect.any(String));

    // AU-13's own reader turns the record into its mail section: 5.90 → 6.08 = +305 bp.
    const section = listDiffSection({
      importId: 'imp',
      supplierName: A.supplierName,
      importedOn: '2026-11-14',
      changes: after.priceChanges as unknown as PriceChange[],
    });
    expect(section).not.toBeNull();
    expect(JSON.stringify(section)).toContain('305');
  });

  it("an import is recorded only in its own restaurant", async () => {
    const B = await seedTenant(db, 'B');
    await commitCatalogRows(db, { restaurantId: B.restaurantId, supplierId: B.supplierId }, [row({ sku: 'B', name: 'של B', price: 1 })], embedder);
    expect(await audits(A)).toHaveLength(0);
    expect(await audits(B)).toHaveLength(1);
  });
});
