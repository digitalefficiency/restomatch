import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  poLines,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
  supplierContractPrices,
  type RestaurantSettings,
} from '@restomatch/db';
import { StubOrderTextParser } from '@restomatch/ocr';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { captureOrderDraft } from '../orders/captureOrder';
import { orderPriceKey, resolveExpectedPrice } from '../orders/expectedPrice';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-06 §5.8 — ONE expected price: contract > the restaurant's own last
 * explicitly priced PO line > list. Never the invoice.
 */
const db = createDb(testDbUrl());
let A: Tenant;
const KG = 'kg';
const T0 = new Date('2026-09-01T08:00:00Z');
const T1 = new Date('2026-10-01T08:00:00Z');
const NOW = new Date('2026-10-25T08:00:00Z');

function callerFor(t: Tenant, role: Session['role'] = 'manager') {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function setFeatures(features: Record<string, boolean>) {
  await db
    .update(restaurants)
    .set({ settings: { features } as RestaurantSettings })
    .where(eq(restaurants.id, A.restaurantId));
}

async function listPrice(price: string, updatedAt: Date, unit: string | null = KG) {
  await db.insert(supplierCatalogItems).values({
    restaurantId: A.restaurantId,
    supplierId: A.supplierId,
    productId: A.productId,
    supplierNameRaw: `tomato-${price}`,
    unit,
    listPrice: price,
    updatedAt,
  });
}

async function pastPo(
  price: string,
  sentAt: Date,
  over: Partial<typeof purchaseOrders.$inferInsert> = {},
): Promise<string> {
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      status: 'sent',
      source: 'manual',
      sentAt,
      createdAt: sentAt,
      ...over,
    })
    .returning({ id: purchaseOrders.id });
  await db
    .insert(poLines)
    .values({ poId: po!.id, productId: A.productId, qtyOrdered: '4', unit: KG, unitPriceExpected: price });
  return po!.id;
}

const resolve = (at: Date = NOW) =>
  resolveExpectedPrice(db, {
    restaurantId: A.restaurantId,
    supplierId: A.supplierId,
    at,
    lines: [{ productId: A.productId, unit: KG }],
  }).then((m) => m.get(orderPriceKey(A.productId, KG)) ?? null);

describe('resolveExpectedPrice — the precedence table', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await setFeatures({ all: true });
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('nothing known → no entry (never a guessed price)', async () => {
    expect(await resolve()).toBeNull();
  });

  it('list only → list, as of its update', async () => {
    await listPrice('12.0000', T0);
    expect(await resolve()).toEqual({ unitPrice: 12, source: 'list', asOf: T0.toISOString() });
  });

  it('a sent manual PO newer than the list → last_po', async () => {
    await listPrice('12.0000', T0);
    await pastPo('10.5000', T1);
    expect(await resolve()).toEqual({ unitPrice: 10.5, source: 'last_po', asOf: T1.toISOString() });
  });

  it('a newer list price beats an older PO price (no stale "order again")', async () => {
    await pastPo('10.5000', T0);
    await listPrice('12.0000', T1);
    expect(await resolve()).toEqual({ unitPrice: 12, source: 'list', asOf: T1.toISOString() });
  });

  it('the latest of several sent POs wins; POs after `at` are not seen', async () => {
    await pastPo('9.0000', T0);
    await pastPo('10.0000', T1);
    expect((await resolve())?.unitPrice).toBe(10);
    expect((await resolve(new Date('2026-09-15T00:00:00Z')))?.unitPrice).toBe(9);
  });

  it('contract in force beats a newer PO and the list, converted to the line unit', async () => {
    await listPrice('12.0000', T0);
    await pastPo('10.5000', T1);
    // A per-gram contract, read for a kg line: 0.0095 ₪/g = 9.5 ₪/kg.
    await db.insert(supplierContractPrices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: '0.0095',
      validFrom: '2020-01-01',
      unit: 'g',
    });
    expect(await resolve()).toMatchObject({ source: 'contract' });
    expect((await resolve())!.unitPrice).toBeCloseTo(9.5, 6);
  });

  it('contract ignored when the `contracts` flag is off', async () => {
    await listPrice('12.0000', T0);
    await db.insert(supplierContractPrices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: '9.5',
      validFrom: '2020-01-01',
      unit: KG,
    });
    await setFeatures({ all: true, contracts: false });
    expect(await resolve()).toMatchObject({ source: 'list', unitPrice: 12 });
  });

  it('imported, captured, walk-in, draft and cancelled POs are never a last price', async () => {
    await listPrice('12.0000', T0);
    await pastPo('5.0000', T1, { source: 'platform' });
    await pastPo('5.0000', T1, { source: 'whatsapp' });
    await pastPo('5.0000', T1, { sourceRef: 'walk_in:abc' });
    await pastPo('5.0000', T1, { status: 'draft' });
    await pastPo('5.0000', T1, { status: 'cancelled' });
    expect(await resolve()).toMatchObject({ source: 'list', unitPrice: 12 });
  });

  it('a recurring sent PO counts; another restaurant never leaks in', async () => {
    const B = await seedTenant(db, 'B');
    const [poB] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: B.restaurantId, supplierId: B.supplierId, status: 'sent', source: 'manual', sentAt: T1 })
      .returning({ id: purchaseOrders.id });
    await db.insert(poLines).values({ poId: poB!.id, productId: A.productId, qtyOrdered: '1', unit: KG, unitPriceExpected: '1' });
    expect(await resolve()).toBeNull();
    await pastPo('7.0000', T1, { source: 'recurring' });
    expect(await resolve()).toMatchObject({ source: 'last_po', unitPrice: 7 });
  });

  it('parity: createDraft and captureOrderDraft price an unpriced line exactly like resolveExpectedPrice', async () => {
    await listPrice('12.0000', T0);
    await pastPo('10.5000', T1);
    const expected = await resolve(new Date());
    expect(expected).toMatchObject({ source: 'last_po', unitPrice: 10.5 });

    const { poId } = await callerFor(A).orders.createDraft({
      supplierId: A.supplierId,
      lines: [{ productId: A.productId, qty: 2, unit: KG }],
    });
    const [viaDraft] = await db.select().from(poLines).where(eq(poLines.poId, poId));
    expect(Number(viaDraft!.unitPriceExpected)).toBe(expected!.unitPrice);

    const cap = await captureOrderDraft(db, {
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      text: `2 ${KG} tomato-A`,
      parser: new StubOrderTextParser(),
      source: 'manual',
    });
    if (cap.status !== 'draft') throw new Error(`capture: ${cap.status}`);
    const capLines = await db.select().from(poLines).where(eq(poLines.poId, cap.poId));
    const mapped = capLines.find((l) => l.productId === A.productId);
    expect(mapped).toBeTruthy();
    // The capture keeps the parsed unit; parity is on the same (product, unit).
    const forUnit = await resolveExpectedPrice(db, {
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      at: new Date(),
      lines: [{ productId: A.productId, unit: mapped!.unit }],
    });
    const want = forUnit.get(orderPriceKey(A.productId, mapped!.unit));
    expect(mapped!.unitPriceExpected == null ? null : Number(mapped!.unitPriceExpected)).toBe(want?.unitPrice ?? null);
  });
});
