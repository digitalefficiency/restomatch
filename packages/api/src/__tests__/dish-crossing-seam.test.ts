import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  auditLog,
  createDb,
  eq,
  memberships,
  notificationsOutbox,
  priceHistory,
  products,
  restaurants,
  testDbUrl,
  users,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { startOfMonthInTz } from '../recipes/changes';
import { runPriceAlertSweep } from '../priceAlerts/sweep';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-13b — the dish section through the REAL seam: the 07:00 sweep reads W3-02's
 * `computeChanges` (recipes/changes.ts) with the restaurant's own target, so the
 * chef's mail names exactly the dishes `recipes.priceAlerts` shows in-app.
 *
 * `computeChanges` takes "this month" from the clock, so prices are seeded
 * around `startOfMonthInTz(new Date(), tz)` (as recipes-alerts.test does), and
 * the sweep runs at that same real instant.
 */
const db = createDb(testDbUrl());
const DAY = 86_400_000;
const TZ = 'Asia/Jerusalem';
let A: Tenant;
let B: Tenant;
let chefEmail: string;
const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const flags = { priceAlerts: true, recipes: true, dishPriceAlert: true };
const digest = async (t: Tenant) =>
  (await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, t.restaurantId))).filter((m) =>
    m.dedupeKey?.startsWith('au:A18:'),
  );
const P = (s: string | null) => (s ?? '').replace(/[⁦-⁩]/g, '');

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'AD');
  B = await seedTenant(db, 'BD');
  const monthStart = startOfMonthInTz(new Date(), TZ);
  for (const t of [A, B]) {
    const [p] = await db.insert(products).values({ restaurantId: t.restaurantId, canonicalName: 'אנטריקוט', defaultUnit: 'ק״ג' }).returning();
    // ₪139/kg before this month; ₪149/kg this month at A's supplier only (B's price never moved).
    await db.insert(priceHistory).values([
      { restaurantId: t.restaurantId, productId: p!.id, supplierId: t.supplierId, observedAt: new Date(monthStart.getTime() - 5 * DAY), unitPrice: '139.0000' },
      ...(t === A ? [{ restaurantId: t.restaurantId, productId: p!.id, supplierId: t.supplierId, observedAt: new Date(monthStart.getTime() + 60_000), unitPrice: '149.0000' }] : []),
    ]);
    await db.update(restaurants).set({ settings: { features: flags } as unknown as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
    // 28.1% → 30.1% against the default 30% target (same dish as recipes-alerts.test).
    await caller(t).recipes.save({ name: 'סטייק', menuPriceAgorot: 19900, items: [{ productId: p!.id, quantity: '300', unit: 'גרם', wastePct: 12 }] });
  }
  const [chef] = await db.insert(users).values({ email: `chef-AD-${Date.now()}@seam.test` }).returning();
  await db.insert(memberships).values({ userId: chef!.id, restaurantId: A.restaurantId, role: 'chef' });
  chefEmail = chef!.email!;
});

afterAll(async () => {
  await resetDb(db);
});

describe('AU-13b dish section via recipes/changes.ts computeChanges', () => {
  it('the chef gets a dish-only mail naming what recipes.priceAlerts shows; the owner gets it as a section; once per month; B gets nothing', async () => {
    const inApp = await caller(A).recipes.priceAlerts();
    expect(inApp.enabled).toBe(true);
    expect(inApp.alerts.map((a) => a.name)).toEqual(['סטייק']);

    const now = new Date();
    const r1 = await runPriceAlertSweep(db, A.restaurantId, { now, notify: true });
    expect(r1.enqueued).toBe(2);
    const mail = await digest(A);
    const chefMail = mail.find((m) => m.target === chefEmail)!;
    const ownerMail = mail.find((m) => m.target === 'owner-AD@attack.test')!;
    expect(P(chefMail.body)).toContain('סטייק 30% (יעד 30%)');
    expect(P(chefMail.body)).toContain('אנטריקוט +7%');
    expect(P(chefMail.body)).not.toContain('מחירים שעלו');
    expect(P(ownerMail.body)).toContain('מנות שעברו את יעד עלות המזון');
    expect(P(ownerMail.body)).toContain('סטייק 30% (יעד 30%)');

    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'prices.dish_crossing_notified')));
    expect(audit).toHaveLength(1);
    expect(await runPriceAlertSweep(db, A.restaurantId, { now: new Date(now.getTime() + 60_000), notify: true })).toMatchObject({ enqueued: 0 });

    expect((await runPriceAlertSweep(db, B.restaurantId, { now, notify: true })).enqueued).toBe(0);
    expect(await digest(B)).toHaveLength(0);
  });

  it('the restaurant target from settings.recipes.targetFoodCostBp is the one used (31% target → nothing crossed, no mail)', async () => {
    const C = await seedTenant(db, 'CD');
    const monthStart = startOfMonthInTz(new Date(), TZ);
    const [p] = await db.insert(products).values({ restaurantId: C.restaurantId, canonicalName: 'אנטריקוט', defaultUnit: 'ק״ג' }).returning();
    await db.insert(priceHistory).values([
      { restaurantId: C.restaurantId, productId: p!.id, supplierId: C.supplierId, observedAt: new Date(monthStart.getTime() - 5 * DAY), unitPrice: '139.0000' },
      { restaurantId: C.restaurantId, productId: p!.id, supplierId: C.supplierId, observedAt: new Date(monthStart.getTime() + 60_000), unitPrice: '149.0000' },
    ]);
    await db
      .update(restaurants)
      .set({ settings: { features: flags, recipes: { targetFoodCostBp: 3100 } } as unknown as RestaurantSettings })
      .where(eq(restaurants.id, C.restaurantId));
    await caller(C).recipes.save({ name: 'סטייק', menuPriceAgorot: 19900, items: [{ productId: p!.id, quantity: '300', unit: 'גרם', wastePct: 12 }] });
    expect((await caller(C).recipes.priceAlerts()).alerts).toEqual([]);
    expect((await runPriceAlertSweep(db, C.restaurantId, { now: new Date(), notify: true })).enqueued).toBe(0);
    expect(await digest(C)).toHaveLength(0);
  });
});
