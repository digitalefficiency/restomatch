import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, restaurants, type RestaurantSettings } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W1-08 pilot: the credit-letter letterhead in restaurants.settings.letterhead
 * (no migration). Merge semantics, validation, roles, audit, tenant isolation.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const settingsOf = async (t: Tenant) =>
  (await db.select({ s: restaurants.settings }).from(restaurants).where(eq(restaurants.id, t.restaurantId)))[0]!.s as RestaurantSettings &
    Record<string, unknown> & { letterhead?: Record<string, string> };

describe('settings.updateLetterhead / settings.letterhead', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
  });
  afterAll(async () => {
    await resetDb(db);
  });
  beforeEach(async () => {
    await db.update(restaurants).set({ settings: {} });
  });

  it('MERGES: features, tolerances and other settings keys survive; untouched letterhead fields stay', async () => {
    const seeded = { features: { recovery: true }, tolerances: { pricePercent: 0.05 }, ocrReviewThreshold: 0.8 } as RestaurantSettings;
    await db.update(restaurants).set({ settings: seeded }).where(eq(restaurants.id, A.restaurantId));
    const c = callerFor(A);
    await c.settings.updateLetterhead({ legalName: 'כפר הזיתים בע״מ', businessId: '514778123' });
    const out = await c.settings.updateLetterhead({ phone: '04-8123456', email: 'office@kfar.co.il' });
    expect(out).toEqual({ legalName: 'כפר הזיתים בע״מ', businessId: '514778123', phone: '04-8123456', email: 'office@kfar.co.il' });
    const s = await settingsOf(A);
    expect(s.features).toEqual({ recovery: true });
    expect(s.tolerances).toEqual({ pricePercent: 0.05 });
    expect(s.ocrReviewThreshold).toBe(0.8);
    expect(await c.settings.letterhead()).toEqual(out);
  });

  it('an empty string clears one field, the rest stay', async () => {
    const c = callerFor(A);
    await c.settings.updateLetterhead({ legalName: 'X בע״מ', address: 'הנמל 1, חיפה' });
    expect(await c.settings.updateLetterhead({ address: '' })).toEqual({ legalName: 'X בע״מ' });
  });

  it('validates: ח״פ is 9 digits, an Israeli phone, a real email, no unknown keys', async () => {
    const c = callerFor(A);
    await expect(c.settings.updateLetterhead({ businessId: '12345' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(c.settings.updateLetterhead({ businessId: '51477812a' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(c.settings.updateLetterhead({ phone: '123' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(c.settings.updateLetterhead({ email: 'not-an-email' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(c.settings.updateLetterhead({ features: {} } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(c.settings.updateLetterhead({ legalName: 'a\u0007b' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await c.settings.updateLetterhead({ phone: '+972 52-123-4567', businessId: '514778123' })).toMatchObject({
      phone: '+972 52-123-4567',
    });
  });

  it('owner and manager may set it; bookkeeper reads only; receiver neither', async () => {
    await expect(callerFor(A, 'manager').settings.updateLetterhead({ legalName: 'M' })).resolves.toEqual({ legalName: 'M' });
    await expect(callerFor(A, 'bookkeeper').settings.updateLetterhead({ legalName: 'B' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await callerFor(A, 'bookkeeper').settings.letterhead()).toEqual({ legalName: 'M' });
    await expect(callerFor(A, 'receiver').settings.letterhead()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records an audit entry with before / after', async () => {
    const c = callerFor(A);
    await c.settings.updateLetterhead({ legalName: 'לפני' });
    await c.settings.updateLetterhead({ legalName: 'אחרי' });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'settings.letterhead_updated')));
    const last = rows.at(-1)!;
    expect(last.before).toEqual({ legalName: 'לפני' });
    expect(last.after).toEqual({ legalName: 'אחרי' });
  });

  it('cross-tenant: A writes and reads only A — B is untouched and never visible to A', async () => {
    await callerFor(B).settings.updateLetterhead({ legalName: 'B בע״מ', businessId: '511111111' });
    await callerFor(A).settings.updateLetterhead({ legalName: 'A בע״מ' });
    expect(await callerFor(A).settings.letterhead()).toEqual({ legalName: 'A בע״מ' });
    expect((await settingsOf(B)).letterhead).toEqual({ legalName: 'B בע״מ', businessId: '511111111' });
  });
});
