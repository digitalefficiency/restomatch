import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  priceAlerts,
  priceHistory,
  products,
  restaurants,
  supplierContractPrices,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { loadContractsQueue, overActionFor } from '../contracts/queue';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-12 `contracts.queue` — the "לטיפול" queue. A lab-like seed: entrecôte
 * ₪149 vs ₪139 × 10 kg = ₪100.00 and salmon ₪96 vs ₪89 × 7.5 kg = ₪52.50, plus
 * one open tomato price alert (an estimate, never in the header).
 */

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let salmonId: string;
let salmonInvoiceId: string;
let salmonLineId: string;
let salmonRunId: string;

const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function contract(t: Tenant, productId: string, price: string) {
  await db.insert(supplierContractPrices).values({
    restaurantId: t.restaurantId,
    supplierId: t.supplierId,
    productId,
    contractPrice: price,
    validFrom: '2020-01-01',
  });
}

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
  // Entrecôte: the fixture invoice line → 10 kg billed at ₪149, its PRICE_HIGHER linked to the line.
  await db.update(products).set({ canonicalName: 'אנטריקוט' }).where(eq(products.id, A.productId));
  await db.update(invoiceLines).set({ unitPriceBilled: '149.0000', lineTotal: '1490.00' }).where(eq(invoiceLines.id, A.invoiceLineId));
  await db
    .update(discrepancies)
    .set({ invoiceLineId: A.invoiceLineId, deltaAmount: '100.00' })
    .where(eq(discrepancies.id, A.discrepancyId));

  // Salmon: a second invoice, 7.5 kg at ₪96, its own run + open PRICE_HIGHER.
  const [salmon] = await db
    .insert(products)
    .values({ restaurantId: A.restaurantId, canonicalName: 'פילה סלמון', defaultUnit: 'ק״ג', supplierId: A.supplierId })
    .returning();
  salmonId = salmon!.id;
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: 'MF-1',
      invoiceDate: daysAgo(3),
      totalExclVat: '720.00',
      vatAmount: '122.40',
      totalInclVat: '842.40',
      status: 'matched',
      source: 'photo',
    })
    .returning();
  salmonInvoiceId = inv!.id;
  const [line] = await db
    .insert(invoiceLines)
    .values({ invoiceId: inv!.id, productId: salmonId, rawDescription: 'סלמון', qtyBilled: '7.5', unit: 'ק״ג', unitPriceBilled: '96.0000', lineTotal: '720.00' })
    .returning();
  salmonLineId = line!.id;
  const [run] = await db
    .insert(matchRuns)
    .values({ restaurantId: A.restaurantId, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '52.50' })
    .returning();
  salmonRunId = run!.id;
  await db.insert(discrepancies).values({
    restaurantId: A.restaurantId,
    matchRunId: run!.id,
    invoiceLineId: line!.id,
    type: 'PRICE_HIGHER',
    severity: 'warn',
    deltaAmount: '52.50',
    resolutionStatus: 'open',
  });
});

beforeEach(async () => {
  await db.delete(supplierContractPrices);
  await db.delete(priceAlerts);
  await db.delete(priceHistory);
  await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, salmonInvoiceId));
  await db.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.matchRunId, salmonRunId));
});

afterAll(async () => {
  await resetDb(db);
});

async function tomatoAlert(t: Tenant) {
  // ₪6.20 → ₪7.34 with 100 kg invoiced in 90 days: (1.14 × 100) ÷ 3 = ₪38.00/month.
  const [tomato] = await db
    .insert(products)
    .values({ restaurantId: t.restaurantId, canonicalName: `עגבניות ${Date.now()}`, defaultUnit: 'ק״ג' })
    .returning();
  for (const [d, p] of [[20, '6.20'], [16, '6.20'], [8, '7.30'], [4, '7.32'], [1, '7.34']] as const) {
    await db.insert(priceHistory).values({
      restaurantId: t.restaurantId,
      productId: tomato!.id,
      supplierId: t.supplierId,
      observedAt: daysAgo(d),
      unitPrice: p,
      qty: '20',
    });
  }
  const [a] = await db
    .insert(priceAlerts)
    .values({
      restaurantId: t.restaurantId,
      productId: tomato!.id,
      supplierId: t.supplierId,
      windowDays: 21,
      thresholdPct: '0.1000',
      startPrice: '6.2000',
      endPrice: '7.3400',
      pctChange: '0.1806',
      startAt: daysAgo(20),
      endAt: daysAgo(1),
      observations: 5,
      dedupeKey: `t:${t.restaurantId}`,
    })
    .returning();
  return a!.id;
}

