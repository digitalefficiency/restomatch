import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  inventoryCounts,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  priceHistory,
  products,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { isFood, localToday, purchasesInPeriod } from '../inventory/data';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Regressions from the independent refuter on `inventoryCount`: a partial
 * recipe coverage must never raise the "unexplained usage" alarm; a claim on a
 * non-food line is not a food credit; delivery notes are matched per supplier
 * on a normalised number; a completed count's tallies are its snapshot.
 */
const db = createDb(testDbUrl());
const TZ = 'Asia/Jerusalem';
const DAY = 86_400_000;
const ymdAgo = (n: number) => localToday(TZ, new Date(Date.now() - n * DAY));
const atAgo = (n: number) => new Date(`${ymdAgo(n)}T09:00:00Z`);
const today = localToday(TZ);
let createdPosTable = false;
let T: Tenant;

const caller = (t: Tenant) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);
const flags = (rid: string, f: Record<string, boolean>) =>
  db.update(restaurants).set({ settings: { features: f } as unknown as RestaurantSettings }).where(eq(restaurants.id, rid));

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'FX');
  await db.delete(invoices).where(eq(invoices.restaurantId, T.restaurantId));
  const [reg] = (await db.execute(sql`select to_regclass('public.pos_sales')::text as t`)) as unknown as Array<{ t: string | null }>;
  if (!reg?.t) {
    // S5's migration 0058 shape, as in recipes-pos.test.ts.
    createdPosTable = true;
    await db.execute(sql`create table if not exists pos_sales_imports (
      id uuid primary key default gen_random_uuid(),
      restaurant_id uuid not null references restaurants(id) on delete cascade,
      provider varchar(32) not null, filename text not null,
      period_from date not null, period_to date not null,
      row_count integer not null default 0, total_net numeric(12,2) not null default '0',
      created_by uuid, created_at timestamptz not null default now())`);
    await db.execute(sql`create table pos_sales (
      id uuid primary key default gen_random_uuid(),
      restaurant_id uuid not null references restaurants(id) on delete cascade,
      import_id uuid not null references pos_sales_imports(id) on delete cascade,
      sold_on date not null, item_ref varchar(64) not null, item_name text not null,
      qty numeric(12,3) not null, net_amount numeric(12,2) not null,
      created_at timestamptz not null default now())`);
  }
});

afterAll(async () => {
  if (createdPosTable) {
    await db.execute(sql`drop table if exists pos_sales`);
    await db.execute(sql`drop table if exists pos_sales_imports`);
  } else {
    await db.execute(sql`delete from pos_sales_imports where restaurant_id = ${T.restaurantId}`);
  }
  await resetDb(db);
});

describe('isFood (free-text categories)', () => {
  it('catches the usual spellings of disposables and cleaning, and nothing else', () => {
    for (const c of ['חד״פ', 'חד"פ', "חד''פ", 'חד׳׳פ', 'חד פעמי', 'חד-פעמי', 'ניקיון', 'חומרי ניקוי', 'Cleaning', 'Disposables']) expect(isFood(c), c).toBe(false);
    for (const c of ['בשר', 'ירקות', 'מוצרי חלב', 'Dairy', 'Meat', null]) expect(isFood(c), String(c)).toBe(true);
  });
});

describe('unexplained usage is compared only on what the recipes cover', () => {
  it('10% of sales with a recipe ⇒ partial (no theory, no alarm); full coverage ⇒ scaled theory + variance', async () => {
    await flags(T.restaurantId, { inventoryCount: true, recipes: true, integrations: true });
    const [p] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'בשר טחון', defaultUnit: 'ק״ג', category: 'בשר' }).returning();
    await db.insert(priceHistory).values({ restaurantId: T.restaurantId, productId: p!.id, supplierId: T.supplierId, observedAt: atAgo(30), unitPrice: '40.0000' });
    // ₪10 per burger (250 g × ₪40/kg).
    await caller(T).recipes.save({ name: 'בורגר', nameEn: 'Burger', menuPriceAgorot: 5900, items: [{ productId: p!.id, quantity: '250', unit: 'גרם', wastePct: 0 }] });
    // Opening ₪9,000, closing ₪0, no purchases ⇒ actual ₪9,000.
    await db.insert(inventoryCounts).values([
      { restaurantId: T.restaurantId, countDate: ymdAgo(10), status: 'completed', totalValueAgorot: 900_000, completedAt: new Date(Date.now() - 2_000) },
      { restaurantId: T.restaurantId, countDate: today, status: 'completed', totalValueAgorot: 0, completedAt: new Date() },
    ]);
    const [imp] = (await db.execute(sql`insert into pos_sales_imports (restaurant_id, provider, filename, period_from, period_to)
      values (${T.restaurantId}, 'csv', 't.csv', ${ymdAgo(9)}::date, ${today}::date) returning id`)) as unknown as Array<{ id: string }>;
    await db.execute(sql`insert into pos_sales (restaurant_id, import_id, sold_on, item_ref, item_name, qty, net_amount) values
      (${T.restaurantId}, ${imp!.id}, ${ymdAgo(5)}::date, 'B1', 'Burger', 100, 3000.00),
      (${T.restaurantId}, ${imp!.id}, ${ymdAgo(5)}::date, 'P1', 'Pasta', 900, 27000.00)`);
    const partial = await caller(T).inventory.period();
    expect(partial).toMatchObject({
      available: true,
      salesAgorot: 3_000_000,
      salesSource: 'pos',
      actualBp: 3000,
      theoreticalAgorot: null,
      theoreticalCoverageBp: 1000,
      varianceAgorot: null,
      varianceAlert: false,
    });
    // Only the burger sells: theory covers all sales.
    await db.execute(sql`delete from pos_sales where restaurant_id = ${T.restaurantId} and item_ref = 'P1'`);
    const full = await caller(T).inventory.period();
    expect(full).toMatchObject({ salesAgorot: 300_000, theoreticalAgorot: 100_000, theoreticalCoverageBp: 10_000, varianceAgorot: 800_000, varianceAlert: true });
    await db.execute(sql`delete from pos_sales where restaurant_id = ${T.restaurantId}`);
    await db.delete(inventoryCounts).where(eq(inventoryCounts.restaurantId, T.restaurantId));
  });
});

