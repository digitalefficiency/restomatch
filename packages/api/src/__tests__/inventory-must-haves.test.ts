import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLog,
  createDb,
  eq,
  goodsReceipts,
  grLines,
  invoices,
  poLines,
  priceHistory,
  products,
  purchaseOrders,
  restaurants,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { localToday } from '../inventory/data';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * The competitor-research must-haves for inventory counting: blank ≠ zero
 * (closing with uncounted lines needs an explicit OK), close & lock by
 * owner/manager with an audit trail and owner-only amendments, the price
 * source per line, the sanity check (more than last count + received since),
 * the first-month "purchases food cost", and the CSV for the accountant.
 */
const db = createDb(testDbUrl());
const TZ = 'Asia/Jerusalem';
const DAY = 86_400_000;
const ymdAgo = (n: number) => localToday(TZ, new Date(Date.now() - n * DAY));
const atAgo = (n: number) => new Date(`${ymdAgo(n)}T09:00:00Z`);
let A: Tenant;
let B: Tenant;
let beef: string;
let rice: string;
let invId: string;

const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'MA');
  B = await seedTenant(db, 'MB');
  for (const t of [A, B]) {
    await db.update(restaurants).set({ settings: { features: { inventoryCount: true } } as unknown as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
    await db.delete(invoices).where(eq(invoices.restaurantId, t.restaurantId));
  }
  beef = (await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: '=HYPERLINK("x")', nameEn: 'Beef', defaultUnit: 'ק״ג', category: 'בשר' }).returning())[0]!.id;
  rice = (await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'אורז', defaultUnit: 'ק״ג', category: 'יבשים' }).returning())[0]!.id;
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, source: 'manual', invoiceNumber: 'INV-4711', invoiceDate: atAgo(12), totalExclVat: '1200.00', totalInclVat: '1416.00', status: 'matched' })
    .returning();
  invId = inv!.id;
  await db.insert(priceHistory).values([
    { restaurantId: A.restaurantId, productId: beef, supplierId: A.supplierId, observedAt: atAgo(12), unitPrice: '120.0000', sourceInvoiceId: invId },
    { restaurantId: A.restaurantId, productId: rice, supplierId: A.supplierId, observedAt: atAgo(12), unitPrice: '8.0000' },
  ]);
});

afterAll(async () => {
  await resetDb(db);
});

