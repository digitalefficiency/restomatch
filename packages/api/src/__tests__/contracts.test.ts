import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  inArray,
  notificationsOutbox,
  poLines,
  priceAlerts,
  priceAlertThresholds,
  priceHistory,
  products,
  restaurants,
  supplierCatalogItems,
  supplierContractPrices,
  suppliers,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { runMatch } from '@restomatch/matching';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import {
  contractInForce,
  contractPriceInUnit,
  isOverContract,
  localDateKey,
  type ContractRow,
} from '../contracts/core';
import { autoDetectContractMapping, extractContractRows, parseDateCell } from '../contracts/import';
import { findOverContractLines } from '../contracts/overContract';
import { cheaperOffer, detectSustainedIncrease, resolveThreshold } from '../priceAlerts/detect';
import { runPriceAlertSweep } from '../priceAlerts/sweep';
import { enqueueNotification } from '../notifications/outbox';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/* ─────────────────────────── pure rules ─────────────────────────── */

const row = (o: Partial<ContractRow>): ContractRow => ({
  id: 'c',
  supplierId: 's',
  productId: 'p',
  unit: null,
  contractPrice: '10',
  validFrom: '2026-01-01',
  validTo: null,
  ...o,
});

describe('contract rules (contracts/core.ts)', () => {
  it('picks the covering row with the latest validFrom; respects inclusive bounds', () => {
    const rows = [
      row({ id: 'old', validFrom: '2026-01-01', validTo: null }),
      row({ id: 'new', validFrom: '2026-06-01', validTo: '2026-06-30' }),
    ];
    expect(contractInForce(rows, '2025-12-31')).toBeNull();
    expect(contractInForce(rows, '2026-01-01')!.id).toBe('old');
    expect(contractInForce(rows, '2026-06-01')!.id).toBe('new');
    expect(contractInForce(rows, '2026-06-30')!.id).toBe('new');
    expect(contractInForce(rows, '2026-07-01')!.id).toBe('old');
  });

  it('converts kg↔g like the engine and refuses unconvertible units', () => {
    expect(contractPriceInUnit(row({ unit: 'ק״ג', contractPrice: '40' }), 'kg')).toBe(40);
    expect(contractPriceInUnit(row({ unit: 'kg', contractPrice: '40' }), 'g')).toBe(0.04);
    // No unit anywhere (contract nor product) → never applied (loaders coalesce the product unit).
    expect(contractPriceInUnit(row({ unit: null, contractPrice: '7.5' }), 'יח׳')).toBeNull();
    expect(contractPriceInUnit(row({ unit: 'יח׳', contractPrice: '7.5' }), 'יח׳')).toBe(7.5);
    expect(contractPriceInUnit(row({ unit: 'kg', contractPrice: '40' }), 'ליטר')).toBeNull();
  });

  it('over-contract uses the engine price tolerance band (pct AND abs)', () => {
    const tol = { pricePercent: 0.02, priceAbsolute: 5 };
    expect(isOverContract(10, 10, tol)).toBe(false);
    expect(isOverContract(9, 10, tol)).toBe(false);
    expect(isOverContract(10.2, 10, tol)).toBe(false); // 2% exactly → clean
    expect(isOverContract(10.21, 10, tol)).toBe(true);
    expect(isOverContract(306, 300, tol)).toBe(true); // 2% but ₪6 > ₪5: outside the band, like the engine
  });

  it('localDateKey anchors to the restaurant timezone', () => {
    // 2026-03-31T22:30Z is already April 1st in Jerusalem (UTC+3 in summer time).
    expect(localDateKey(new Date('2026-03-31T22:30:00Z'), 'Asia/Jerusalem')).toBe('2026-04-01');
    expect(localDateKey(new Date('2026-03-31T22:30:00Z'), 'UTC')).toBe('2026-03-31');
  });
});

