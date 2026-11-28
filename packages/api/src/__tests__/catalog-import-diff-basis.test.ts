import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, invoiceLines, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · the revert's merge with #335 ("מה ישתנה"): the diff in
 * catalog.parsePreview is priced on the basis the import will WRITE — the row
 * the commit writes, a blank price cell at the price it keeps (no ↑/↓, ₪0),
 * and the unit / pack the commit stores (storedBasis). A basis change is priced
 * on the new basis (the same physical quantity, before and after), or held as
 * unclear when no restatement exists. All ₪ in integer agorot.
 */
const db = createDb(testDbUrl());
let A: Tenant;

const owner = () =>
  appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } } as AppContext);

async function item(o: { sku: string; name: string; price: string; unit: string; pack?: string }) {
  await db.insert(supplierCatalogItems).values({
    restaurantId: A.restaurantId,
    supplierId: A.supplierId,
    supplierSku: o.sku,
    supplierNameRaw: o.name,
    listPrice: o.price,
    unit: o.unit,
    packSize: o.pack ?? null,
  });
}
async function billed(sku: string, qty: string, unit: string) {
  await db.insert(invoiceLines).values({
    invoiceId: A.invoiceId,
    supplierSku: sku,
    rawDescription: 'שורה',
    qtyBilled: qty,
    unit,
    unitPriceBilled: '1',
    lineTotal: qty,
  });
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('W3-10 "מה ישתנה" on the basis the import writes', () => {
  it('a kept price is ₪0, a basis change is priced on the new basis, a plain change as before', async () => {
    await item({ sku: 'K', name: 'קמח', price: '10.0000', unit: 'ק״ג' }); // blank price in the file → kept
    await billed('K', '50', 'ק״ג');
    await item({ sku: 'G', name: 'זעתר', price: '40.0000', unit: 'ק״ג' }); // → priced per גרם
    await billed('G', '10', 'ק״ג');
    await item({ sku: 'P', name: 'מיץ', price: '120.0000', unit: 'ארגז', pack: '12' }); // case of 12 → case of 6
    await billed('P', '5', 'ארגז');
    await item({ sku: 'X', name: 'שמן', price: '100.0000', unit: 'ארגז', pack: '12' }); // a case → kg: no restatement
    await billed('X', '7', 'ארגז');
    await item({ sku: 'T', name: 'עגבניה', price: '5.0000', unit: 'ק״ג' }); // plain rise
    await billed('T', '120', 'ק״ג');

    const text = [
      'sku,name,unit,pack,price',
      'K,קמח,ק״ג,,',
      'G,זעתר,גרם,,0.05',
      'P,מיץ,ארגז,6,66',
      'X,שמן,ק״ג,,9',
      'T,עגבניה,ק״ג,,5.50',
    ].join('\n');
    const res = await owner().catalog.parsePreview({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text },
      mapping: { sku: 'sku', name: 'name', unit: 'unit', packSize: 'pack', price: 'price' },
    });
    const by = new Map(res.diff.lines.map((l) => [l.supplierSku, l]));

    // Kept price: the commit keeps ₪10/kg — no ↑/↓, ₪0/month (not "unclear").
    expect(res.check.rows.find((r) => r.supplierSku === 'K')).toMatchObject({ keepsPrice: true });
    // The response lists only lines that change (#335 drops `same`): K is counted as
    // `same` below, and appears in no ↑/↓ or unclear line.
    expect(by.has('K')).toBe(false);

    // ₪40/kg → ₪0.05/g: on the new basis ₪0.04/g → +₪0.01/g × 10,000 g = +₪100.00.
    expect(by.get('G')).toMatchObject({ kind: 'up', basisChanged: true, deltaUnits: 100, monthlyImpactAgorot: 10_000 });

    // ₪120 per case of 12 → ₪66 per case of 6: on the new basis ₪60 → +₪6 × 10 cases = +₪60.00.
    expect(by.get('P')).toMatchObject({ kind: 'up', basisChanged: true, deltaUnits: 60_000, monthlyImpactAgorot: 6_000 });

    // A case of 12 → per kg: no restatement exists, so no ↑/↓ and no invented ₪.
    expect(by.get('X')).toMatchObject({
      kind: 'unclear',
      unclearReason: 'BASIS_NOT_COMPARABLE',
      basisChanged: true,
      monthlyImpactAgorot: 0,
    });

    // Plain change, same basis: +₪0.50 × 120 kg = +₪60.00.
    expect(by.get('T')).toMatchObject({ kind: 'up', deltaUnits: 5_000, monthlyImpactAgorot: 6_000 });
    expect(by.get('T')!.basisChanged).toBeUndefined();

    expect(res.diff).toMatchObject({ upAgorot: 22_000, downAgorot: 0, netAgorot: 22_000 });
    expect(res.diff.counts).toMatchObject({ up: 3, same: 1, unclear: 1, new: 0, missing: 0 });
  });
});
