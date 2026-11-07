import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  auditLog,
  createDb,
  eq,
  memberships,
  notificationsOutbox,
  priceAlerts,
  priceHistory,
  restaurants,
  testDbUrl,
  users,
  type RestaurantSettings,
} from '@restomatch/db';
import { buildChefDigest, buildOwnerDigest, rankCreep, type CreepLine, type DishLine } from '../priceAlerts/digest';
import { mailMoney } from '../priceAlerts/money';
import { runPriceAlertSweep } from '../priceAlerts/sweep';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** Compare text with the bidi isolates (U+2066–U+2069) removed. */
const P = (s: string | null): string => (s ?? '').replace(/[\u2066-\u2069]/g, '');
const M = (agorot: number, l: 'he' | 'en', d: 0 | 2) => P(mailMoney(agorot, l, d));

/* ───────────────────────── pure builder ───────────────────────── */

const line = (o: Partial<CreepLine>): CreepLine => ({
  alertId: 'a',
  productName: 'עגבניות',
  supplierName: 'תנובה',
  pctChange: 0.12,
  windowDays: 21,
  startPrice: 6.2,
  endPrice: 6.94,
  cheaperSupplierName: null,
  cheaperPrice: null,
  monthlyAgorot: 21_200,
  tone: 't2',
  ...o,
});
const empty = { contracts: [], dishes: [], listDiffs: [], links: {} };
const dish: DishLine = {
  recipeId: 'r1',
  name: 'שניצל',
  afterFoodCostBp: 3100,
  targetBp: 2800,
  costDeltaAgorot: 140,
  productName: 'חזה עוף',
  productChangeBp: 1200,
  supplierName: 'טיב טעם',
};

describe('AU-13 digest builder (pure)', () => {
  it('ranks by ≈₪/month; an unknown estimate ranks last and reads "אין מספיק נתונים", never ₪0', () => {
    const lines = [
      line({ alertId: 'unknown', productName: 'א', monthlyAgorot: null, pctChange: 0.5, tone: 't4' }),
      line({ alertId: 'small', productName: 'ב', monthlyAgorot: 4_000, tone: 't4' }),
      line({ alertId: 'big', productName: 'ג', monthlyAgorot: 21_200 }),
    ];
    expect(rankCreep(lines).map((l) => l.alertId)).toEqual(['big', 'small', 'unknown']);
    const mail = buildOwnerDigest({ locale: 'he', creep: lines, ...empty })!;
    expect(mail.alertIds).toEqual(['big', 'small', 'unknown']);
    const unknownLine = P(mail.text).split('\n').find((l) => l.includes('- א'))!;
    expect(unknownLine).toContain('אין מספיק נתונים');
    expect(unknownLine).not.toContain(M(0, 'he', 0));
    expect(P(mail.text).indexOf('- ג')).toBeLessThan(P(mail.text).indexOf('- ב'));
    expect(P(mail.text).indexOf('- ב')).toBeLessThan(P(mail.text).indexOf('- א'));
  });

  it('subject: count + Σ known ≈₪/month (estimate); the line format of the brief', () => {
    const mail = buildOwnerDigest({
      locale: 'he',
      creep: [line({ alertId: '1', monthlyAgorot: 21_200 }), line({ alertId: '2', productName: 'חלב', monthlyAgorot: 30_000 }), line({ alertId: '3', productName: 'שמן', monthlyAgorot: 12_800 })],
      ...empty,
    })!;
    expect(P(mail.subject)).toBe(`מחירים שעלו: 3 מוצרים · ≈${M(64_000, 'he', 0)} בחודש (הערכה)`);
    expect(mail.creepMonthlyAgorot).toBe(64_000);
    expect(P(mail.text)).toContain(
      `עגבניות · תנובה · +12% ב-3 שבועות · מ-${M(620, 'he', 2)} ל-${M(694, 'he', 2)} ליחידה · ≈${M(21_200, 'he', 0)} בחודש (הערכה)`,
    );
  });

  it('top 5 plus "ועוד N"; the cheaper offer when known', () => {
    const lines = Array.from({ length: 9 }, (_, i) =>
      line({ alertId: `a${i}`, productName: `מוצר ${i}`, monthlyAgorot: 1000 * (i + 1), cheaperSupplierName: i === 8 ? 'ספק זול' : null, cheaperPrice: i === 8 ? 6.1 : null }),
    );
    const mail = buildOwnerDigest({ locale: 'he', creep: lines, ...empty })!;
    expect(mail.text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5);
    expect(P(mail.text)).toContain('ועוד 4');
    expect(P(mail.text)).toContain(`אותו מוצר אצל ספק זול: ${M(610, 'he', 2)} ליחידה`);
    expect(mail.alertIds).toHaveLength(9);
  });

  it('T2 lines carry the act-now badge; T4 lines stay neutral (tone comes from W2-12, never recomputed here)', () => {
    const mail = buildOwnerDigest({ locale: 'he', creep: [line({ alertId: 'x', tone: 't2' }), line({ alertId: 'y', productName: 'חלב', tone: 't4', monthlyAgorot: 4_999 })], ...empty })!;
    expect(P(mail.text)).toContain('- [לטיפול עכשיו] עגבניות');
    expect(P(mail.text)).toContain('- חלב');
    expect(mail.text.match(/לטיפול עכשיו/g)).toHaveLength(1);
  });

  it('LIGHT template: he rtl, en ltr, light canvas, no dark #0b1220; no leak words', () => {
    const he = buildOwnerDigest({ locale: 'he', creep: [line({})], ...empty, dishes: [dish] })!;
    const en = buildOwnerDigest({ locale: 'en', creep: [line({})], ...empty, dishes: [dish] })!;
    expect(he.html).toContain('lang="he" dir="rtl"');
    expect(en.html).toContain('lang="en" dir="ltr"');
    expect(he.html).toContain('#F6F8F7');
    expect(he.html.toLowerCase()).not.toContain('#0b1220');
    for (const m of [he, en]) {
      for (const s of [m.subject, m.text, m.html]) {
        expect(s).not.toMatch(/דליפה|פער|1\.5%|leak/i);
        if (m === he) expect(s).not.toMatch(/₪\s?\d/); // he: ₪ only through the shared formatter (it suffixes)
      }
    }
    expect(P(en.subject)).toBe(`Prices that went up: עגבניות +12% · ≈${M(21_200, 'en', 0)}/month (estimate)`);
    expect(he.text).toMatchSnapshot('he');
    expect(en.text).toMatchSnapshot('en');
  });

  it('the chef payload holds ONLY the dish section — no supplier price-creep line', () => {
    const chef = buildChefDigest({ locale: 'he', dishes: [dish], links: { recipe: (id) => `http://x/r/${id}` } })!;
    expect(P(chef.text)).toContain(`שניצל 31% (יעד 28%) · ${M(140, 'he', 2)} יותר למנה · חזה עוף +12% אצל טיב טעם`);
    expect(P(chef.text)).toContain('למתכון: http://x/r/r1');
    expect(P(chef.text)).not.toContain('מחירים שעלו');
    expect(chef.alertIds).toEqual([]);
    expect(buildChefDigest({ locale: 'he', dishes: [], links: {} })).toBeNull();
  });

  it('nothing to say → no mail (never "אין התראות היום")', () => {
    expect(buildOwnerDigest({ locale: 'he', creep: [], ...empty })).toBeNull();
  });

  it('no Intl.NumberFormat / toLocaleString anywhere in priceAlerts/** (₪ through the one formatter)', () => {
    const dir = join(__dirname, '..', 'priceAlerts');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/Intl\.NumberFormat|toLocaleString/);
    }
  });
});

