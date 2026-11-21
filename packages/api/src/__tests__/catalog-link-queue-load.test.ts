import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { createDb, eq, invoiceLines, invoices, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10b · the one "לקשר" queue against a real DB: invoice ₪ in integer agorot
 * (summed in SQL NUMERIC), SKU and no-SKU groups, price-list review rows at ₪0,
 * charge lines excluded, ranked by unmapped ₪; and commit.ts matching a no-SKU
 * price-list row by G-08's normalizeLinkName, as the preview does.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function line(t: Tenant, o: { sku?: string | null; name: string; total: string }) {
  const [r] = await db
    .insert(invoiceLines)
    .values({
      invoiceId: t.invoiceId,
      productId: null,
      supplierSku: o.sku ?? null,
      rawDescription: o.name,
      qtyBilled: '1',
      unit: 'kg',
      unitPriceBilled: o.total,
      lineTotal: o.total,
    })
    .returning({ id: invoiceLines.id });
  return r!.id;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('W3-10b mapping.queue', () => {
  it('ranks by unmapped ₪ in integer agorot, groups SKU and no-SKU lines, adds review rows at ₪0', async () => {
    await line(A, { sku: 'Q-1', name: 'עגבניה', total: '100.10' });
    await line(A, { sku: 'Q-1', name: 'עגבניה שרי', total: '0.20' });
    await line(A, { name: 'בצל  יבש', total: '250.05' });
    await line(A, { name: 'בצל יבש', total: '-0.01' }); // a credit line still counts |₪|
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: 'Q-1',
      supplierNameRaw: 'עגבניה',
    });
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: null,
      supplierNameRaw: 'פטרוזיליה',
    });

    const { rows, summary } = await callerFor(A).mapping.queue({ suggestFor: 0 });
    const ours = rows.filter((r) => ['Q-1', null].includes(r.supplierSku) && r.supplierId === A.supplierId);
    const onion = ours.find((r) => r.supplierSku === null && r.nameRaw.includes('בצל'));
    const tomato = ours.find((r) => r.supplierSku === 'Q-1');
    const parsley = ours.find((r) => r.nameRaw === 'פטרוזיליה');
    expect(onion).toMatchObject({ unmappedAgorot: 25006, lineCount: 2, sources: ['no_sku_line'] });
    expect(tomato).toMatchObject({ unmappedAgorot: 10030, lineCount: 3, sources: ['sku_line', 'import_suggestion'] });
    expect(parsley).toMatchObject({ unmappedAgorot: 0, sources: ['import_suggestion'] });
    expect(rows.indexOf(onion!)).toBeLessThan(rows.indexOf(tomato!));
    expect(rows.indexOf(tomato!)).toBeLessThan(rows.indexOf(parsley!));
    expect(onion!.supplierName).toBe(A.supplierName);
    expect(summary.count).toBe(rows.length);
    expect(summary.unmappedAgorot).toBe(rows.reduce((s, r) => s + r.unmappedAgorot, 0));
    expect(await callerFor(A).mapping.queueSummary()).toEqual(summary);
  });

  it('a charge line of its invoice is not a link question and carries no ₪', async () => {
    const id = await line(A, { sku: 'DLV', name: 'דמי משלוח', total: '35.00' });
    await db.update(invoices).set({ ocrPayload: { chargeLineIds: [id] } as never }).where(eq(invoices.id, A.invoiceId));
    const { rows } = await callerFor(A).mapping.queue();
    expect(rows.some((r) => r.supplierSku === 'DLV')).toBe(false);
  });

  it('limit pages the rows; the summary still covers the whole queue', async () => {
    for (let i = 0; i < 3; i += 1) await line(A, { sku: `P-${i}`, name: `פריט ${i}`, total: `${10 + i}.00` });
    const full = await callerFor(A).mapping.queue({ suggestFor: 0 });
    const one = await callerFor(A).mapping.queue({ limit: 1, suggestFor: 0 });
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0]!.key).toBe(full.rows[0]!.key);
    expect(one.summary).toEqual(full.summary);
  });
});

describe('W3-10b commit.ts no-SKU match = normalizeLinkName (the preview key)', () => {
  it('a re-import whose name differs only in spacing/case updates the same row', async () => {
    const row = { supplierSku: null, unit: 'kg', listPrice: 5, barcodeEan: null, packSize: null };
    const args = { restaurantId: A.restaurantId, supplierId: A.supplierId };
    const emb = new MockEmbeddingProvider();
    await commitCatalogRows(db, args, [{ ...row, supplierNameRaw: 'Olive  Oil ' }], emb);
    await commitCatalogRows(db, args, [{ ...row, supplierNameRaw: 'olive oil', listPrice: 6 }], emb);
    const items = await db
      .select({ name: supplierCatalogItems.supplierNameRaw, price: supplierCatalogItems.listPrice })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.restaurantId, A.restaurantId));
    expect(items.filter((i) => i.name.toLowerCase().includes('olive'))).toHaveLength(1);
  });
});
