import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  priceHistory,
  products,
  restaurants,
  supplierContractPrices,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-12 import "בדיקה" step: `contracts.importDiff` + `contracts.importCommit({ excludeRowIds })`. */

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let oilId: string;
let saltId: string;

const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

const mapping = { name: 'תיאור', price: 'מחיר חוזה' };
// Row ids are spreadsheet rows (header = 1): 2 עגבניה A (up) · 3 שמן (down) · 4 מלח (new) · 5 unknown · 6 bad price.
const csv = [
  'תיאור,מחיר חוזה',
  'עגבניה A,"9,90"',
  'שמן זית,"1,250"',
  'מלח,"12,5"',
  'פריט לא קיים,3',
  'מלח גס,שלוש',
].join('\n');

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db
      .update(restaurants)
      .set({ settings: { features: { all: true } } as RestaurantSettings })
      .where(eq(restaurants.id, t.restaurantId));
  }
  const ins = await db
    .insert(products)
    .values([
      { restaurantId: A.restaurantId, canonicalName: 'שמן זית', defaultUnit: 'יח׳' },
      { restaurantId: A.restaurantId, canonicalName: 'מלח', defaultUnit: 'ק״ג' },
      { restaurantId: A.restaurantId, canonicalName: 'מלח גס', defaultUnit: 'ק״ג' },
    ])
    .returning();
  oilId = ins[0]!.id;
  saltId = ins[1]!.id;
});

beforeEach(async () => {
  await db.delete(supplierContractPrices);
  await db.delete(priceHistory);
  await db.insert(supplierContractPrices).values([
    { restaurantId: A.restaurantId, supplierId: A.supplierId, productId: A.productId, contractPrice: '9.0000', validFrom: '2020-01-01' },
    { restaurantId: A.restaurantId, supplierId: A.supplierId, productId: oilId, contractPrice: '1300.0000', validFrom: '2020-01-01' },
  ]);
  // 90 days at A's supplier: 30 kg tomatoes → (9.90 − 9.00) × 30 ÷ 3 = ₪9.00/month.
  for (const d of [10, 20, 30]) {
    await db.insert(priceHistory).values({
      restaurantId: A.restaurantId,
      productId: A.productId,
      supplierId: A.supplierId,
      observedAt: new Date(Date.now() - d * 86_400_000),
      unitPrice: '9.00',
      qty: '10',
    });
  }
});

afterAll(async () => {
  await resetDb(db);
});

describe('contracts.importDiff (W2-12)', () => {
  it('diff rows and chips: up / down / new / unmatched / invalid, with parsed ₪ and ₪/month — writes nothing', async () => {
    const d = await caller(A, 'manager').contracts.importDiff({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: csv },
      mapping,
      defaultValidFrom: '2026-11-08',
    });
    expect(d.counts).toEqual({ up: 1, down: 1, new: 1, same: 0, unmatched: 1, invalid: 1 });
    expect(d.writable).toBe(3);
    const by = Object.fromEntries(d.rows.map((r) => [r.rowId, r]));
    expect(by[2]).toMatchObject({ chip: 'up', currentPrice: 9, newPrice: 9.9, deltaPct: 0.1, monthlyAgorot: 900, productId: A.productId });
    // "1,250" is ₪1,250 — never ₪1.25.
    expect(by[3]).toMatchObject({ chip: 'down', currentPrice: 1300, newPrice: 1250, deltaPct: -0.0385, monthlyAgorot: null });
    // "12,5" is ₪12.50.
    expect(by[4]).toMatchObject({ chip: 'new', newPrice: 12.5, currentPrice: null, productId: saltId });
    expect(by[5]).toMatchObject({ chip: 'unmatched', reason: 'NO_PRODUCT' });
    expect(by[6]).toMatchObject({ chip: 'invalid', reason: 'NO_PRICE', newPrice: null });
    expect(d.monthlyAgorot).toBe(900);
    const rows = await db.select().from(supplierContractPrices);
    expect(rows).toHaveLength(2);
  });
});

describe('contracts.importDiff units (W2-12 review)', () => {
  it('compares in the row unit: ₪9/kg contract vs ₪0.009/g row is "same", not a 99.9 % drop', async () => {
    const d = await caller(A, 'manager').contracts.importDiff({
      supplierId: A.supplierId,
      file: { filename: 'g.csv', text: 'תיאור,יחידה,מחיר חוזה\nעגבניה A,גרם,0.009\n' },
      mapping: { name: 'תיאור', unit: 'יחידה', price: 'מחיר חוזה' },
      defaultValidFrom: '2026-11-08',
    });
    expect(d.rows[0]).toMatchObject({ chip: 'same', currentPrice: 0.009, newPrice: 0.009, deltaPct: 0 });
  });
});

describe('contracts.importCommit excludeRowIds (W2-12)', () => {
  it('an excluded row is not written; "1,250" → 1250.0000; an unparseable cell is held out', async () => {
    const res = await caller(A, 'manager').contracts.importCommit({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: csv },
      mapping,
      defaultValidFrom: '2026-11-08',
      excludeRowIds: [4],
    });
    expect(res).toMatchObject({ created: 2, updated: 0, excluded: 1 });
    expect(res.skipped.map((s) => [s.row, s.reason])).toEqual([
      [5, 'NO_PRODUCT'],
      [6, 'NO_PRICE'],
    ]);
    const rows = await db
      .select({ productId: supplierContractPrices.productId, price: supplierContractPrices.contractPrice, from: supplierContractPrices.validFrom })
      .from(supplierContractPrices)
      .where(eq(supplierContractPrices.validFrom, '2026-11-08'));
    expect(rows.find((r) => r.productId === oilId)?.price).toBe('1250.0000');
    expect(rows.find((r) => r.productId === A.productId)?.price).toBe('9.9000');
    expect(rows.find((r) => r.productId === saltId)).toBeUndefined();
  });

  it('a commit without excludeRowIds behaves as before (excluded: 0)', async () => {
    const res = await caller(A, 'manager').contracts.importCommit({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: csv },
      mapping,
      defaultValidFrom: '2026-11-08',
    });
    expect(res).toMatchObject({ created: 3, excluded: 0 });
  });
});
