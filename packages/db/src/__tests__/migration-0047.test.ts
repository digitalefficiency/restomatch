import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, priceAlertThresholds, priceAlerts, products, restaurants, suppliers } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0047_price_alerts: thresholds (range CHECKs, one rule
 * per scope incl. NULL scopes) and alerts (dedupe key, status CHECK,
 * same-tenant FKs, cheaper_supplier SET NULL on delete).
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let r1: string;
let r2: string;
let s1: string;
let s1b: string;
let s2: string;
let p1: string;

beforeAll(async () => {
  r1 = (await db.insert(restaurants).values({ name: '0047 A', businessId: '000000471' }).returning())[0]!.id;
  r2 = (await db.insert(restaurants).values({ name: '0047 B', businessId: '000000472' }).returning())[0]!.id;
  s1 = (await db.insert(suppliers).values({ restaurantId: r1, name: 'S1' }).returning())[0]!.id;
  s1b = (await db.insert(suppliers).values({ restaurantId: r1, name: 'S1b' }).returning())[0]!.id;
  s2 = (await db.insert(suppliers).values({ restaurantId: r2, name: 'S2' }).returning())[0]!.id;
  p1 = (await db.insert(products).values({ restaurantId: r1, canonicalName: 'P1' }).returning())[0]!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, r1));
  await db.delete(restaurants).where(eq(restaurants.id, r2));
  await sql.end();
});

const alert = (o: Partial<typeof priceAlerts.$inferInsert> = {}) => ({
  restaurantId: r1,
  productId: p1,
  supplierId: s1,
  windowDays: 21,
  thresholdPct: '0.1000',
  startPrice: '6',
  endPrice: '7',
  pctChange: '0.1667',
  startAt: new Date('2026-09-27'),
  endAt: new Date('2026-10-17'),
  observations: 4,
  dedupeKey: 'k1',
  ...o,
});

describe('0047 migration shape', () => {
  it('threshold CHECKs (0 < pct ≤ 5, 7 ≤ window ≤ 120)', async () => {
    await expect(db.insert(priceAlertThresholds).values({ restaurantId: r1, thresholdPct: '0' })).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(priceAlertThresholds).values({ restaurantId: r1, thresholdPct: '0.1', windowDays: 3 }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('one rule per scope, NULL scopes included', async () => {
    await db.insert(priceAlertThresholds).values({ restaurantId: r1, thresholdPct: '0.1' });
    await expect(db.insert(priceAlertThresholds).values({ restaurantId: r1, thresholdPct: '0.2' })).rejects.toMatchObject({ code: '23505' });
    await db.insert(priceAlertThresholds).values({ restaurantId: r1, supplierId: s1, thresholdPct: '0.2' });
    await db.insert(priceAlertThresholds).values({ restaurantId: r1, category: 'ירקות', thresholdPct: '0.2' });
    await expect(
      db.insert(priceAlertThresholds).values({ restaurantId: r1, supplierId: s2, thresholdPct: '0.2' }),
    ).rejects.toMatchObject({ code: '23503' });
    await db.delete(priceAlertThresholds).where(eq(priceAlertThresholds.restaurantId, r1));
  });

  it('alerts: dedupe per restaurant, status CHECK, cheaper supplier SET NULL', async () => {
    const [a] = await db.insert(priceAlerts).values(alert({ cheaperSupplierId: s1b, cheaperPrice: '5.5' })).returning();
    await expect(db.insert(priceAlerts).values(alert())).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(priceAlerts).values(alert({ dedupeKey: 'k2', status: 'nope' as 'open' })),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(db.insert(priceAlerts).values(alert({ dedupeKey: 'k3', supplierId: s2 }))).rejects.toMatchObject({ code: '23503' });
    await db.delete(suppliers).where(eq(suppliers.id, s1b));
    const [after] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, a!.id));
    expect(after).toMatchObject({ cheaperSupplierId: null, restaurantId: r1, supplierId: s1 });
  });
});
