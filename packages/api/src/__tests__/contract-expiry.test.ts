import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, notificationsOutbox, restaurants, supplierContractPrices, testDbUrl, type RestaurantSettings } from '@restomatch/db';
import { addDays, contractsEnding, endingContractGroups } from '../priceAlerts/contractExpiry';
import { runPriceAlertSweep } from '../priceAlerts/sweep';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const r = (o: { productId?: string; supplierId?: string; validFrom?: string; validTo: string | null }) => ({
  supplierId: o.supplierId ?? 's',
  productId: o.productId ?? 'p',
  validFrom: o.validFrom ?? '2026-01-01',
  validTo: o.validTo,
});

describe('contract expiry (pure, Israel-day strings)', () => {
  const today = '2026-11-16';
  it('valid_to today + 14 → in; + 15 → out; today → in; yesterday → out; open-ended → out', () => {
    expect(addDays(today, 14)).toBe('2026-11-30');
    expect(endingContractGroups([r({ validTo: '2026-11-30' })], today)).toHaveLength(1);
    expect(endingContractGroups([r({ validTo: '2026-12-01' })], today)).toHaveLength(0);
    expect(endingContractGroups([r({ validTo: today })], today)).toHaveLength(1);
    expect(endingContractGroups([r({ validTo: '2026-11-15' })], today)).toHaveLength(0);
    expect(endingContractGroups([r({ validTo: null })], today)).toHaveLength(0);
  });
  it('a renewal row (starting after valid_to, or covering the next day) → out', () => {
    expect(endingContractGroups([r({ validTo: '2026-11-30' }), r({ validFrom: '2026-12-01', validTo: null })], today)).toHaveLength(0);
    expect(endingContractGroups([r({ validTo: '2026-11-30' }), r({ validFrom: '2027-01-15', validTo: '2027-12-31' })], today)).toHaveLength(0);
    expect(endingContractGroups([r({ validTo: '2026-11-30' }), r({ validFrom: '2026-11-20', validTo: '2027-06-30' })], today)).toHaveLength(0);
    // another product's renewal does not count
    expect(endingContractGroups([r({ validTo: '2026-11-30' }), r({ productId: 'q', validFrom: '2026-12-01', validTo: null })], today)).toHaveLength(1);
  });
  it('groups by (supplier, valid_to) with the product count', () => {
    const g = endingContractGroups([r({ productId: 'a', validTo: '2026-11-30' }), r({ productId: 'b', validTo: '2026-11-30' }), r({ supplierId: 't', validTo: '2026-11-30' })], today);
    expect(g.map((x) => [x.supplierId, x.productIds.length]).sort()).toEqual([['s', 2], ['t', 1]]);
  });
});

const db = createDb(testDbUrl());

/** The AU-13 mails only (the fixtures seed an unrelated outbox row). */
const digestMail = async (t: { restaurantId: string }) =>
  (await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, t.restaurantId))).filter((m) => m.dedupeKey?.startsWith('au:A18:'));
let A: Tenant;
let B: Tenant;
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db.update(restaurants).set({ settings: { features: { priceAlerts: true } } as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
  }
});
afterAll(async () => {
  await resetDb(db);
});

describe('contract expiry in the 07:00 mail', () => {
  it('announced once across two runs; a contract-only mail is still one mail; restaurant-scoped', async () => {
    await db.insert(supplierContractPrices).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, productId: A.productId, contractPrice: '6.0000', validFrom: '2026-01-01', validTo: '2026-11-30' });
    await db.insert(supplierContractPrices).values({ restaurantId: B.restaurantId, supplierId: B.supplierId, productId: B.productId, contractPrice: '6.0000', validFrom: '2026-01-01', validTo: '2026-11-30' });
    expect(await contractsEnding(db, A.restaurantId, '2026-11-16')).toEqual([
      { supplierId: A.supplierId, supplierName: A.supplierName, validTo: '2026-11-30', productCount: 1 },
    ]);
    const run = new Date('2026-11-16T05:00:00Z'); // 07:00 IST
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: run, notify: true, appBaseUrl: 'http://x' })).enqueued).toBe(1);
    const [mail] = await digestMail(A);
    expect(mail!.subject).toBe('חוזה מחירים מסתיים בקרוב');
    expect(mail!.body).toContain(`חוזה מחירים עם ${A.supplierName} מסתיים ב-30.11 · מוצר אחד`);
    expect(mail!.body).toContain('לחידוש');
    expect(await db.select().from(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'prices.contract_expiry_notified')))).toHaveLength(1);
    // next morning: already announced
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: new Date(run.getTime() + 86_400_000), notify: true })).enqueued).toBe(0);
    // B untouched by A's sweep
    expect(await digestMail(B)).toHaveLength(0);
  });

  it('Israel-day boundary: 23:59 IST on 15.11 is still 15.11 (30.11 is +15 → out); 00:00 IST on 16.11 → in', async () => {
    await db.insert(supplierContractPrices).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, productId: A.productId, contractPrice: '6.0000', validFrom: '2026-01-01', validTo: '2026-11-30' });
    const before = new Date('2026-11-15T21:59:00Z'); // 23:59 IST
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: before, notify: true })).enqueued).toBe(0);
    const after = new Date('2026-11-15T22:00:00Z'); // 00:00 IST 16.11 (UTC is still 15.11)
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: after, notify: true })).enqueued).toBe(1);
  });

  it('contractExpiry off → section omitted', async () => {
    await db.insert(supplierContractPrices).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, productId: A.productId, contractPrice: '6.0000', validFrom: '2026-01-01', validTo: '2026-11-30' });
    const off = { priceCreepDigest: true, contractExpiry: false, priceListDiff: true };
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: new Date('2026-11-16T05:00:00Z'), notify: true, digestOptions: off })).enqueued).toBe(0);
  });
});