describe('purchases: credits and delivery notes', () => {
  it('a claim accepted on a non-food line is not taken out of food purchases again', async () => {
    const [clean] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'אקונומיקה', defaultUnit: 'יח׳', category: 'ניקיון' }).returning();
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, source: 'manual', invoiceNumber: 'CR-1', invoiceDate: atAgo(4), totalExclVat: '1000.00', totalInclVat: '1180.00', status: 'matched' })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({ invoiceId: inv!.id, productId: clean!.id, rawDescription: 'אקונומיקה', qtyBilled: '10', unit: 'יח׳', unitPriceBilled: '40.0000', lineTotal: '400.00' })
      .returning();
    const [mr] = await db.insert(matchRuns).values({ restaurantId: T.restaurantId, invoiceId: inv!.id, overallStatus: 'minor' }).returning();
    await db.insert(discrepancies).values({ restaurantId: T.restaurantId, matchRunId: mr!.id, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '100.00', resolutionStatus: 'accepted', invoiceLineId: line!.id, productId: clean!.id });
    const p = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), today);
    expect(p).toMatchObject({ invoicesAgorot: 100_000, nonFoodAgorot: 40_000, creditsAgorot: 0, purchasesAgorot: 60_000 });
    await db.delete(invoices).where(eq(invoices.id, inv!.id));
  });

  it('notes match per supplier on a normalised number (another supplier’s "100" never covers ours; "07001" covers "7001")', async () => {
    const [other] = await db.insert(suppliers).values({ restaurantId: T.restaurantId, name: 'ספק אחר', businessId: '519999777' }).returning();
    const [milk] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'חלב', defaultUnit: 'ליטר', category: 'מוצרי חלב' }).returning();
    const note = async (supplierId: string, dn: string, daysAgo: number) => {
      const [po] = await db.insert(purchaseOrders).values({ restaurantId: T.restaurantId, supplierId, status: 'closed' }).returning();
      const [pl] = await db.insert(poLines).values({ poId: po!.id, productId: milk!.id, rawDescription: 'חלב', qtyOrdered: '10', unit: 'ליטר', unitPriceExpected: '5.0000' }).returning();
      const [gr] = await db.insert(goodsReceipts).values({ restaurantId: T.restaurantId, poId: po!.id, receivedAt: atAgo(daysAgo), status: 'completed', notes: `ת.מ. ${dn}` }).returning();
      await db.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId: milk!.id, qtyReceived: '10' });
    };
    await note(T.supplierId, '100', 6); // ours, not billed yet → accrued ₪50
    await note(other!.id, '100', 6); // the other supplier's, billed below
    await note(T.supplierId, '7001', 6); // ours, billed as "07001" (plain-string element)
    await db.insert(invoices).values([
      { restaurantId: T.restaurantId, supplierId: other!.id, source: 'manual', invoiceNumber: 'O-M', invoiceDate: atAgo(2), totalExclVat: '50.00', totalInclVat: '59.00', status: 'parsed', ocrPayload: { raw: { deliveryNotes: [{ number: '100' }] } } as never },
      { restaurantId: T.restaurantId, supplierId: T.supplierId, source: 'manual', invoiceNumber: 'T-M', invoiceDate: atAgo(2), totalExclVat: '50.00', totalInclVat: '59.00', status: 'parsed', ocrPayload: { raw: { deliveryNotes: ['07001'] } } as never },
    ]);
    const p = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), today);
    expect(p).toMatchObject({ invoicesAgorot: 10_000, accruedNotes: 1, accruedAgorot: 5_000, reversedAgorot: 0, purchasesAgorot: 15_000 });
  });
});

describe('a completed count is its snapshot', () => {
  it('get().progress does not change when a back-dated price appears after completion', async () => {
    await flags(T.restaurantId, { inventoryCount: true });
    const [salt] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'מלח', defaultUnit: 'ק״ג', category: 'יבשים' }).returning();
    const d = await caller(T).inventory.start();
    await caller(T).inventory.saveLines({ countId: d.id, lines: [{ productId: salt!.id, qty: '2' }] });
    const done = await caller(T).inventory.complete({ countId: d.id });
    expect(done.unpriced).toBe(1);
    await db.insert(priceHistory).values({ restaurantId: T.restaurantId, productId: salt!.id, supplierId: T.supplierId, observedAt: atAgo(3), unitPrice: '3.0000' });
    const c = await caller(T).inventory.get({ countId: d.id });
    expect(c.progress).toMatchObject({ counted: 1, unpriced: 1 });
    expect(c.totalValueAgorot).toBe(0);
  });

  it('dates before 2000 are rejected (no Postgres error)', async () => {
    await expect(caller(T).inventory.start({ countDate: '0000-01-01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
