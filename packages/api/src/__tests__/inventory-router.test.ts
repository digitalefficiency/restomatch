import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  poLines,
  purchaseOrders,
  eq,
  inventoryCounts,
  invoiceLines,
  invoices,
  matchRuns,
  priceHistory,
  products,
  restaurants,
  sql,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { localToday, purchasesInPeriod } from '../inventory/data';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * inventory router (flag `inventoryCount`): start → autosave → finish with a
 * snapshot that never drifts; the food purchases between two counts (leak
 * engine rules: live duplicates out, non-food out, recovered claims credited);
 * the actual-food-cost period; tenant isolation; roles; the flag.
 */
const db = createDb(testDbUrl());
const TZ = 'Asia/Jerusalem';
const DAY = 86_400_000;
let A: Tenant;
let B: Tenant;
const P = {} as Record<'beef' | 'milk' | 'napkins' | 'salt' | 'tomato' | 'bBeef', string>;

const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const setFlags = (rid: string, f: Record<string, boolean>) =>
  db.update(restaurants).set({ settings: { features: f } as unknown as RestaurantSettings }).where(eq(restaurants.id, rid));

const today = localToday(TZ);
/** Local date `n` days before today, and noon UTC on it (unambiguously that local date). */
const ymdAgo = (n: number) => localToday(TZ, new Date(Date.now() - n * DAY));
const atAgo = (n: number) => new Date(`${ymdAgo(n)}T09:00:00Z`);

async function product(t: Tenant, name: string, unit: string, category: string | null) {
  const [p] = await db.insert(products).values({ restaurantId: t.restaurantId, canonicalName: name, defaultUnit: unit, category }).returning();
  return p!.id;
}
const price = (t: Tenant, productId: string, daysAgo: number, unitPrice: string) =>
  db.insert(priceHistory).values({ restaurantId: t.restaurantId, productId, supplierId: t.supplierId, observedAt: atAgo(daysAgo), unitPrice });

async function invoice(
  t: Tenant,
  daysAgo: number,
  totalExcl: string,
  opts: { nonFood?: { productId: string; total: string }; dup?: boolean; credit?: string; creditToReceive?: string } = {},
) {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, source: 'manual', invoiceNumber: `T-${Math.random()}`, invoiceDate: atAgo(daysAgo), totalExclVat: totalExcl, totalInclVat: totalExcl, status: 'matched' })
    .returning();
  if (opts.nonFood) {
    await db.insert(invoiceLines).values({ invoiceId: inv!.id, productId: opts.nonFood.productId, rawDescription: 'מפיות', qtyBilled: '1', unit: 'חבילה', unitPriceBilled: opts.nonFood.total, lineTotal: opts.nonFood.total });
  }
  if (opts.dup || opts.credit || opts.creditToReceive) {
    const [mr] = await db.insert(matchRuns).values({ restaurantId: t.restaurantId, invoiceId: inv!.id, overallStatus: 'major' }).returning();
    if (opts.dup) await db.insert(discrepancies).values({ restaurantId: t.restaurantId, matchRunId: mr!.id, type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: totalExcl });
    // 'resolved' = the credit was RECEIVED; 'accepted' = agreed, still to receive.
    if (opts.credit) await db.insert(discrepancies).values({ restaurantId: t.restaurantId, matchRunId: mr!.id, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: opts.credit, resolutionStatus: 'resolved' });
    if (opts.creditToReceive) await db.insert(discrepancies).values({ restaurantId: t.restaurantId, matchRunId: mr!.id, type: 'QTY_SHORT', severity: 'warn', deltaAmount: opts.creditToReceive, resolutionStatus: 'accepted' });
  }
  return inv!.id;
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'IA');
  B = await seedTenant(db, 'IB');
  for (const t of [A, B]) await setFlags(t.restaurantId, { inventoryCount: true });
  // seedTenant's own sample invoice would sit in the period: these purchases are exactly the ones below.
  for (const t of [A, B]) await db.delete(invoices).where(eq(invoices.restaurantId, t.restaurantId));
  P.beef = await product(A, 'אנטריקוט', 'ק״ג', 'בשר');
  P.milk = await product(A, 'חלב 3%', 'ליטר', 'מוצרי חלב');
  P.napkins = await product(A, 'מפיות', 'חבילה', 'חד״פ');
  P.salt = await product(A, 'מלח', 'ק״ג', 'יבשים');
  P.tomato = await product(A, 'עגבניות', 'ק״ג', 'ירקות'); // never priced
  P.bBeef = await product(B, 'אנטריקוט B', 'ק״ג', 'בשר');
  await price(A, P.beef, 40, '100.0000');
  await price(A, P.beef, 15, '120.0000');
  await price(A, P.milk, 30, '5.0000');
  await price(A, P.napkins, 30, '12.0000');
  await price(A, P.salt, 5, '3.0000');
  await price(B, P.bBeef, 30, '999.0000');
  // Purchases. In the period (after the opening count 20 days ago, up to today):
  await invoice(A, 10, '2000.00', { nonFood: { productId: P.napkins, total: '150.00' } }); // 1,850 food
  await invoice(A, 8, '500.00', { dup: true }); // live duplicate copy: out
  await invoice(A, 5, '1000.00', { credit: '40.00', creditToReceive: '25.00' }); // 40 received (subtracted), 25 still to receive (shown only)
  await invoice(A, 25, '7777.00'); // before the opening count: out
  await invoice(B, 10, '99999.00'); // another restaurant: out
});