describe('contract import parsing', () => {
  it('auto-maps Hebrew and English headers including the date columns', () => {
    expect(autoDetectContractMapping(['מק"ט', 'תיאור פריט', 'יחידה', 'מחיר חוזה', 'בתוקף מ', 'בתוקף עד'])).toEqual({
      sku: 'מק"ט',
      name: 'תיאור פריט',
      unit: 'יחידה',
      price: 'מחיר חוזה',
      validFrom: 'בתוקף מ',
      validTo: 'בתוקף עד',
    });
    expect(autoDetectContractMapping(['SKU', 'Product', 'Unit', 'Price', 'Valid from', 'Valid to'])).toEqual({
      sku: 'SKU',
      name: 'Product',
      unit: 'Unit',
      price: 'Price',
      validFrom: 'Valid from',
      validTo: 'Valid to',
    });
  });

  it('parses ISO and Israeli D/M/YYYY dates; rejects impossible dates', () => {
    expect(parseDateCell('2026-10-01')).toBe('2026-10-01');
    expect(parseDateCell('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(parseDateCell('1/10/2026')).toBe('2026-10-01');
    expect(parseDateCell('01.10.26')).toBe('2026-10-01');
    expect(parseDateCell('31/02/2026')).toBeNull();
    expect(parseDateCell('soon')).toBeNull();
    expect(parseDateCell('')).toBeNull();
  });

  it('extracts rows (₪ / thousands separators) and drops rows with neither name nor SKU', () => {
    const rows = extractContractRows(
      { headers: ['name', 'price', 'from'], rows: [{ name: 'עגבניה', price: '₪1,234.50', from: '1/9/2026' }, { name: '', price: '3', from: '' }] },
      { name: 'name', price: 'price', validFrom: 'from' },
    );
    expect(rows).toEqual([
      { supplierSku: null, name: 'עגבניה', unit: null, price: 1234.5, validFrom: '2026-09-01', validTo: null },
    ]);
  });
});

describe('price-trend detection (priceAlerts/detect.ts)', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
  const th = { thresholdPct: 0.1, windowDays: 21 };

  it('detects tomatoes +18% over 3 weeks', () => {
    const r = detectSustainedIncrease(
      [
        { observedAt: at(20), unitPrice: '6.20' },
        { observedAt: at(13), unitPrice: '6.70' },
        { observedAt: at(6), unitPrice: '7.10' },
        { observedAt: at(1), unitPrice: '7.316' },
      ],
      th,
      now,
    );
    expect(r).toMatchObject({ startPrice: 6.2, endPrice: 7.316, pctChange: 0.18, observations: 4 });
  });

  it('ignores a one-off spike, too few observations, decreases and out-of-window points', () => {
    expect(
      detectSustainedIncrease(
        [
          { observedAt: at(20), unitPrice: '10' },
          { observedAt: at(10), unitPrice: '10' },
          { observedAt: at(5), unitPrice: '10.1' },
          { observedAt: at(1), unitPrice: '13' },
        ],
        th,
        now,
      ),
    ).toBeNull();
    expect(detectSustainedIncrease([{ observedAt: at(5), unitPrice: '1' }, { observedAt: at(1), unitPrice: '2' }], th, now)).toBeNull();
    expect(
      detectSustainedIncrease(
        [
          { observedAt: at(15), unitPrice: '12' },
          { observedAt: at(8), unitPrice: '11' },
          { observedAt: at(1), unitPrice: '10' },
        ],
        th,
        now,
      ),
    ).toBeNull();
    expect(
      detectSustainedIncrease(
        [
          { observedAt: at(40), unitPrice: '5' },
          { observedAt: at(10), unitPrice: '10' },
          { observedAt: at(5), unitPrice: '10' },
          { observedAt: at(1), unitPrice: '10.5' },
        ],
        th,
        now,
      ),
    ).toBeNull();
  });

  it('collapses same-day observations (one invoice, two lines) and ignores a stale trend (refuter R5)', () => {
    expect(
      detectSustainedIncrease(
        [
          { observedAt: at(20), unitPrice: '10' },
          { observedAt: at(1), unitPrice: '13' },
          { observedAt: new Date(at(1).getTime() + 60_000), unitPrice: '13' },
        ],
        th,
        now,
      ),
    ).toBeNull();
    expect(
      detectSustainedIncrease(
        [
          { observedAt: at(20), unitPrice: '10' },
          { observedAt: at(19), unitPrice: '13' },
          { observedAt: at(18), unitPrice: '13' },
        ],
        th,
        now,
      ),
    ).toBeNull();
  });

  it('resolves the most specific threshold rule', () => {
    const rules = [
      { supplierId: null, category: null, thresholdPct: 0.2, windowDays: 30, enabled: true },
      { supplierId: null, category: 'ירקות', thresholdPct: 0.15, windowDays: 21, enabled: true },
      { supplierId: 's1', category: null, thresholdPct: 0.05, windowDays: 14, enabled: true },
      { supplierId: 's1', category: 'ירקות', thresholdPct: 0.03, windowDays: 7, enabled: false },
    ];
    expect(resolveThreshold(rules, 's1', 'ירקות')).toEqual({ thresholdPct: 0.03, windowDays: 7, enabled: false });
    expect(resolveThreshold(rules, 's1', 'בשר')).toEqual({ thresholdPct: 0.05, windowDays: 14, enabled: true });
    expect(resolveThreshold(rules, 's2', 'ירקות')).toEqual({ thresholdPct: 0.15, windowDays: 21, enabled: true });
    expect(resolveThreshold(rules, 's2', null)).toEqual({ thresholdPct: 0.2, windowDays: 30, enabled: true });
    expect(resolveThreshold([], 's2', null)).toEqual({ thresholdPct: 0.1, windowDays: 21, enabled: true });
  });

  it('cheaperOffer picks the lowest strictly-cheaper offer', () => {
    expect(cheaperOffer(7.3, [{ supplierId: 'a', price: 7.3 }, { supplierId: 'b', price: 6.4 }, { supplierId: 'c', price: 6.9 }])).toEqual({ supplierId: 'b', price: 6.4 });
    expect(cheaperOffer(7.3, [{ supplierId: 'a', price: 8 }])).toBeNull();
  });
});

/* ─────────────────────────── DB behaviour ─────────────────────────── */

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function setFeatures(t: Tenant, features: Record<string, boolean> | null) {
  await db
    .update(restaurants)
    .set({ settings: (features ? { features } : {}) as RestaurantSettings })
    .where(eq(restaurants.id, t.restaurantId));
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  // The fixture PO line has no product; link it so the PO price check runs.
  for (const t of [A, B]) {
    await db.update(poLines).set({ productId: t.productId }).where(eq(poLines.id, t.poLineId));
  }
});

