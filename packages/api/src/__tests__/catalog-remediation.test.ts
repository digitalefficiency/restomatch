import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  catalogImports,
  createDb,
  poLines,
  priceAlerts,
  productAliases,
  products,
  purchaseOrders,
  sql,
  supplierCatalogItems,
  testDbUrl,
} from '@restomatch/db';
import { aliasRemediationReport } from '../catalog/remediation';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-08 · fix #4: a READ-ONLY report of links guessed before the policy
 * (pre-W1-10 style: an import linked a raw name to an OLDER product it barely
 * resembles, and learned a 1.000 alias). Decision 24: it lists; a person unlinks.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const TABLES = ['supplier_catalog_items', 'product_aliases', 'purchase_orders', 'po_lines', 'price_alerts', 'products', 'catalog_imports'];

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const [r] = (await db.execute(sql.raw(`select count(*)::int as n from ${t}`))) as unknown as Array<{ n: number }>;
    out[t] = r!.n;
  }
  return out;
}

/** A pre-W1-10 guessed link: product exists, THEN an import links an unlike raw name to it. */
async function seedGuessedLink(t: Tenant, tag: string) {
  const [pepper] = await db
    .insert(products)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      canonicalName: 'פלפל אדום',
      defaultUnit: 'ק״ג',
      createdAt: new Date('2026-09-01T08:00:00Z'),
    })
    .returning({ id: products.id });
  const [imp] = await db
    .insert(catalogImports)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      filename: `prices-${tag}.csv`,
      rowCount: 2,
      createdAt: new Date('2026-09-15T08:00:00Z'),
    })
    .returning({ id: catalogImports.id });
  const [item] = await db
    .insert(supplierCatalogItems)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      productId: pepper!.id,
      supplierNameRaw: 'פלפל חריף שושקה',
      unit: 'ק״ג',
      listPrice: '24.5000',
      sourceImportId: imp!.id,
    })
    .returning({ id: supplierCatalogItems.id });
  // An import row whose OWN product was made by the import is not a guess.
  const [own] = await db
    .insert(products)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, canonicalName: 'כוסברה', createdAt: new Date('2026-09-15T08:00:01Z') })
    .returning({ id: products.id });
  await db.insert(supplierCatalogItems).values({
    restaurantId: t.restaurantId,
    supplierId: t.supplierId,
    productId: own!.id,
    supplierNameRaw: 'כוסברה',
    sourceImportId: imp!.id,
  });
  const [alias] = await db
    .insert(productAliases)
    .values({ productId: pepper!.id, supplierId: t.supplierId, supplierNameRaw: 'פלפל חריף שושקה', confidence: '1.000' })
    .returning({ id: productAliases.id });
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'draft' })
    .returning({ id: purchaseOrders.id });
  const [line] = await db
    .insert(poLines)
    .values({ poId: po!.id, productId: pepper!.id, qtyOrdered: '3.000', unit: 'ק״ג', unitPriceExpected: '24.5050' })
    .returning({ id: poLines.id });
  const [alert] = await db
    .insert(priceAlerts)
    .values({
      restaurantId: t.restaurantId,
      productId: pepper!.id,
      supplierId: t.supplierId,
      windowDays: 30,
      thresholdPct: '0.1000',
      startPrice: '20.0000',
      endPrice: '24.5000',
      pctChange: '0.2250',
      startAt: new Date('2026-09-01T00:00:00Z'),
      endAt: new Date('2026-10-01T00:00:00Z'),
      observations: 3,
      dedupeKey: `g08-${tag}`,
    })
    .returning({ id: priceAlerts.id });
  return { pepperId: pepper!.id, itemId: item!.id, aliasId: alias!.id, poLineId: line!.id, alertId: alert!.id };
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => resetDb(db));

describe('G-08 aliasRemediationReport (read only)', () => {
  it('lists the guessed item, its alias, the draft PO line and the open price alert', async () => {
    const a = await seedGuessedLink(A, 'a');
    const r = await aliasRemediationReport(db, A.restaurantId);
    expect(r.items.map((i) => i.itemId)).toEqual([a.itemId]);
    expect(r.items[0]!.similarity).toBeLessThan(0.9);
    expect(r.aliases).toEqual([
      expect.objectContaining({ aliasId: a.aliasId, itemId: a.itemId, confidence: '1.000', provenance: 'human' }),
    ]);
    // 3 × 24.5050 = 73.515 ₪ → 7,352 agorot (half-up, exact NUMERIC math).
    expect(r.poLines).toEqual([
      expect.objectContaining({ poLineId: a.poLineId, poStatus: 'draft', lineTotalAgorot: 7352 }),
    ]);
    expect(r.poExposureAgorot).toBe(7352);
    expect(r.priceAlerts.map((p) => p.alertId)).toEqual([a.alertId]);
  });

  it('writes nothing: every table count is identical before and after', async () => {
    await seedGuessedLink(A, 'a');
    await seedGuessedLink(B, 'b');
    const before = await counts();
    await aliasRemediationReport(db, A.restaurantId);
    await aliasRemediationReport(db, B.restaurantId);
    expect(await counts()).toEqual(before);
  });

  it('runs inside a READ ONLY transaction (the CLI path)', async () => {
    await seedGuessedLink(A, 'a');
    const r = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return aliasRemediationReport(tx as unknown as typeof db, A.restaurantId);
    });
    expect(r.items).toHaveLength(1);
  });

  it("never lists a foreign tenant's rows", async () => {
    const b = await seedGuessedLink(B, 'b');
    const r = await aliasRemediationReport(db, A.restaurantId);
    expect(r.items).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(b.itemId);
    const rb = await aliasRemediationReport(db, B.restaurantId);
    expect(rb.items.map((i) => i.itemId)).toEqual([b.itemId]);
    expect(JSON.stringify(rb)).not.toContain(A.restaurantId);
  });

  it('a clean tenant reports zero', async () => {
    expect(await aliasRemediationReport(db, A.restaurantId)).toMatchObject({
      items: [],
      aliases: [],
      poLines: [],
      priceAlerts: [],
      poExposureAgorot: 0,
    });
  });
});