/* ───────────────────────── the 07:00 sweep ───────────────────────── */

const db = createDb(testDbUrl());

/** The AU-13 mails only (the fixtures seed an unrelated outbox row). */
const digestMail = async (t: { restaurantId: string }) =>
  (await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, t.restaurantId))).filter((m) => m.dedupeKey?.startsWith('au:A18:'));
let A: Tenant;
const now = new Date('2026-10-18T04:00:00Z'); // 07:00 IDT

async function setFeatures(t: Tenant, features: Record<string, boolean>) {
  await db.update(restaurants).set({ settings: { features } as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
}
async function member(t: Tenant, role: 'manager' | 'chef' | 'receiver' | 'bookkeeper') {
  const [u] = await db.insert(users).values({ email: `${role}-${t.restaurantId.slice(0, 8)}@digest.test` }).returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: t.restaurantId, role });
  return u!;
}
async function seedTrend(t: Tenant, productId: string, prices: number[]) {
  const days = [20, 16, 8, 4, 1];
  for (let i = 0; i < prices.length; i++) {
    await db.insert(priceHistory).values({
      restaurantId: t.restaurantId,
      productId,
      supplierId: t.supplierId,
      observedAt: new Date(now.getTime() - days[i]! * 86_400_000),
      unitPrice: prices[i]!.toFixed(4),
    });
  }
}

beforeAll(async () => {
  await resetDb(db);
});
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  await setFeatures(A, { priceAlerts: true });
});
afterAll(async () => {
  await resetDb(db);
});

