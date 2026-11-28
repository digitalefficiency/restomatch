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

describe('W3-10 "מה ישתנה" basis review fixes (orchestrator 28.11)', () => {
  const preview = (text: string) =>
    owner().catalog.parsePreview({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text },
      mapping: { sku: 'sku', name: 'name', unit: 'unit', packSize: 'pack', price: 'price' },
    });

  it('the kind follows the exact difference: a gap below the rounding is still ↓ / ↑ with its ₪', async () => {
    await item({ sku: 'A', name: 'זעתר', price: '40.3490', unit: 'ק״ג' });
    await billed('A', '1000', 'ק״ג');
    await item({ sku: 'B', name: 'כמון', price: '39.9900', unit: 'ק״ג' });
    await billed('B', '1000', 'ק״ג');
    const res = await preview(['sku,name,unit,pack,price', 'A,זעתר,גרם,,0.0403', 'B,כמון,גרם,,0.04'].join('\n'));
    const by = new Map(res.diff.lines.map((l) => [l.supplierSku, l]));
    // ₪40.3490/kg → ₪0.0403/g = ₪40.30/kg: −₪0.049/kg × 1,000 kg = −₪49.00.
    expect(by.get('A')).toMatchObject({ kind: 'down', basisChanged: true, monthlyImpactAgorot: -4_900 });
    // ₪39.99/kg → ₪0.04/g = ₪40/kg: +₪0.01/kg × 1,000 kg = +₪10.00.
    expect(by.get('B')).toMatchObject({ kind: 'up', basisChanged: true, monthlyImpactAgorot: 1_000 });
    expect(res.diff.counts).toMatchObject({ up: 1, down: 1, same: 0 });
    expect(res.diff).toMatchObject({ upAgorot: 1_000, downAgorot: 4_900 });
  });

  it('mg → kg is restated exactly (no zero divisor, no throw)', async () => {
    await item({ sku: 'S', name: 'זעפרן', price: '0.0001', unit: 'mg' }); // ₪0.0001/mg = ₪100/kg
    await billed('S', '500000', 'mg'); // 0.5 kg
    const res = await preview(['sku,name,unit,pack,price', 'S,זעפרן,kg,,120'].join('\n'));
    // On the new basis ₪100/kg → ₪120/kg: +₪20 × 0.5 kg = +₪10.00.
    expect(res.diff.lines.find((l) => l.supplierSku === 'S')).toMatchObject({
      kind: 'up',
      basisChanged: true,
      deltaUnits: 200_000,
      monthlyImpactAgorot: 1_000,
    });
  });

  it("a pack cell of '0' is a degenerate basis: unclear, ₪0, the preview still answers", async () => {
    await item({ sku: 'Z', name: 'מיץ', price: '120.0000', unit: 'ארגז', pack: '12' });
    await billed('Z', '5', 'ארגז');
    const res = await preview(['sku,name,unit,pack,price', 'Z,מיץ,ארגז,0,66'].join('\n'));
    expect(res.diff.lines.find((l) => l.supplierSku === 'Z')).toMatchObject({
      kind: 'unclear',
      unclearReason: 'BASIS_NOT_COMPARABLE',
      monthlyImpactAgorot: 0,
    });
  });
});