beforeEach(async () => {
  await db.delete(supplierContractPrices);
  await db.delete(priceAlerts);
  await db.delete(priceAlertThresholds);
  await db.delete(priceHistory);
  await db.delete(notificationsOutbox);
  await setFeatures(A, { all: true });
  await setFeatures(B, { all: true });
});

afterAll(async () => {
  await resetDb(db);
});

async function addContract(t: Tenant, price: string, validFrom = '2020-01-01', validTo: string | null = null, unit: string | null = null) {
  await db.insert(supplierContractPrices).values({
    restaurantId: t.restaurantId,
    supplierId: t.supplierId,
    productId: t.productId,
    contractPrice: price,
    validFrom,
    validTo,
    unit,
  });
}

const priceHigher = (out: ReturnType<typeof runMatch>) => out.discrepancies.filter((d) => d.type === 'PRICE_HIGHER');

describe('buildMatchInput feeds the contract price to the engine (contract beats PO)', () => {
  it('without a contract the PO price (8.50) is the expected price', async () => {
    const built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
    expect(built!.input.poLines[0]!.unitPriceExpected).toBe(8.5);
    expect(priceHigher(runMatch(built!.input))[0]).toMatchObject({ expected: 8.5, actual: 10, deltaAmount: 15 });
  });

  it('a contract below the PO price replaces it: PRICE_HIGHER expected = contract', async () => {
    await addContract(A, '8.0000', '2020-01-01', null, 'kg');
    const built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
    expect(built!.input.poLines[0]!.unitPriceExpected).toBe(8);
    expect(priceHigher(runMatch(built!.input))[0]).toMatchObject({ expected: 8, actual: 10, deltaAmount: 20 });
  });

  it('a contract ABOVE the PO price is a ceiling only: the PO stands, no false PRICE_LOWER leak (refuter R2)', async () => {
    const before = runMatch((await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))!.input);
    await addContract(A, '12.0000', '2020-01-01', null, 'kg');
    const built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
    expect(built!.input.poLines[0]!.unitPriceExpected).toBe(8.5);
    const out = runMatch(built!.input);
    expect(out.discrepancies.some((d) => d.type === 'PRICE_LOWER')).toBe(false);
    expect(out.totalDiscrepancyAmount).toBe(before.totalDiscrepancyAmount);
  });

  it('a unit-less contract is quoted in the product default unit and converted (₪9/ק״ג on a per-g line → ₪0.009) (refuter R1)', async () => {
    await addContract(A, '8.0000'); // no unit → product default ק״ג
    await db.update(poLines).set({ unit: 'g', unitPriceExpected: '0.0085' }).where(eq(poLines.id, A.poLineId));
    try {
      const built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
      expect(built!.input.poLines[0]!.unitPriceExpected).toBe(0.008);
    } finally {
      await db.update(poLines).set({ unit: 'kg', unitPriceExpected: '8.5' }).where(eq(poLines.id, A.poLineId));
    }
  });

  it('a contract outside its validity window, for another tenant, or with the flag off is ignored', async () => {
    await addContract(A, '8.0000', '2000-01-01', '2000-12-31');
    await addContract(B, '1.0000');
    let built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
    expect(built!.input.poLines[0]!.unitPriceExpected).toBe(8.5);

    await db.delete(supplierContractPrices);
    await addContract(A, '8.0000');
    await setFeatures(A, { all: true, contracts: false });
    built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
    expect(built!.input.poLines[0]!.unitPriceExpected).toBe(8.5);
  });

  it('a contract in another unit is converted (₪0.008/g → ₪8/kg)', async () => {
    await db.insert(supplierContractPrices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: '0.0080',
      unit: 'g',
      validFrom: '2020-01-01',
    });
    const built = await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId);
    expect(built!.input.poLines[0]!.unitPriceExpected).toBe(8);
  });
});

