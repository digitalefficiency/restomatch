import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb, eq, and, notificationsOutbox, poLines, priceAlerts, priceAlertThresholds, priceHistory, products,
  restaurants, supplierCatalogItems, supplierContractPrices, suppliers, invoiceLines, testDbUrl, type RestaurantSettings,
} from '@restomatch/db';
import { runMatch } from '@restomatch/matching';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { runPriceAlertSweep } from '../priceAlerts/sweep';
import { findOverContractLines } from '../contracts/overContract';
import { detectSustainedIncrease } from '../priceAlerts/detect';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant; let B: Tenant;
const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
async function setFeatures(t: Tenant, features: Record<string, boolean> | null) {
  await db.update(restaurants).set({ settings: (features ? { features } : {}) as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
}
beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A'); B = await seedTenant(db, 'B');
  for (const t of [A, B]) await db.update(poLines).set({ productId: t.productId }).where(eq(poLines.id, t.poLineId));
});
beforeEach(async () => {
  await db.delete(supplierContractPrices); await db.delete(priceAlerts); await db.delete(priceAlertThresholds);
  await db.delete(priceHistory); await db.delete(notificationsOutbox); await db.delete(supplierCatalogItems);
  await setFeatures(A, { all: true }); await setFeatures(B, { all: true });
  await db.update(poLines).set({ unit: 'kg', unitPriceExpected: '8.5', qtyOrdered: '10' }).where(eq(poLines.id, A.poLineId));
  await db.update(invoiceLines).set({ unit: 'kg', unitPriceBilled: '10.00', qtyBilled: '10', lineTotal: '100.00' }).where(eq(invoiceLines.id, A.invoiceLineId));
});
afterAll(async () => { await resetDb(db); });

describe('R1 contract with unit NULL vs PO line in grams', () => {
  it('null-unit contract (product unit ק״ג) applied raw to a per-gram PO line', async () => {
    await db.update(poLines).set({ unit: 'g', unitPriceExpected: '0.0085', qtyOrdered: '10000' }).where(eq(poLines.id, A.poLineId));
    await db.update(invoiceLines).set({ unit: 'g', unitPriceBilled: '0.0100', qtyBilled: '10000', lineTotal: '100.00' }).where(eq(invoiceLines.id, A.invoiceLineId));
    const base = runMatch((await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))!.input);
    // via router, unit omitted (optional) => NULL
    await caller(A, 'manager').contracts.create({ supplierId: A.supplierId, productId: A.productId, contractPrice: 9, validFrom: '2020-01-01' });
    const built = (await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))!;
    const out = runMatch(built.input);
    console.log('R1 expected', built.input.poLines[0]!.unitPriceExpected, 'leak before', base.totalDiscrepancyAmount, 'after', out.totalDiscrepancyAmount,
      out.discrepancies.map((d) => [d.type, d.expected, d.actual, d.deltaAmount]));
    const oc = await findOverContractLines(db, A.restaurantId, { invoiceIds: [A.invoiceId] });
    console.log('R1 overContract lines', oc.length);
  });
});

describe('R2 contract above billed price inflates the leak via PRICE_LOWER', () => {
  it('PO 10 = billed 10 (clean), contract 12 → leak goes up', async () => {
    await db.update(poLines).set({ unitPriceExpected: '10' }).where(eq(poLines.id, A.poLineId));
    const base = runMatch((await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))!.input);
    await caller(A, 'manager').contracts.create({ supplierId: A.supplierId, productId: A.productId, contractPrice: 12, validFrom: '2020-01-01' });
    const out = runMatch((await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))!.input);
    console.log('R2 leak before', base.totalDiscrepancyAmount, base.discrepancies.map((d) => d.type), 'after', out.totalDiscrepancyAmount, out.discrepancies.map((d) => [d.type, d.deltaAmount]));
  });
});

const now = new Date('2026-10-18T12:00:00Z');
const at = (d: number) => new Date(now.getTime() - d * 86_400_000);
async function hist(t: Tenant, d: number, p: number, supplierId = t.supplierId) {
  await db.insert(priceHistory).values({ restaurantId: t.restaurantId, productId: t.productId, supplierId, observedAt: at(d), unitPrice: p.toFixed(4) });
}

describe('R3 cheaper offer ignores catalog unit / pack', () => {
  it('catalog list price per gram is suggested as cheaper than ₪/kg history', async () => {
    for (const [d, p] of [[20, 6.2], [13, 6.7], [6, 7.1], [1, 7.316]] as const) await hist(A, d, p);
    const [other] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק גרם' }).returning();
    await db.insert(supplierCatalogItems).values({ restaurantId: A.restaurantId, supplierId: other!.id, supplierNameRaw: 'עגבניות גרם', productId: A.productId, unit: 'g', listPrice: '0.0090' });
    await runPriceAlertSweep(db, A.restaurantId, { now });
    const [a] = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    console.log('R3 alert end', a?.endPrice, 'cheaper', a?.cheaperSupplierId === other!.id, a?.cheaperPrice, '(=₪9/kg, really MORE expensive)');
    await db.delete(supplierCatalogItems); await db.delete(priceAlerts); await db.delete(suppliers).where(eq(suppliers.id, other!.id));
  });
});