describe('AU-13 sweep: one morning mail per person', () => {
  it('several alerts → ONE mail per owner/manager; none for chef, receiver or bookkeeper; reruns send nothing', async () => {
    const { products } = await import('@restomatch/db');
    const [p2] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'חלב', defaultUnit: 'ל' }).returning();
    await seedTrend(A, A.productId, [6.2, 6.2, 7.3, 7.32, 7.34]);
    await seedTrend(A, p2!.id, [5, 5, 6, 6, 6]);
    const mgr = await member(A, 'manager');
    for (const role of ['chef', 'receiver', 'bookkeeper'] as const) await member(A, role);

    const r1 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true, appBaseUrl: 'http://x' });
    expect(r1).toEqual({ skipped: false, created: 2, enqueued: 2 });
    const mail = await digestMail(A);
    expect(mail.map((m) => m.target).sort()).toEqual([`owner-A@attack.test`, mgr.email].sort());
    expect(new Set(mail.map((m) => m.dedupeKey))).toEqual(
      new Set([`au:A18:${A.restaurantId}:${A.ownerUserId}:2026-10-18`, `au:A18:${A.restaurantId}:${mgr.id}:2026-10-18`]),
    );
    expect(P(mail[0]!.subject)).toBe('מחירים שעלו: 2 מוצרים');
    expect(P(mail[0]!.body)).toContain('אין מספיק נתונים');
    expect(P(mail[0]!.body)).toContain(`http://x/dashboard/go?r=${A.restaurantId}&to=${encodeURIComponent('/dashboard/contracts?tab=queue')}`);
    expect(mail[0]!.payload).toMatchObject({ kpi: 'A18' });

    const alerts = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    expect(alerts.every((a) => a.notifiedAt?.getTime() === now.getTime())).toBe(true);

    expect(await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).toEqual({ skipped: false, created: 0, enqueued: 0 });
    const later = new Date(now.getTime() + 86_400_000);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: later, notify: true })).enqueued).toBe(0);
    expect(await digestMail(A)).toHaveLength(2);
  });

  it('a same-day rerun after the mail went leaves a NEW alert un-notified for tomorrow (never swallowed)', async () => {
    await seedTrend(A, A.productId, [6.2, 6.2, 7.3, 7.32, 7.34]);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).enqueued).toBe(1);
    const { products } = await import('@restomatch/db');
    const [p2] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'חלב', defaultUnit: 'ל' }).returning();
    await seedTrend(A, p2!.id, [5, 5, 6, 6, 6]);
    expect(await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).toMatchObject({ created: 1, enqueued: 0 });
    const [fresh] = await db.select().from(priceAlerts).where(and(eq(priceAlerts.restaurantId, A.restaurantId), eq(priceAlerts.productId, p2!.id)));
    expect(fresh!.notifiedAt).toBeNull();
    const tomorrow = new Date(now.getTime() + 86_400_000);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: tomorrow, notify: true })).enqueued).toBe(1);
  });

  it('flag off → nothing; priceCreepDigest off → alerts stay in-app only (no per-alert mails come back)', async () => {
    await seedTrend(A, A.productId, [6.2, 6.2, 7.3, 7.32, 7.34]);
    await setFeatures(A, {});
    expect(await runPriceAlertSweep(db, A.restaurantId, { now, notify: true })).toEqual({ skipped: true, created: 0, enqueued: 0 });
    await setFeatures(A, { priceAlerts: true });
    const off = { priceCreepDigest: false, contractExpiry: true, priceListDiff: true };
    expect(await runPriceAlertSweep(db, A.restaurantId, { now, notify: true, digestOptions: off })).toEqual({ skipped: false, created: 1, enqueued: 0 });
    const [al] = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    expect(al!.notifiedAt).toBeNull();
    expect(await digestMail(A)).toHaveLength(0);
  });

  it('dish section (seam injected): chef gets ONLY dishes; owner gets it as a section; once per dish per month; flag off → no chef mail', async () => {
    await setFeatures(A, { priceAlerts: true, recipes: true, dishPriceAlert: true });
    const chef = await member(A, 'chef');
    await member(A, 'receiver');
    await member(A, 'bookkeeper');
    const source = async () => ({
      targetBp: 2800,
      rows: [
        {
          recipeId: '00000000-0000-4000-8000-000000000001',
          name: 'שניצל',
          nameEn: null,
          isSubRecipe: false,
          active: true,
          beforeFoodCostBp: 2700,
          afterFoodCostBp: 3100,
          costDeltaAgorot: 140,
          riser: { name: 'חזה עוף', nameEn: null, unit: 'ק״ג', deltaAgorot: 140, priceBefore: '30.0000', priceNow: '33.6000', supplier: { id: A.supplierId, name: 'טיב טעם', nameEn: null } },
        },
      ],
    });
    const r1 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true, dishChanges: source });
    expect(r1.enqueued).toBe(2);
    const mail = await digestMail(A);
    const chefMail = mail.find((m) => m.target === chef.email)!;
    const ownerMail = mail.find((m) => m.target === 'owner-A@attack.test')!;
    expect(P(chefMail.body)).toContain('שניצל 31% (יעד 28%)');
    expect(P(chefMail.body)).not.toContain('מחירים שעלו');
    expect(P(ownerMail.body)).toContain('מנות שעברו את יעד עלות המזון');
    expect(mail.map((m) => m.target)).toHaveLength(2); // receiver + bookkeeper: zero rows
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'prices.dish_crossing_notified')));
    expect(audit).toHaveLength(1);
    const nextDay = new Date(now.getTime() + 86_400_000);
    expect((await runPriceAlertSweep(db, A.restaurantId, { now: nextDay, notify: true, dishChanges: source })).enqueued).toBe(0);

    await resetDb(db);
    A = await seedTenant(db, 'A');
    await member(A, 'chef');
    await setFeatures(A, { priceAlerts: true, recipes: true, dishPriceAlert: false });
    expect((await runPriceAlertSweep(db, A.restaurantId, { now, notify: true, dishChanges: source })).enqueued).toBe(0);
  });
});