describe('over-contract lines (badge source)', () => {
  it('flags the billed line above the contract and reports the overage in agorot', async () => {
    await addContract(A, '9.0000');
    const lines = await findOverContractLines(db, A.restaurantId, { invoiceIds: [A.invoiceId] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ invoiceLineId: A.invoiceLineId, contractUnitPrice: 9, billedUnitPrice: 10, overAgorot: 1000 });
  });

  it('is empty within tolerance, without a contract, and for another tenant’s invoice', async () => {
    await addContract(A, '9.9000'); // 10 vs 9.90 → 1%, ₪0.10: inside the default band
    expect(await findOverContractLines(db, A.restaurantId, { invoiceIds: [A.invoiceId] })).toEqual([]);
    expect(await findOverContractLines(db, A.restaurantId, { invoiceIds: [B.invoiceId] })).toEqual([]);
  });
});

describe('contracts router', () => {
  it('create → list → update → delete round-trip (manager tier)', async () => {
    const c = caller(A, 'manager');
    const { id } = await c.contracts.create({
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: 9,
      validFrom: '2026-01-01',
    });
    let list = await c.contracts.list({ supplierId: A.supplierId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, contractPrice: '9.0000', validFrom: '2026-01-01', source: 'manual' });
    await expect(
      c.contracts.create({ supplierId: A.supplierId, productId: A.productId, contractPrice: 8, validFrom: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await c.contracts.update({ id, contractPrice: 9.5, validTo: '2026-12-31' });
    list = await c.contracts.list();
    expect(list[0]).toMatchObject({ contractPrice: '9.5000', validTo: '2026-12-31' });
    await expect(c.contracts.update({ id, validTo: '2025-01-01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await c.contracts.delete({ id });
    expect(await c.contracts.list()).toEqual([]);
  });

  it('imports a CSV: resolves by catalog SKU and by name, upserts, reports unknown products', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: 'TOM-1',
      supplierNameRaw: 'עגבניות שרי ארגז',
      productId: A.productId,
      listPrice: '9.0000',
    });
    const c = caller(A, 'manager');
    const text = 'מק"ט,תיאור,מחיר חוזה,בתוקף מ\nTOM-1,עגבניות,9.10,1/9/2026\n,עגבניה A,9.20,1/10/2026\n,פריט לא קיים,3,\n';
    const preview = await c.contracts.importPreview({ supplierId: A.supplierId, file: { filename: 'c.csv', text } });
    expect(preview.rowCount).toBe(3);
    expect(preview.mapping).toMatchObject({ sku: 'מק"ט', name: 'תיאור', price: 'מחיר חוזה', validFrom: 'בתוקף מ' });
    const res = await c.contracts.importCommit({
      supplierId: A.supplierId,
      file: { filename: 'c.csv', text },
      mapping: preview.mapping,
      defaultValidFrom: '2026-01-01',
    });
    expect(res).toMatchObject({ created: 2, updated: 0 });
    expect(res.skipped).toEqual([{ row: 4, label: 'פריט לא קיים', reason: 'NO_PRODUCT' }]);
    const again = await c.contracts.importCommit({
      supplierId: A.supplierId,
      file: { filename: 'c.csv', text },
      mapping: preview.mapping,
      defaultValidFrom: '2026-01-01',
    });
    expect(again).toMatchObject({ created: 0, updated: 2 });
    await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, A.restaurantId));
  });

  it('import reports — never guesses — bad cells: long/formula unit, impossible date, 1e3, (5) (refuter R6/R7)', async () => {
    const c = caller(A, 'manager');
    const long = 'x'.repeat(40);
    const text =
      'name,unit,price,from\n' +
      `עגבניה A,${long},9,1/9/2026\n` +
      'עגבניה A,"=HYPERLINK(""http://e"")",9,1/9/2026\n' +
      'עגבניה A,kg,9,31/02/2026\n' +
      'עגבניה A,kg,1e3,1/9/2026\n' +
      'עגבניה A,kg,(5),1/9/2026\n' +
      'עגבניה A,kg,"1,234.50",2/9/2026\n';
    const res = await c.contracts.importCommit({
      supplierId: A.supplierId,
      file: { filename: 'c.csv', text },
      mapping: { name: 'name', unit: 'unit', price: 'price', validFrom: 'from' },
      defaultValidFrom: '2026-01-01',
    });
    expect(res.skipped.map((x) => x.reason)).toEqual(['BAD_UNIT', 'BAD_UNIT', 'NO_DATE', 'NO_PRICE', 'NO_PRICE']);
    expect(res).toMatchObject({ created: 1, updated: 0 });
    const rows = await db.select().from(supplierContractPrices).where(eq(supplierContractPrices.restaurantId, A.restaurantId));
    expect(rows.map((r) => [r.contractPrice, r.validFrom])).toEqual([['1234.5000', '2026-09-02']]);
  });

  it('is FORBIDDEN with appCode FEATURE_DISABLED when the flag is off (and via the kill-switch)', async () => {
    await setFeatures(A, null);
    await expect(caller(A).contracts.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: expect.objectContaining({ appCode: 'FEATURE_DISABLED' }),
    });
    await expect(caller(A).priceAlerts.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setFeatures(A, { all: true });
    const prev = process.env.FEATURES_OFF;
    process.env.FEATURES_OFF = 'contracts';
    try {
      await expect(caller(A).contracts.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(A).priceAlerts.list()).resolves.toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.FEATURES_OFF;
      else process.env.FEATURES_OFF = prev;
    }
  });

  it('role gates: receiver/chef cannot read contracts; bookkeeper reads but cannot write', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(caller(A, role).contracts.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(A, role).priceAlerts.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller(A, 'bookkeeper').contracts.list()).resolves.toEqual([]);
    await expect(
      caller(A, 'bookkeeper').contracts.create({ supplierId: A.supplierId, productId: A.productId, contractPrice: 1, validFrom: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('price-alert sweep (in-app rows + outbox email)', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const at = (d: number) => new Date(now.getTime() - d * 86_400_000);

  async function seedTrend(t: Tenant, prices: number[]) {
    const days = [20, 13, 6, 1];
    for (let i = 0; i < prices.length; i++) {
      await db.insert(priceHistory).values({
        restaurantId: t.restaurantId,
        productId: t.productId,
        supplierId: t.supplierId,
        observedAt: at(days[i]!),
        unitPrice: prices[i]!.toFixed(4),
      });
    }
  }

  it('creates one alert with a cheaper-supplier suggestion, emails owners once, dedupes reruns', async () => {
    await seedTrend(A, [6.2, 6.7, 7.1, 7.316]);
    const [other] = await db
      .insert(suppliers)
      .values({ restaurantId: A.restaurantId, name: 'ספק זול' })
      .returning();
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: other!.id,
      supplierNameRaw: 'עגבניות',
      productId: A.productId,
      listPrice: '6.4000',
    });

    const r1 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true, appBaseUrl: 'http://x' });
    expect(r1).toEqual({ skipped: false, created: 1, enqueued: 1 });
    const [alert] = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    expect(alert).toMatchObject({ pctChange: '0.1800', startPrice: '6.2000', endPrice: '7.3160', cheaperSupplierId: other!.id, cheaperPrice: '6.4000', status: 'open' });
    const mail = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, A.restaurantId));
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ channel: 'email', status: 'queued', target: 'owner-A@attack.test', relatedEntityType: 'price_alert' });
    expect(mail[0]!.subject).toContain('+18%');

    const r2 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true });
    expect(r2).toEqual({ skipped: false, created: 0, enqueued: 0 });

    // Router: list (names), openCount, dismiss.
    const c = caller(A, 'manager');
    const list = await c.priceAlerts.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ productName: 'עגבניה A', cheaperSupplierName: 'ספק זול' });
    expect(await c.priceAlerts.openCount()).toEqual({ count: 1 });
    await c.priceAlerts.dismiss({ id: list[0]!.id });
    expect(await c.priceAlerts.list()).toEqual([]);
    expect(await c.priceAlerts.list({ status: 'dismissed' })).toHaveLength(1);

    await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, A.restaurantId));
    await db.delete(suppliers).where(eq(suppliers.id, other!.id));
  });

  it('a dismissed (or still-open) alert is not re-raised by later observations (refuter R4)', async () => {
    await seedTrend(A, [6.2, 6.7, 7.1, 7.316]);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).created).toBe(1);
    // still open: a new observation tomorrow doesn't duplicate it
    const later = new Date(now.getTime() + 86_400_000);
    await db.insert(priceHistory).values({ restaurantId: A.restaurantId, productId: A.productId, supplierId: A.supplierId, observedAt: later, unitPrice: '7.3160' });
    expect(await runPriceAlertSweep(db, A.restaurantId, { now: later, notify: true })).toMatchObject({ created: 0, enqueued: 0 });
    // dismissed: stays quiet within its window
    const [al] = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    await caller(A, 'manager').priceAlerts.dismiss({ id: al!.id });
    const later2 = new Date(now.getTime() + 2 * 86_400_000);
    await db.insert(priceHistory).values({ restaurantId: A.restaurantId, productId: A.productId, supplierId: A.supplierId, observedAt: later2, unitPrice: '7.3160' });
    expect(await runPriceAlertSweep(db, A.restaurantId, { now: later2, notify: true })).toMatchObject({ created: 0, enqueued: 0 });
    expect(await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, A.restaurantId))).toHaveLength(1);
  });

  it('a cheaper offer quoted per gram or per pack is converted or ignored, never compared raw (refuter R3)', async () => {
    await seedTrend(A, [6.2, 6.7, 7.1, 7.316]);
    const [g] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק גרם' }).returning();
    const [pk] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק ארגז' }).returning();
    await db.insert(supplierCatalogItems).values([
      // ₪0.0090/g = ₪9/kg → NOT cheaper than ₪7.316/kg
      { restaurantId: A.restaurantId, supplierId: g!.id, supplierNameRaw: 'g', productId: A.productId, unit: 'g', listPrice: '0.0090' },
      // ₪5 per pack of 10 → not comparable → ignored
      { restaurantId: A.restaurantId, supplierId: pk!.id, supplierNameRaw: 'pk', productId: A.productId, unit: 'ק״ג', packSize: '10', listPrice: '5.0000' },
    ]);
    await runPriceAlertSweep(db, A.restaurantId, { now });
    const [al] = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    expect(al).toMatchObject({ cheaperSupplierId: null, cheaperPrice: null });
    await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, A.restaurantId));
    await db.delete(suppliers).where(inArray(suppliers.id, [g!.id, pk!.id]));
  });

  it('respects a per-supplier threshold and the feature flag', async () => {
    await seedTrend(A, [6.2, 6.7, 7.1, 7.316]); // +18%
    await caller(A, 'manager').priceAlerts.setThreshold({
      supplierId: A.supplierId,
      category: null,
      thresholdPct: 0.25,
      windowDays: 21,
      enabled: true,
    });
    expect((await runPriceAlertSweep(db, A.restaurantId, { now })).created).toBe(0);
    // Same scope again replaces (not duplicates) the rule.
    await caller(A, 'manager').priceAlerts.setThreshold({
      supplierId: A.supplierId,
      category: null,
      thresholdPct: 0.15,
      windowDays: 21,
      enabled: true,
    });
    const th = await caller(A).priceAlerts.thresholds();
    expect(th.rules).toHaveLength(1);
    expect(th.rules[0]).toMatchObject({ thresholdPct: 0.15, supplierName: 'ספק A' });
    expect(th.categories).toEqual(['ירקות']);

    await setFeatures(A, { all: true, priceAlerts: false });
    expect(await runPriceAlertSweep(db, A.restaurantId, { now })).toEqual({ skipped: true, created: 0, enqueued: 0 });
    await setFeatures(A, { all: true });
    expect((await runPriceAlertSweep(db, A.restaurantId, { now })).created).toBe(1);
  });

  it('the manual refresh is tenant-scoped (B’s history never creates A’s alerts)', async () => {
    await seedTrend(B, [6.2, 6.7, 7.1, 7.316]);
    const res = await caller(A, 'manager').priceAlerts.refresh();
    expect(res.created).toBe(0);
    expect(await db.select().from(priceAlerts)).toEqual([]);
  });
});

describe('outbox dedupe against real Postgres (partial unique index)', () => {
  it('a repeated dedupeKey is swallowed (deduped=true), not a 42P10 error', async () => {
    const payload = {
      restaurantId: A.restaurantId,
      channel: 'email' as const,
      target: 'x@test.local',
      body: 'b',
      dedupeKey: `test:${A.restaurantId}`,
    };
    const first = await enqueueNotification(db, payload);
    const second = await enqueueNotification(db, payload);
    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
  });
});

describe('same-tenant FKs (0046/0047)', () => {
  it('rejects a contract row pointing at another tenant’s supplier or product', async () => {
    await expect(
      db.insert(supplierContractPrices).values({
        restaurantId: A.restaurantId,
        supplierId: B.supplierId,
        productId: A.productId,
        contractPrice: '1',
        validFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.insert(supplierContractPrices).values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        productId: B.productId,
        contractPrice: '1',
        validFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('products keep working (UNIQUE(id, restaurant_id) is additive)', async () => {
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, A.productId));
    expect(p!.id).toBe(A.productId);
  });
});