describe('R4 re-alert after dismiss / every new observation', () => {
  it('dismissed trend re-alerts and re-emails on the next same-price observation', async () => {
    for (const [d, p] of [[20, 6.2], [13, 6.7], [6, 7.1], [2, 7.316]] as const) await hist(A, d, p);
    const r1 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true });
    const [a1] = await db.select().from(priceAlerts);
    await caller(A, 'manager').priceAlerts.dismiss({ id: a1!.id });
    await hist(A, 1, 7.316); // same price, next day
    const r2 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true });
    await hist(A, 0.5, 7.316);
    const r3 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true });
    const open = await db.select().from(priceAlerts).where(eq(priceAlerts.status, 'open'));
    const mail = await db.select().from(notificationsOutbox);
    console.log('R4 sweeps', r1, r2, r3, 'open after dismiss', open.length, 'emails', mail.length);
  });
});

describe('R5 single-invoice spike with two lines', () => {
  it('one invoice with 2 lines at spike price after a stable period', () => {
    const pts = [
      { observedAt: at(20), unitPrice: 10 }, { observedAt: at(1), unitPrice: 13 }, { observedAt: at(1), unitPrice: 13 },
    ];
    console.log('R5 trend', detectSustainedIncrease(pts, { thresholdPct: 0.1, windowDays: 21 }, now));
    const pts2 = [{ observedAt: at(20), unitPrice: 10 }, { observedAt: at(19), unitPrice: 13 }, { observedAt: at(18), unitPrice: 13 }];
    console.log('R5b old spike 18 days ago, nothing since', detectSustainedIncrease(pts2, { thresholdPct: 0.1, windowDays: 21 }, now));
  });
});

describe('R6 import oddities', () => {
  it('long unit cell / proto header / formula / negative / 31-02', async () => {
    const c = caller(A, 'manager');
    const long = 'x'.repeat(40);
    const tries: Array<[string, string]> = [
      ['longunit', `name,unit,price\nעגבניה A,${long},9\n`],
      ['proto', `__proto__,price\nעגבניה A,9\n`],
      ['formula', `name,unit,price\nעגבניה A,=HYPERLINK("http://e"),9\n`],
      ['neg', `name,price,from\nעגבניה A,-5,1/1/2026\n`],
      ['feb31', `name,price,from\nעגבניה A,5,31/02/2026\n`],
      ['paren', `name,price\nעגבניה A,(5)\n`],
      ['huge', `name,price\nעגבניה A,99999999999\n`],
      ['nan', `name,price\nעגבניה A,NaN\n`],
      ['inf', `name,price\nעגבניה A,Infinity\n`],
      ['exp', `name,price\nעגבניה A,1e3\n`],
    ];
    for (const [k, text] of tries) {
      await db.delete(supplierContractPrices);
      try {
        const pv = await c.contracts.importPreview({ supplierId: A.supplierId, file: { filename: 'c.csv', text } });
        const mapping = k === 'proto' ? { name: '__proto__', price: 'price' } : pv.mapping;
        const res = await c.contracts.importCommit({ supplierId: A.supplierId, file: { filename: 'c.csv', text }, mapping, defaultValidFrom: '2026-01-01' });
        const rows = await db.select({ p: supplierContractPrices.contractPrice, u: supplierContractPrices.unit, f: supplierContractPrices.validFrom }).from(supplierContractPrices);
        console.log('R6', k, JSON.stringify(pv.mapping), JSON.stringify(res), JSON.stringify(rows));
      } catch (e: any) {
        console.log('R6', k, 'THREW', e.code, String(e.message).slice(0, 200));
      }
    }
  });
});

describe('R7 tenant: cross-tenant ids', () => {
  it('A manager uses B ids', async () => {
    const c = caller(A, 'manager');
    const [bc] = await db.insert(supplierContractPrices).values({ restaurantId: B.restaurantId, supplierId: B.supplierId, productId: B.productId, contractPrice: '1', validFrom: '2020-01-01' }).returning();
    const r: any[] = [];
    for (const [n, f] of [
      ['create B supplier', () => c.contracts.create({ supplierId: B.supplierId, productId: A.productId, contractPrice: 1, validFrom: '2026-01-01' })],
      ['create B product', () => c.contracts.create({ supplierId: A.supplierId, productId: B.productId, contractPrice: 1, validFrom: '2026-01-01' })],
      ['update B', () => c.contracts.update({ id: bc!.id, contractPrice: 2 })],
      ['delete B', () => c.contracts.delete({ id: bc!.id })],
      ['list B supplier', () => c.contracts.list({ supplierId: B.supplierId })],
      ['productOptions B', () => c.contracts.productOptions({ supplierId: B.supplierId })],
      ['ocfi B', () => c.contracts.overContractForInvoice({ invoiceId: B.invoiceId })],
      ['import B', () => c.contracts.importCommit({ supplierId: B.supplierId, file: { filename: 'c.csv', text: 'name,price\nעגבניה B,1\n' }, mapping: { name: 'name', price: 'price' }, defaultValidFrom: '2026-01-01' })],
      ['import A sup, B product name', () => c.contracts.importCommit({ supplierId: A.supplierId, file: { filename: 'c.csv', text: 'name,price\nעגבניה B,1\n' }, mapping: { name: 'name', price: 'price' }, defaultValidFrom: '2026-01-01' })],
      ['setThreshold B', () => c.priceAlerts.setThreshold({ supplierId: B.supplierId, category: null, thresholdPct: 0.1, windowDays: 21 })],
    ] as const) {
      try { r.push([n, 'OK', JSON.stringify(await (f as any)()).slice(0, 120)]); } catch (e: any) { r.push([n, e.code]); }
    }
    const [after] = await db.select().from(supplierContractPrices).where(eq(supplierContractPrices.id, bc!.id));
    console.log('R7', JSON.stringify(r), 'B row price', after?.contractPrice);
  });
});