describe('first count: blank ≠ zero, close by owner/manager, price source, first-month purchases food cost', () => {
  let first: string;

  it('a chef counts but cannot close; closing with blank lines needs an explicit OK, and blanks stay "not counted"', async () => {
    first = (await caller(A, 'chef').inventory.start({ countDate: ymdAgo(10) })).id;
    await caller(A, 'chef').inventory.saveLines({ countId: first, lines: [{ productId: beef, qty: '5' }] });
    const view = await caller(A, 'chef').inventory.get({ countId: first });
    expect(view).toMatchObject({ canClose: false, canAmend: false });
    await expect(caller(A, 'chef').inventory.complete({ countId: first, acceptUncounted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(A, 'manager').inventory.complete({ countId: first })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'UNCOUNTED:1' });
    const done = await caller(A, 'manager').inventory.complete({ countId: first, acceptUncounted: true });
    expect(done).toMatchObject({ totalValueAgorot: 60_000, counted: 1, notCounted: 1, uncountedNames: [{ name: 'אורז' }] });
    const closed = await caller(A).inventory.get({ countId: first });
    const riceLine = closed.lines.find((l) => l.productId === rice)!;
    expect(riceLine).toMatchObject({ qty: null, valueAgorot: null, status: 'notCounted' });
    // Price source frozen with the snapshot: invoice number, date, supplier.
    expect(closed.lines.find((l) => l.productId === beef)!.priceSource).toMatchObject({ invoiceNumber: 'INV-4711', invoiceDate: ymdAgo(12), invoiceId: invId });
    // Close is on the audit trail.
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, first));
    expect(audits.map((a) => a.action)).toContain('inventory.count_closed');
  });

  it('with one count only: "purchases food cost" for the month, never an invented opening', async () => {
    await caller(A).inventory.setMeta({ countId: first, foodSalesExVat: '4000.00' });
    const p = await caller(A).inventory.period();
    expect(p.available).toBe(false);
    if (p.available) return;
    expect(p.reason).toBe('needOpening');
    // INV-4711 (₪1,200) falls in the count's month only when 12 days ago is in the same month as 10 days ago.
    const sameMonth = ymdAgo(12).slice(0, 7) === ymdAgo(10).slice(0, 7);
    expect('purchaseFoodCost' in p && p.purchaseFoodCost).toMatchObject({
      purchasesAgorot: sameMonth ? 120_000 : 0,
      salesAgorot: 400_000,
      bp: sameMonth ? 3000 : 0,
    });
  });

  it('the chef counts but sees no ₪ (owner decision): no values, prices, sales or period; no CSV', async () => {
    const chef = caller(A, 'chef');
    const view = await chef.inventory.get({ countId: first });
    expect(view).toMatchObject({ showMoney: false, totalValueAgorot: null, foodSalesExVat: null });
    for (const l of view.lines) expect(l).toMatchObject({ unitCost: null, valueAgorot: null, priceSource: null });
    // The count itself still reads: quantities, status and tallies.
    expect(view.lines.find((l) => l.productId === beef)).toMatchObject({ qty: '5.0000', status: 'ok' });
    const hist = await chef.inventory.history();
    expect(hist.length).toBeGreaterThan(0);
    for (const h of hist) expect(h).toMatchObject({ totalValueAgorot: null, foodSalesExVat: null });
    await expect(chef.inventory.period()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(chef.inventory.exportCsv({ countId: first })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(chef.inventory.setMeta({ countId: first, foodSalesExVat: '1.00' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Owner and manager keep every ₪.
    const owner = await caller(A, 'manager').inventory.get({ countId: first });
    expect(owner.showMoney).toBe(true);
    expect(owner.totalValueAgorot).toBe(60_000);
    expect((await caller(A, 'manager').inventory.history())[0]!.totalValueAgorot).toBe(60_000);
  });

  it('owner-only amendment of a closed count, with a reason, recomputes the total and is logged', async () => {
    await expect(caller(A, 'manager').inventory.amendLine({ countId: first, productId: beef, qty: '4', reason: 'recount' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(B).inventory.amendLine({ countId: first, productId: beef, qty: '4', reason: 'hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const r = await caller(A).inventory.amendLine({ countId: first, productId: beef, qty: '4', reason: 'מקרר נספר פעמיים' });
    expect(r.totalValueAgorot).toBe(48_000); // 4 × ₪120 at the snapshot unit cost
    const audit = (await db.select().from(auditLog).where(eq(auditLog.entityId, first))).find((a) => a.action === 'inventory.line_amended')!;
    expect(audit.before).toMatchObject({ qty: '5.0000', valueAgorot: 60_000 });
    expect(audit.after).toMatchObject({ qty: '4', valueAgorot: 48_000, reason: 'מקרר נספר פעמיים' });
    await expect(caller(A).inventory.amendLine({ countId: first, productId: beef, qty: '4', reason: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('CSV for the accountant: BOM, header, every line, total, spreadsheet formulas neutralised; foreign id → NOT_FOUND', async () => {
    const { filename, csv } = await caller(A).inventory.exportCsv({ countId: first });
    expect(filename).toBe(`inventory-count-${ymdAgo(10)}.csv`);
    expect(csv.startsWith('﻿"item","item_en","area","qty","unit","unit_cost_ex_vat","value_ex_vat","price_invoice"')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")","Beef","fridge","4.0000","ק״ג","120.0000","480.00","INV-4711"`);
    expect(csv).toContain('"אורז","","dry","","ק״ג","","",""');
    expect(csv).toContain('"TOTAL","","","","","","480.00"');
    await expect(caller(B).inventory.exportCsv({ countId: first })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('sanity check: counted more than the last count + received since → "check"', () => {
  it('flags a line above last count + goods received, not one within it', async () => {
    // 6 kg of rice received after the first count (last count: rice blank → no judgement; beef 4 kg).
    const [po] = await db.insert(purchaseOrders).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'closed' }).returning();
    const [pl] = await db.insert(poLines).values({ poId: po!.id, productId: beef, rawDescription: 'בשר', qtyOrdered: '3', unit: 'ק״ג', unitPriceExpected: '120.0000' }).returning();
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, poId: po!.id, receivedAt: atAgo(5), status: 'completed' }).returning();
    await db.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId: beef, qtyReceived: '3' });
    const d = await caller(A).inventory.start();
    // 4 (last count) + 3 (received) = 7: 7 is fine, 7.5 is not.
    await caller(A).inventory.saveLines({ countId: d.id, lines: [{ productId: beef, qty: '7' }, { productId: rice, qty: '50' }] });
    let v = await caller(A).inventory.get({ countId: d.id });
    expect(v.lines.find((l) => l.productId === beef)!.check).toBe(false);
    expect(v.lines.find((l) => l.productId === rice)!.check).toBe(false); // no last count to judge against
    await caller(A).inventory.saveLines({ countId: d.id, lines: [{ productId: beef, qty: '7.5' }] });
    v = await caller(A).inventory.get({ countId: d.id });
    expect(v.lines.find((l) => l.productId === beef)!.check).toBe(true);
    const done = await caller(A).inventory.complete({ countId: d.id, acceptUncounted: true });
    expect(done.checkNames).toEqual([{ name: '=HYPERLINK("x")', nameEn: 'Beef' }]);
  });
});
