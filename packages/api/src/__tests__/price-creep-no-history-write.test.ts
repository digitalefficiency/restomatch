import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, count, createDb, eq, notificationsOutbox, priceBaselines, priceHistory, restaurants, testDbUrl, type RestaurantSettings } from '@restomatch/db';
import { listDiffSection } from '../priceAlerts/priceListDiff';
import { digestOptions } from '../priceAlerts/options';
import { mailMoney } from '../priceAlerts/money';
import { runPriceAlertSweep } from '../priceAlerts/sweep';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** Compare text with the bidi isolates (U+2066–U+2069) removed. */
const P = (s: string | null): string => (s ?? '').replace(/[\u2066-\u2069]/g, '');
const M = (agorot: number, l: 'he' | 'en', d: 0 | 2) => P(mailMoney(agorot, l, d));

/**
 * AD11: a supplier price list never feeds `price_history` / baselines. The
 * AU-13 sweep READS the import's diff record and writes only the outbox and
 * its own audit "once" rows.
 */
describe('price-list diff section (pure)', () => {
  it('rises only, mean %, top 5 by %, no ₪/month', () => {
    const s = listDiffSection({
      importId: 'i1',
      supplierName: 'תנובה',
      importedOn: '2026-11-12',
      changes: [
        { name: 'חלב', oldListPrice: '5.90', newListPrice: '6.08' },
        { name: 'גבינה', oldListPrice: 10, newListPrice: 11 },
        { name: 'שמנת', oldListPrice: 8, newListPrice: 7 }, // a drop: not a rise
        { name: 'חדש', oldListPrice: null, newListPrice: 4 }, // new item: no old price
      ],
    })!;
    expect(s.risesCount).toBe(2);
    expect(s.top.map((t) => [t.name, t.changeBp])).toEqual([['גבינה', 1000], ['חלב', 305]]);
    expect(s.avgRiseBp).toBe(653);
    expect(listDiffSection({ importId: 'x', supplierName: 'y', importedOn: '2026-11-12', changes: [{ name: 'a', oldListPrice: 5, newListPrice: 4 }] })).toBeNull();
  });
});

const db = createDb(testDbUrl());

/** The AU-13 mails only (the fixtures seed an unrelated outbox row). */
const digestMail = async (t: { restaurantId: string }) =>
  (await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, t.restaurantId))).filter((m) => m.dedupeKey?.startsWith('au:A18:'));
let A: Tenant;
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  await db.update(restaurants).set({ settings: { features: { priceAlerts: true } } as RestaurantSettings }).where(eq(restaurants.id, A.restaurantId));
});
afterAll(async () => {
  await resetDb(db);
});

describe('a full sweep with an import diff record', () => {
  it('mails the section once per import and writes no price_history / price_baselines row', async () => {
    const now = new Date('2026-11-13T05:00:00Z');
    await db.insert(auditLog).values({
      restaurantId: A.restaurantId,
      action: 'catalog.import_committed',
      entityType: 'catalog_import',
      entityId: null,
      at: new Date('2026-11-12T10:00:00Z'),
      after: { supplierId: A.supplierId, priceChanges: [{ name: 'חלב', sku: '1', oldListPrice: '5.90', newListPrice: '6.08', unit: 'ל' }] } as never,
    });
    const rows = async () => ({
      history: (await db.select({ n: count() }).from(priceHistory))[0]!.n,
      baselines: (await db.select({ n: count() }).from(priceBaselines))[0]!.n,
    });
    // priceListDiff defaults OFF (new behaviour, waits on the catalog record): default → no mail.
    expect(digestOptions({} as RestaurantSettings).priceListDiff).toBe(false);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).enqueued).toBe(0);
    await db
      .update(restaurants)
      .set({ settings: { features: { priceAlerts: true }, automations: { priceListDiff: true } } as RestaurantSettings })
      .where(eq(restaurants.id, A.restaurantId));
    const before = await rows();
    expect((await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).enqueued).toBe(1);
    expect(await rows()).toEqual(before);
    const [mail] = await digestMail(A);
    expect(P(mail!.subject)).toBe(`מחירון חדש מ${A.supplierName}`);
    expect(P(mail!.body)).toContain(`מחירון חדש מ${A.supplierName} (12.11): מחיר אחד עלה · ממוצע +3% · הגבוהים: חלב 3% ${M(590, 'he', 2)} → ${M(608, 'he', 2)}`);
    expect(P(mail!.body)).not.toMatch(/בחודש/);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: new Date(now.getTime() + 86_400_000), notify: true })).enqueued).toBe(0);
    const off = { priceCreepDigest: true, contractExpiry: true, priceListDiff: false };
    expect((await runPriceAlertSweep(db, A.restaurantId, { now, notify: true, digestOptions: off })).enqueued).toBe(0);
  });
});