describe('contracts.queue (W2-12)', () => {
  it('lab-like seed: header Σ = 15,250 agorot over 2 billed lines; the alert is ranked but never added', async () => {
    await contract(A, A.productId, '139.0000');
    await contract(A, salmonId, '89.0000');
    await tomatoAlert(A);
    const q = await caller(A).contracts.queue();
    expect(q.state).toBe('open');
    expect(q.totalOverAgorot).toBe(15_250);
    expect(q.lineCount).toBe(2);
    expect(q.alertCount).toBe(1);
    // Header = Σ of its visible billed cards (DoD-4).
    const billed = q.items.filter((i) => i.kind !== 'alert');
    expect(billed.reduce((s, i) => s + ('overAgorot' in i ? i.overAgorot : 0), 0)).toBe(q.totalOverAgorot);
    // Ranked by ₪: ₪100.00 > ₪52.50 > ≈₪38.00/month.
    expect(q.items.map((i) => (i.kind === 'alert' ? `alert:${i.impact.monthlyAgorot}` : `${i.kind}:${i.overAgorot}`))).toEqual([
      'offset:10000',
      'offset:5250',
      'alert:3800',
    ]);
    const entrecote = q.items[0]!;
    if (entrecote.kind === 'alert') throw new Error('expected a line');
    expect(entrecote).toMatchObject({ discrepancyId: A.discrepancyId, contractUnitPrice: 139, billedUnitPrice: 149, qty: 10, invoicePaid: false });
    const alert = q.items[2]!;
    if (alert.kind !== 'alert') throw new Error('expected an alert');
    expect(alert.impact).toMatchObject({ qty90: 100, monthlyAgorot: 3800, tone: 't4', median90: 7.3, contractUnitPrice: null });
    expect(q.dismissReasons).toBe(false);
  });

  it('the action follows the payment state: unpaid → offset, paid → claim (one channel per state)', async () => {
    await contract(A, salmonId, '89.0000');
    let q = await caller(A, 'bookkeeper').contracts.queue();
    expect(q.items.find((i) => i.kind !== 'alert' && i.invoiceLineId === salmonLineId)?.kind).toBe('offset');
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, salmonInvoiceId));
    q = await caller(A, 'bookkeeper').contracts.queue();
    expect(q.items.find((i) => i.kind !== 'alert' && i.invoiceLineId === salmonLineId)).toMatchObject({ kind: 'claim', invoicePaid: true });
    expect(overActionFor('d', 'approved')).toBe('offset');
    expect(overActionFor('d', 'paid')).toBe('claim');
    expect(overActionFor(null, 'paid')).toBe('request');
  });

  it("a line without an open discrepancy is kind 'request' (and a decided one too)", async () => {
    await contract(A, salmonId, '89.0000');
    await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.matchRunId, salmonRunId));
    const q = await caller(A).contracts.queue();
    const salmonCard = q.items.find((i) => i.kind !== 'alert' && i.invoiceLineId === salmonLineId);
    expect(salmonCard).toMatchObject({ kind: 'request', discrepancyId: null });
    // Still billed over contract: it stays in the header ₪.
    expect(q.totalOverAgorot).toBe(5_250);
  });

  it("no contracts → state 'no_contracts' (unknown, not clean, no ₪0 claim of cleanliness)", async () => {
    const q = await caller(A).contracts.queue();
    expect(q).toMatchObject({ state: 'no_contracts', totalOverAgorot: 0, lineCount: 0, items: [] });
  });

  it("contracts honoured on checked lines → 'clean'; a contract nobody invoiced against → 'unchecked'", async () => {
    await contract(A, A.productId, '149.0000');
    await contract(A, salmonId, '96.0000');
    expect((await caller(A).contracts.queue()).state).toBe('clean');
    await db.delete(supplierContractPrices);
    const [p] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, canonicalName: 'לא נקנה', defaultUnit: 'ק״ג' })
      .returning();
    await contract(A, p!.id, '10.0000');
    expect((await loadContractsQueue(db, A.restaurantId)).state).toBe('unchecked');
  });

  it('tenant B sees only its own queue; receiver and chef are FORBIDDEN', async () => {
    await contract(A, A.productId, '139.0000');
    const qb = await caller(B).contracts.queue();
    expect(qb.state).toBe('no_contracts');
    expect(qb.items).toEqual([]);
    await expect(caller(A, 'receiver').contracts.queue()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(A, 'chef').contracts.queue()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
