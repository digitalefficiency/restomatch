import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, invoiceLines, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · catalog.parsePreview carries "מה ישתנה": per row ↑/↓ with ₪/month in
 * integer agorot (Δ price units × the last 30 days' billed qty IN THE SAME
 * UNIT), rows the file drops (to disable), unclear rows — and writes nothing.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function item(t: Tenant, o: { sku: string; name: string; price: string; unit: string; product?: boolean }) {
  await db.insert(supplierCatalogItems).values({
    restaurantId: t.restaurantId,
    supplierId: t.supplierId,
    productId: o.product ? t.productId : null,
    supplierSku: o.sku,
    supplierNameRaw: o.name,
    listPrice: o.price,
    unit: o.unit,
  });
}

async function billed(t: Tenant, o: { sku: string | null; qty: string; unit: string; product?: boolean }) {
  await db.insert(invoiceLines).values({
    invoiceId: t.invoiceId,
    productId: o.product ? t.productId : null,
    supplierSku: o.sku,
    rawDescription: 'שורה',
    qtyBilled: o.qty,
    unit: o.unit,
    unitPriceBilled: '1',
    lineTotal: o.qty,
  });
}

const csv = ['מק״ט,תיאור,יחידה,מחיר', 'T-1,עגבניה,ק״ג,5.50', 'C-2,מלפפון,ק״ג,3.75', 'N-9,שום,ק״ג,12', 'Q-1,כוסברה,צרור,abc'].join('\n');

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => resetDb(db));

describe('W3-10 catalog.parsePreview → diff ("מה ישתנה")', () => {
  it('₪/month from same-unit billed qty; another unit adds nothing; dropped rows are "missing"; nothing written', async () => {
    await item(A, { sku: 'T-1', name: 'עגבניה', price: '5.0000', unit: 'ק״ג', product: true });
    await item(A, { sku: 'C-2', name: 'מלפפון', price: '4.0000', unit: 'ק״ג' });
    await item(A, { sku: 'P-9', name: 'פטרוזיליה', price: '2.0000', unit: 'צרור' });
    await billed(A, { sku: null, qty: '120', unit: 'ק"ג', product: true }); // linked by product, same unit (other spelling)
    await billed(A, { sku: 'C-2', qty: '80', unit: 'ק״ג' }); // linked by SKU
    await billed(A, { sku: 'C-2', qty: '999', unit: 'ארגז' }); // another unit → ignored
    const before = await db.select({ id: supplierCatalogItems.id, p: supplierCatalogItems.listPrice }).from(supplierCatalogItems);

    const res = await callerFor(A).catalog.parsePreview({ supplierId: A.supplierId, file: { filename: 'p.csv', text: csv } });
    const by = new Map(res.diff.lines.map((l) => [l.supplierSku, l]));
    expect(by.get('T-1')).toMatchObject({ kind: 'up', deltaUnits: 5000, monthlyImpactAgorot: 6000 }); // +₪0.50 × 120
    expect(by.get('C-2')).toMatchObject({ kind: 'down', deltaUnits: -2500, monthlyImpactAgorot: -2000 }); // −₪0.25 × 80
    expect(by.get('N-9')).toMatchObject({ kind: 'new' });
    expect(by.get('Q-1')).toMatchObject({ kind: 'unclear', unclearReason: 'NO_PRICE' });
    expect(by.get('P-9')).toMatchObject({ kind: 'missing' });
    expect(res.diff).toMatchObject({ upAgorot: 6000, downAgorot: 2000, netAgorot: 4000 });
    expect(await db.select({ id: supplierCatalogItems.id, p: supplierCatalogItems.listPrice }).from(supplierCatalogItems)).toEqual(before);
  });

  it("never reads another restaurant's catalog or quantities", async () => {
    await item(B, { sku: 'T-1', name: 'עגבניה', price: '1.0000', unit: 'ק״ג', product: true });
    await billed(B, { sku: null, qty: '1000', unit: 'ק״ג', product: true });
    const res = await callerFor(A).catalog.parsePreview({ supplierId: A.supplierId, file: { filename: 'p.csv', text: csv } });
    expect(res.diff.lines.every((l) => l.kind === 'new' || l.kind === 'unclear')).toBe(true);
    expect(res.diff.netAgorot).toBe(0);
    await expect(
      callerFor(A).catalog.parsePreview({ supplierId: B.supplierId, file: { filename: 'p.csv', text: csv } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