afterAll(async () => {
  await resetDb(db);
});

describe('inventory: count → autosave → finish', () => {
  let opening: string;
  let closing: string;

  it('start prefills the food bought in the 60 days before the count, by storage area (non-food and later buys left out)', async () => {
    const r = await caller(A, 'chef').inventory.start({ countDate: ymdAgo(20) });
    expect(r.created).toBe(true);
    opening = r.id;
    const c = (await caller(A).inventory.current())!;
    expect(c.lines.map((l) => [l.name, l.storageArea, l.unit]).sort()).toEqual(
      [
        ['אנטריקוט', 'fridge', 'ק״ג'],
        ['חלב 3%', 'fridge', 'ליטר'],
      ].sort(),
    );
    // One draft at a time: starting again returns the same draft.
    expect(await caller(A).inventory.start()).toEqual({ id: opening, created: false });
  });

  it('autosaves quantities, adds a product by hand, and values live at the count date’s prices', async () => {
    await caller(A, 'chef').inventory.saveLines({
      countId: opening,
      lines: [
        { productId: P.beef, qty: '10' },
        { productId: P.milk, qty: '20', storageArea: 'bar' },
        { productId: P.tomato, qty: '3' }, // no price → excluded, shown
      ],
    });
    const c = (await caller(A).inventory.current())!;
    // ₪100/kg was the price 20 days ago (the ₪120 came later): 10 × 100 + 20 × 5
    expect(c.totalValueAgorot).toBe(110_000);
    expect(c.progress).toEqual({ lines: 3, counted: 3, notCounted: 0, unpriced: 1 });
    expect(c.lines.find((l) => l.productId === P.milk)!.storageArea).toBe('bar');
    expect(c.lines.find((l) => l.productId === P.tomato)!.status).toBe('noPrice');
  });

  it('finish snapshots unit costs + the total; a later price never moves a closed count', async () => {
    const done = await caller(A).inventory.complete({ countId: opening });
    expect(done).toMatchObject({ totalValueAgorot: 110_000, counted: 3, unpriced: 1, unpricedNames: [{ name: 'עגבניות' }] });
    await price(A, P.beef, 19, '500.0000'); // retro-dated price after the count was closed
    const c = await caller(A).inventory.get({ countId: opening });
    expect(c.status).toBe('completed');
    expect(c.totalValueAgorot).toBe(110_000);
    expect(c.lines.find((l) => l.productId === P.beef)).toMatchObject({ unitCost: '100.0000', valueAgorot: 100_000 });
    await db.delete(priceHistory).where(eq(priceHistory.unitPrice, '500.0000'));
    // A closed count is read-only.
    await expect(caller(A).inventory.saveLines({ countId: opening, lines: [{ productId: P.beef, qty: '1' }] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(caller(A).inventory.complete({ countId: opening })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('closing count today + actual food cost for the period (manual sales)', async () => {
    closing = (await caller(A).inventory.start()).id;
    const c0 = (await caller(A).inventory.get({ countId: closing }));
    expect(c0.countDate).toBe(today);
    // Areas carry over from the previous count; salt (bought 5 days ago) is now on the list.
    expect(c0.lines.find((l) => l.productId === P.milk)!.storageArea).toBe('bar');
    expect(c0.lines.some((l) => l.productId === P.salt)).toBe(true);
    await caller(A).inventory.saveLines({ countId: closing, lines: [{ productId: P.beef, qty: '5' }, { productId: P.milk, qty: '10' }, { productId: P.salt, qty: '2' }] });
    expect((await caller(A).inventory.complete({ countId: closing, acceptUncounted: true })).totalValueAgorot).toBe(65_600); // 600 + 50 + 6

    const before = await caller(A).inventory.period();
    expect(before).toMatchObject({ available: true, salesAgorot: null, actualBp: null });
    await caller(A).inventory.setMeta({ countId: closing, foodSalesExVat: '10000.00' });
    const p = await caller(A).inventory.period();
    expect(p).toMatchObject({
      available: true,
      // Food values: the milk moved to the bar shelf is not food cost (₪100 / ₪50 out).
      opening: { id: opening, valueAgorot: 100_000 },
      closing: { id: closing, valueAgorot: 60_600 },
      purchases: {
        invoiceCount: 2,
        invoicesAgorot: 300_000,
        nonFoodAgorot: 15_000,
        duplicateCount: 1,
        duplicatesAgorot: 50_000,
        creditsAgorot: 4_000,
        creditsToReceiveAgorot: 2_500,
        purchasesAgorot: 285_000,
      },
      salesAgorot: 1_000_000,
      salesSource: 'manual',
      theoreticalAgorot: null,
      // 1,000 + 2,850 − 40 credits − 606 = 3,204 → 32.04% of ₪10,000
      actualAgorot: 320_400,
      actualBp: 3204,
      varianceAlert: false,
    });
    expect((await caller(A).inventory.history()).map((h) => [h.id, h.totalValueAgorot, h.counted, h.unpriced])).toEqual([
      [closing, 65_600, 3, 0],
      [opening, 110_000, 3, 1],
    ]);
  });

  it('a draft can be discarded; one draft per restaurant is enforced by the DB too', async () => {
    const d = await caller(A).inventory.start();
    await expect(
      db.insert(inventoryCounts).values({ restaurantId: A.restaurantId, countDate: today, status: 'draft' }),
    ).rejects.toThrow();
    await caller(A).inventory.discard({ countId: d.id });
    expect(await caller(A).inventory.current()).toBeNull();
  });

  it('validation: future date, foreign or non-food product, nothing counted', async () => {
    await expect(caller(A).inventory.start({ countDate: '2999-01-01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const d = await caller(A).inventory.start();
    await expect(caller(A).inventory.saveLines({ countId: d.id, lines: [{ productId: P.bBeef, qty: '1' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller(A).inventory.saveLines({ countId: d.id, lines: [{ productId: P.napkins, qty: '1' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller(A).inventory.saveLines({ countId: d.id, lines: [{ productId: P.beef, qty: '-1' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller(A).inventory.complete({ countId: d.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller(A).inventory.discard({ countId: d.id });
  });

  it("isolation: B sees none of A's counts and cannot read or write them", async () => {
    expect(await caller(B).inventory.history()).toEqual([]);
    expect(await caller(B).inventory.current()).toBeNull();
    expect(await caller(B).inventory.period()).toEqual({ available: false, reason: 'noCounts' });
    await expect(caller(B).inventory.get({ countId: opening })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller(B).inventory.setMeta({ countId: closing, foodSalesExVat: '1.00' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller(B).inventory.discard({ countId: closing })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // B's own count never lists A's products, and B's invoice never reaches A's purchases (asserted above).
    const d = await caller(B).inventory.start();
    const c = await caller(B).inventory.get({ countId: d.id });
    expect(c.lines.map((l) => l.productId)).toContain(P.bBeef);
    expect(c.lines.some((l) => Object.values(P).includes(l.productId) && l.productId !== P.bBeef)).toBe(false);
    await expect(caller(B).inventory.saveLines({ countId: d.id, lines: [{ productId: P.beef, qty: '1' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller(B).inventory.discard({ countId: d.id });
  });

  it('products: a counted product cannot be deleted (friendly CONFLICT, not a raw FK error)', async () => {
    await expect(caller(A).products.delete({ productId: P.salt })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('inventory: flag + roles', () => {
  it('owner/manager/chef count; receiver/bookkeeper are FORBIDDEN', async () => {
    for (const role of ['owner', 'manager', 'chef'] as const) await expect(caller(A, role).inventory.history()).resolves.toBeDefined();
    for (const role of ['receiver', 'bookkeeper'] as const) await expect(caller(A, role).inventory.history()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('flag off ⇒ FORBIDDEN FEATURE_DISABLED (and enabled=false); FEATURES_OFF kills it', async () => {
    expect(await caller(A).inventory.enabled()).toEqual({ enabled: true });
    await setFlags(A.restaurantId, {});
    try {
      expect(await caller(A).inventory.enabled()).toEqual({ enabled: false });
      await expect(caller(A).inventory.history()).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FEATURE_DISABLED:inventoryCount' });
      await setFlags(A.restaurantId, { inventoryCount: true });
      process.env.FEATURES_OFF = 'inventoryCount';
      await expect(caller(A).inventory.current()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      delete process.env.FEATURES_OFF;
      await setFlags(A.restaurantId, { inventoryCount: true });
    }
  });

  it('a restaurant delete cascades through counts and lines', async () => {
    const C = await seedTenant(db, 'IC');
    await setFlags(C.restaurantId, { inventoryCount: true });
    const pid = await product(C, 'קמח', 'ק״ג', 'יבשים');
    await price(C, pid, 3, '4.0000');
    const d = await caller(C).inventory.start();
    await caller(C).inventory.saveLines({ countId: d.id, lines: [{ productId: pid, qty: '1' }] });
    await db.delete(restaurants).where(eq(restaurants.id, C.restaurantId));
    const rows = (await db.execute(sql`select count(*)::int as n from inventory_counts where id = ${d.id}`)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('inventory: purchases on receipt dates — delivery notes billed later count exactly once', () => {
  it('added in the period they arrive (PO prices, food only), taken back when the consolidated invoice lands', async () => {
    const D = await seedTenant(db, 'ID');
    await db.delete(invoices).where(eq(invoices.restaurantId, D.restaurantId));
    const milk = await product(D, 'חלב', 'ליטר', 'מוצרי חלב');
    const cups = await product(D, 'כוסות', 'חבילה', 'חד״פ');
    const note = async (dn: string, daysAgo: number) => {
      const [po] = await db.insert(purchaseOrders).values({ restaurantId: D.restaurantId, supplierId: D.supplierId, status: 'closed' }).returning();
      const [ml] = await db.insert(poLines).values({ poId: po!.id, productId: milk, rawDescription: 'חלב', qtyOrdered: '10', unit: 'ליטר', unitPriceExpected: '5.0000' }).returning();
      const [cl] = await db.insert(poLines).values({ poId: po!.id, productId: cups, rawDescription: 'כוסות', qtyOrdered: '1', unit: 'חבילה', unitPriceExpected: '30.0000' }).returning();
      const [gr] = await db.insert(goodsReceipts).values({ restaurantId: D.restaurantId, poId: po!.id, receivedAt: atAgo(daysAgo), status: 'completed', notes: `ת.מ. ${dn}` }).returning();
      // 10 L received, 2 L rejected → 8 L × ₪5 = ₪40 food; the cups (non-food) stay out.
      await db.insert(grLines).values([
        { grId: gr!.id, poLineId: ml!.id, productId: milk, qtyReceived: '10', qtyRejected: '2' },
        { grId: gr!.id, poLineId: cl!.id, productId: cups, qtyReceived: '1' },
      ]);
    };
    await note('7001', 20);
    await note('7002', 18);
    // The consolidated invoice for both notes arrives 10 days ago: ₪80 food (+₪0 non-food on its lines here).
    await db.insert(invoices).values({
      restaurantId: D.restaurantId,
      supplierId: D.supplierId,
      source: 'manual',
      invoiceNumber: 'GD-M-TEST',
      invoiceDate: atAgo(10),
      totalExclVat: '80.00',
      totalInclVat: '94.40',
      status: 'parsed',
      ocrPayload: { raw: { deliveryNotes: [{ number: '7001' }, { number: '7002' }] } } as never,
    });
    const p1 = await purchasesInPeriod(db, D.restaurantId, TZ, ymdAgo(30), ymdAgo(15));
    expect(p1).toMatchObject({ invoiceCount: 0, accruedNotes: 2, accruedAgorot: 8_000, reversedAgorot: 0, purchasesAgorot: 8_000 });
    const p2 = await purchasesInPeriod(db, D.restaurantId, TZ, ymdAgo(15), today);
    expect(p2).toMatchObject({ invoiceCount: 1, invoicesAgorot: 8_000, accruedAgorot: 0, reversedAgorot: 8_000, purchasesAgorot: 0 });
    // One period spanning both: the invoice once, nothing added or taken back.
    const all = await purchasesInPeriod(db, D.restaurantId, TZ, ymdAgo(30), today);
    expect(all).toMatchObject({ invoicesAgorot: 8_000, accruedAgorot: 0, reversedAgorot: 0, purchasesAgorot: 8_000 });
    expect(p1.purchasesAgorot + p2.purchasesAgorot).toBe(all.purchasesAgorot);
  });
});
