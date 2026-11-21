import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, inArray, restaurants } from '@restomatch/db';
import { normalizeIlPhone } from '../routers/settings';
import { DEFAULT_VAT_RATE, vatRateOf } from '../lib/vat';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const url = testDbUrl();
const db = createDb(url);

let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('settings router', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
  });
  afterAll(async () => {
    await resetDb(db);
  });
  beforeEach(async () => {
    // Reset both restaurants' settings to empty between cases.
    await db.update(restaurants).set({ settings: {} });
  });

  it('get returns the empty default before any update', async () => {
    const settings = await callerFor(A).settings.get();
    expect(settings).toEqual({});
  });

  it('update merges nested tolerances and approvalThresholds without blanking siblings', async () => {
    const caller = callerFor(A);
    await caller.settings.update({
      tolerances: { pricePercent: 0.05, priceAbsolute: 7 },
      approvalThresholds: { largeInvoiceWithoutPo: 8000 },
      ocrReviewThreshold: 0.9,
    });
    // Second update touches only one tolerance key — the others must survive.
    const out = await caller.settings.update({ tolerances: { qtyPercent: 0.06 } });
    expect(out.tolerances).toMatchObject({ pricePercent: 0.05, priceAbsolute: 7, qtyPercent: 0.06 });
    expect(out.approvalThresholds?.largeInvoiceWithoutPo).toBe(8000);
    expect(out.ocrReviewThreshold).toBe(0.9);
  });

  it('preserves unrelated settings keys (baselineWindowDays) on update', async () => {
    await db
      .update(restaurants)
      .set({ settings: { baselineWindowDays: 30 } })
      .where(eq(restaurants.id, A.restaurantId));
    const out = await callerFor(A).settings.update({ ocrReviewThreshold: 0.7 });
    expect(out.baselineWindowDays).toBe(30);
    expect(out.ocrReviewThreshold).toBe(0.7);
  });

  it('rejects an out-of-range fraction', async () => {
    await expect(
      callerFor(A).settings.update({ ocrReviewThreshold: 1.5 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('update is owner-only — a manager is FORBIDDEN', async () => {
    await expect(
      callerFor(A, 'manager').settings.update({ ocrReviewThreshold: 0.5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('get is allowed for a non-owner member (manager)', async () => {
    await expect(callerFor(A, 'manager').settings.get()).resolves.toBeDefined();
  });

  it('scopes writes to the caller restaurant', async () => {
    await callerFor(A).settings.update({ ocrReviewThreshold: 0.6 });
    const settingsB = await callerFor(B).settings.get();
    expect(settingsB.ocrReviewThreshold).toBeUndefined();
  });

  // ── W2-14: effective values, null-restore, audit ───────────────────────────
  it('effective shows the engine defaults (₪5,000 / ₪100) as isDefault on an empty blob', async () => {
    const eff = await callerFor(A, 'manager').settings.effective();
    expect(eff.approvalThresholds.largeInvoiceWithoutPo).toEqual({ value: 5000, isDefault: true });
    expect(eff.approvalThresholds.unorderedItemSignificant).toEqual({ value: 100, isDefault: true });
    expect(eff.approvalThresholds.cumulativeLargeAmount).toEqual({ value: 300, isDefault: true });
    expect(eff.ocrReviewThreshold).toEqual({ value: 0.85, isDefault: true });
    expect(eff.tolerances.pricePercent.isDefault).toBe(true);
  });

  it('effective marks an override as not default', async () => {
    await callerFor(A).settings.update({ approvalThresholds: { largeInvoiceWithoutPo: 8000 } });
    const eff = await callerFor(A).settings.effective();
    expect(eff.approvalThresholds.largeInvoiceWithoutPo).toEqual({ value: 8000, isDefault: false });
    expect(eff.approvalThresholds.unorderedItemSignificant.isDefault).toBe(true);
  });

  it('update with null removes the JSONB key (restores the default) and keeps the other keys', async () => {
    const caller = callerFor(A);
    await caller.settings.update({
      approvalThresholds: { largeInvoiceWithoutPo: 8000, unorderedItemSignificant: 250 },
      tolerances: { pricePercent: 0.04 },
      ocrReviewThreshold: 0.9,
    });
    await caller.settings.update({
      approvalThresholds: { largeInvoiceWithoutPo: null },
      ocrReviewThreshold: null,
    });
    const [row] = await db.select({ s: restaurants.settings }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    expect(row?.s.approvalThresholds).toEqual({ unorderedItemSignificant: 250 });
    expect('largeInvoiceWithoutPo' in (row?.s.approvalThresholds ?? {})).toBe(false);
    expect('ocrReviewThreshold' in (row?.s ?? {})).toBe(false);
    expect(row?.s.tolerances).toEqual({ pricePercent: 0.04 });
    const eff = await caller.settings.effective();
    expect(eff.approvalThresholds.largeInvoiceWithoutPo).toEqual({ value: 5000, isDefault: true });
  });

  it('update and updateProfile write audit rows with before/after; history lists them', async () => {
    await db.delete(auditLog).where(eq(auditLog.restaurantId, A.restaurantId));
    await callerFor(A).settings.update({ approvalThresholds: { largeInvoiceWithoutPo: 7000 } });
    await callerFor(A).settings.updateProfile({ vatRate: 0.18 });
    const rows = await db
      .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.restaurantId, A.restaurantId),
          inArray(auditLog.action, ['settings.updated', 'settings.profile_updated']),
        ),
      );
    const rules = rows.find((r) => r.action === 'settings.updated');
    expect(rules?.before).toMatchObject({ approvalThresholds: {} });
    expect(rules?.after).toMatchObject({ approvalThresholds: { largeInvoiceWithoutPo: 7000 } });
    const profile = rows.find((r) => r.action === 'settings.profile_updated');
    expect(profile?.after).toEqual({ vatRate: '0.1800' });
    expect(Object.keys(profile?.before as object)).toEqual(['vatRate']);

    const hist = await callerFor(A, 'bookkeeper').settings.history();
    expect(hist.map((h) => h.kind).sort()).toEqual(['profile', 'rules']);
    expect(hist[0]?.byName).toBe('Owner A');
  });

  it('normalizeIlPhone → E.164 (+972) and rejects junk', () => {
    expect(normalizeIlPhone('050-123 4567')).toBe('+972501234567');
    expect(normalizeIlPhone('+972 50 123 4567')).toBe('+972501234567');
    expect(normalizeIlPhone('00972-3-1234567')).toBe('+97231234567');
    expect(normalizeIlPhone('03-1234567')).toBe('+97231234567');
    expect(normalizeIlPhone('12345')).toBeNull();
    expect(normalizeIlPhone('+1 415 555 0100')).toBeNull();
  });

  // ── VAT fallback: 18% (Israel since 01.01.2025), never a stale 17% ─────────
  it('a missing vat_rate falls back to 0.18, never 0.17', () => {
    expect(DEFAULT_VAT_RATE).toBe(0.18);
    expect(vatRateOf(null)).toBe(0.18);
    expect(vatRateOf(undefined)).toBe(0.18);
    expect(vatRateOf('')).toBe(0.18);
    expect(vatRateOf('0.1800')).toBe(0.18);
  });

  it('profile returns 0.18 for a restaurant on the DB default', async () => {
    const [r] = await db.insert(restaurants).values({ name: 'VAT default' }).returning();
    const caller = appRouter.createCaller({
      db,
      session: { userId: A.ownerUserId, restaurantId: r!.id, role: 'owner' },
    } as AppContext);
    expect((await caller.settings.profile()).vatRate).toBe(0.18);
  });

  it('saving the profile without touching VAT never writes 0.17', async () => {
    await db.update(restaurants).set({ vatRate: '0.18' }).where(eq(restaurants.id, A.restaurantId));
    const out = await callerFor(A).settings.updateProfile({ name: 'Resto A', timezone: 'Asia/Jerusalem' });
    expect(out.vatRate).toBe(0.18);
    const [row] = await db.select({ v: restaurants.vatRate }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    expect(Number(row?.v)).toBe(0.18);
  });
});
