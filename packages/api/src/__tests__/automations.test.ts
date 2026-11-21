import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  auditLog,
  createDb,
  eq,
  notificationsOutbox,
  restaurants,
  testDbUrl,
  userCredentials,
  invoices,
  users,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import { restaurantDateKey } from './helpers/il-day';
import type { AppContext, Session } from '../context';
import { FEATURE_KEYS, OWNER_TOGGLEABLE, featureEnabled } from '../lib/features';
import { AUTOMATIONS, AUTOMATION_OPTION_KEYS } from '../automations/registry';
import { automationOption } from '../automations/options';
import { israelWeekStart, listAutomations } from '../routers/automations';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-01 · automations registry, option reader and router (owner connection).
 * The router is mounted locally until its appRouter line is registered
 * (orchestrator-serialised); the RLS-enforced checks live in
 * automations.attack.test.ts.
 */

const db = createDb(testDbUrl());
// Registered in appRouter (orchestrator-granted); owner.vatAtRisk is needed for the AD1 gate test.
const testRouter = appRouter;

let A: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return testRouter.createCaller(ctx);
}

async function settingsOf(t: Tenant) {
  const [r] = await db.select({ s: restaurants.settings }).from(restaurants).where(eq(restaurants.id, t.restaurantId));
  return r?.s as Record<string, unknown>;
}

async function auditRows(t: Tenant) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, t.restaurantId), eq(auditLog.action, 'automations.toggled')));
}

async function outboxCount(t: Tenant) {
  return (await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, t.restaurantId))).length;
}

async function outbox(t: Tenant, rows: Array<{ dedupeKey?: string | null; createdAt: string; type?: string; entity?: string }>) {
  for (const r of rows) {
    await db.insert(notificationsOutbox).values({
      restaurantId: t.restaurantId,
      channel: 'email',
      target: `x${randomUUID()}@t.test`,
      body: 'b',
      dedupeKey: r.dedupeKey ?? null,
      createdAt: new Date(r.createdAt),
      relatedEntityType: r.type ?? null,
      relatedEntityId: r.entity ?? null,
    });
  }
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'AutoA');
});
afterAll(async () => {
  await resetDb(db);
});
beforeEach(async () => {
  await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, A.restaurantId));
});
afterEach(() => {
  delete process.env.FEATURES_OFF;
});

describe('registry (pure)', () => {
  it('has unique ids and keys and lists every brief row', () => {
    expect(new Set(AUTOMATIONS.map((a) => a.id)).size).toBe(AUTOMATIONS.length);
    expect(new Set(AUTOMATIONS.map((a) => a.key)).size).toBe(AUTOMATIONS.length);
    expect(AUTOMATIONS.map((a) => a.key)).toEqual(
      expect.arrayContaining([
        'priceAlerts',
        'recovery',
        'monthlyReport',
        'vatAtRisk',
        'orderReminders',
        'supplierDelays',
        'eveningDigest',
        'matchAlerts',
        'recoveryBookkeeper',
        'chaseAcknowledged',
        'orderCapture',
        'priceCreepDigest',
        'contractExpiry',
        'priceListDiff',
      ]),
    );
  });

  it('every flag control is a FeatureKey and every option control is an option key', () => {
    for (const a of AUTOMATIONS) {
      if (a.control.kind === 'flag') expect(FEATURE_KEYS).toContain(a.control.flag);
      if (a.control.kind === 'option') expect(AUTOMATION_OPTION_KEYS).toContain(a.control.option);
    }
  });

  it('every OWNER_TOGGLEABLE key is a FeatureKey; payRun / ingestWhatsapp / aiAssistant / chain are not on it', () => {
    for (const k of OWNER_TOGGLEABLE) expect(FEATURE_KEYS).toContain(k);
    for (const k of ['payRun', 'ingestWhatsapp', 'aiAssistant', 'chain']) {
      expect(OWNER_TOGGLEABLE as ReadonlyArray<string>).not.toContain(k);
    }
  });

  it('no receiver row carries ₪; chef rows only on orders (A5 reaches the chef)', () => {
    expect(AUTOMATIONS.find((a) => a.key === 'orderReminders')!.audience).toContain('chef');
    for (const a of AUTOMATIONS) {
      if (a.audience.includes('receiver')) expect(a.carriesIls).toBe(false);
      if (a.audience.includes('chef')) expect(a.key).toMatch(/^order/);
    }
  });

  it('Train C (C3): the registry only offers switches a job honours', () => {
    // receiverBrief has no sender yet → no row; its option key stays readable.
    expect(AUTOMATIONS.map((a) => a.key)).not.toContain('receiverBrief');
    expect(automationOption({}, 'receiverBrief')).toBe(true);
    // endOfDayReport / supplierDelays do not read their option yet → "always", no switch.
    for (const k of ['eveningDigest', 'supplierDelays']) {
      expect(AUTOMATIONS.find((a) => a.key === k)!.control).toEqual({ kind: 'always' });
    }
    // orderReminders honours its option (briefOptionOn) and dedupes on au:A5:.
    const a5 = AUTOMATIONS.find((a) => a.key === 'orderReminders')!;
    expect(a5.control).toMatchObject({ kind: 'option', option: 'orderReminders' });
    expect(a5.outboxMatch).toEqual({ kind: 'prefix', prefix: 'au:A5:' });
  });

  it('chaseAcknowledged and recoveryBookkeeper default on (AD5, AD6)', () => {
    const chase = AUTOMATIONS.find((a) => a.key === 'chaseAcknowledged')!;
    expect(chase.control).toEqual({ kind: 'option', option: 'chaseAcknowledged', default: true });
    expect(chase.audience).toEqual(['owner', 'manager', 'bookkeeper']);
    expect(chase.slot).toBe('08:30');
    expect(AUTOMATIONS.find((a) => a.key === 'recoveryBookkeeper')!.control).toMatchObject({ default: true });
  });
});

describe('automationOption', () => {
  it('falls back to the registry default and honours an explicit value', () => {
    expect(automationOption({}, 'eveningDigest')).toBe(true);
    expect(automationOption(null, 'orderReminders')).toBe(true);
    expect(automationOption({ automations: { eveningDigest: false } }, 'eveningDigest')).toBe(false);
    expect(automationOption({ automations: { eveningDigest: 'no' } }, 'eveningDigest')).toBe(true);
    expect(automationOption({ automations: [] }, 'supplierDelays')).toBe(true);
    // AU-13 rows (orchestrator 7.11): digest + contract expiry ON, list diff OFF
    expect(automationOption({}, 'priceCreepDigest')).toBe(true);
    expect(automationOption({}, 'contractExpiry')).toBe(true);
    expect(automationOption({}, 'priceListDiff')).toBe(false);
    expect(automationOption({ automations: { priceListDiff: true } }, 'priceListDiff')).toBe(true);
    expect(automationOption({ automations: { contractExpiry: false } }, 'contractExpiry')).toBe(false);
  });
});

describe('israelWeekStart', () => {
  it('is Sunday 00:00 Asia/Jerusalem (Sat→Sun boundary)', () => {
    // Sat 7.11.2026 23:59 IL (UTC+2) → week started Sun 1.11 00:00 IL = 31.10 22:00Z.
    expect(israelWeekStart(new Date('2026-11-07T21:59:00Z')).toISOString()).toBe('2026-10-31T22:00:00.000Z');
    // Sun 8.11 00:00 IL → a new week.
    expect(israelWeekStart(new Date('2026-11-07T22:00:00Z')).toISOString()).toBe('2026-11-07T22:00:00.000Z');
  });
});

describe('automations.setEnabled', () => {
  it('merges one flag without touching other settings keys or features.all, writes 1 audit row; a replay writes 0', async () => {
    await db
      .update(restaurants)
      .set({ settings: { tolerances: { pricePercent: 0.05 }, features: { all: true, recipes: false } } as RestaurantSettings })
      .where(eq(restaurants.id, A.restaurantId));
    const id = randomUUID();
    const out = await caller(A).automations.setEnabled({ key: 'priceAlerts', on: false, clientMutationId: id });
    expect(out).toMatchObject({ key: 'priceAlerts', on: false, killed: false, replayed: false });
    const s = await settingsOf(A);
    expect(s.tolerances).toEqual({ pricePercent: 0.05 });
    // features.all survives, the owner's off is an explicit false that wins over it.
    expect(s.features).toEqual({ all: true, recipes: false, priceAlerts: false });
    expect(featureEnabled(s, 'priceAlerts')).toBe(false);
    const audits = await auditRows(A);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ priceAlerts: false, automationId: 'A3', clientMutationId: id });
    expect(audits[0]!.before).toEqual({ priceAlerts: null });

    const replay = await caller(A).automations.setEnabled({ key: 'priceAlerts', on: true, clientMutationId: id });
    expect(replay.replayed).toBe(true);
    expect(await auditRows(A)).toHaveLength(1);
    expect(featureEnabled(await settingsOf(A), 'priceAlerts')).toBe(false);
  });

  it('stores an option under settings.automations', async () => {
    await caller(A).automations.setEnabled({ key: 'orderReminders', on: false, clientMutationId: randomUUID() });
    const s = await settingsOf(A);
    expect(s.automations).toEqual({ orderReminders: false });
    expect(automationOption(s, 'orderReminders')).toBe(false);
    expect(s.features).toBeUndefined();
  });

  it('a flag outside OWNER_TOGGLEABLE (or an unknown key) → FORBIDDEN automations.notOwnerToggleable', async () => {
    for (const key of ['payRun', 'ingestWhatsapp', 'aiAssistant', 'chain', 'orderCapture', 'all', 'nope']) {
      await expect(
        caller(A).automations.setEnabled({ key, on: true, clientMutationId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', cause: expect.objectContaining({ appCode: 'automations.notOwnerToggleable' }) });
    }
    expect(await settingsOf(A)).toEqual({});
  });

  it('kill-switch: the wish is stored, the response says killed, the flag stays off and the row shows killed', async () => {
    process.env.FEATURES_OFF = 'priceAlerts';
    const out = await caller(A).automations.setEnabled({ key: 'priceAlerts', on: true, clientMutationId: randomUUID() });
    expect(out).toMatchObject({ on: false, killed: true });
    const s = await settingsOf(A);
    expect((s.features as Record<string, boolean>).priceAlerts).toBe(true);
    expect(featureEnabled(s, 'priceAlerts')).toBe(false);
    const row = (await listAutomations(db, A.restaurantId)).find((r) => r.key === 'priceAlerts')!;
    expect(row).toMatchObject({ on: false, killed: true });
  });

  it('toggling on enqueues nothing (no retroactive send)', async () => {
    const before = await outboxCount(A);
    await caller(A).automations.setEnabled({ key: 'recovery', on: true, clientMutationId: randomUUID() });
    await caller(A).automations.setEnabled({ key: 'orderReminders', on: true, clientMutationId: randomUUID() });
    expect(await outboxCount(A)).toBe(before);
  });
});

describe('automations.list', () => {
  const now = new Date('2026-11-05T12:00:00Z'); // Thu; week from Sun 1.11 00:00 IL

  it('counts runs (distinct Israel day / entity), not recipients, per row matcher', async () => {
    const run1 = randomUUID();
    const run2 = randomUUID();
    await outbox(A, [
      // one 19:00 digest with 3 recipients = 1 run; another the previous week (not counted this week)
      { dedupeKey: `eod-report:${A.restaurantId}:2026-11-04:a@x`, createdAt: '2026-11-04T17:00:00Z' },
      { dedupeKey: `eod-report:${A.restaurantId}:2026-11-04:b@x`, createdAt: '2026-11-04T17:00:01Z' },
      { dedupeKey: `eod-report:${A.restaurantId}:2026-11-04:c@x`, createdAt: '2026-11-04T17:00:02Z' },
      { dedupeKey: `eod-report:${A.restaurantId}:2026-10-31:a@x`, createdAt: '2026-10-31T17:00:00Z' },
      // order reminder (2 suppliers, same day = 1 run) and late truck rows on their own rows
      { dedupeKey: `au:A5:${A.restaurantId}:${randomUUID()}:${randomUUID()}:2026-11-03`, createdAt: '2026-11-03T07:00:00Z' },
      { dedupeKey: `au:A5:${A.restaurantId}:${randomUUID()}:${randomUUID()}:2026-11-03`, createdAt: '2026-11-03T07:00:00Z' },
      { dedupeKey: `po:${randomUUID()}:late:d1:a@x`, createdAt: '2026-11-02T08:00:00Z' },
      // a PO "placed" send is counted on neither row
      { dedupeKey: `po:${randomUUID()}:placed`, createdAt: '2026-11-02T09:00:00Z' },
      // match alerts: two runs, one with 2 recipients, no dedupe key
      { createdAt: '2026-11-02T10:00:00Z', type: 'match_run', entity: run1 },
      { createdAt: '2026-11-02T10:00:00Z', type: 'match_run', entity: run1 },
      { createdAt: '2026-11-03T10:00:00Z', type: 'match_run', entity: run2 },
    ]);
    const rows = Object.fromEntries((await listAutomations(db, A.restaurantId, now)).map((r) => [r.key, r]));
    expect(rows.eveningDigest).toMatchObject({ countThisWeek: 1, measured: true });
    expect(rows.eveningDigest!.lastRunAt?.toISOString()).toBe('2026-11-04T17:00:02.000Z');
    expect(rows.orderReminders).toMatchObject({ countThisWeek: 1 });
    expect(rows.supplierDelays).toMatchObject({ countThisWeek: 1 });
    expect(rows.supplierDelays!.lastRunAt?.toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(rows.matchAlerts).toMatchObject({ countThisWeek: 2, on: true, kind: 'always', controllable: false });
    // never ran → lastRunAt null (UI: "עוד לא רץ"), not a fake 0 date
    expect(rows.priceAlerts).toMatchObject({ lastRunAt: null, countThisWeek: 0, measured: true });
    // no reliable matcher → "עוד לא נמדד"
    expect(rows.recoveryBookkeeper).toMatchObject({ measured: false, lastRunAt: null, countThisWeek: null });
  });

  it('flag rows follow featureEnabled; options default on; orderCapture is blocked without WhatsApp ingest', async () => {
    await db
      .update(restaurants)
      .set({ settings: { features: { priceAlerts: true, orderCapture: true } } as RestaurantSettings })
      .where(eq(restaurants.id, A.restaurantId));
    const { rows } = await caller(A).automations.list();
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.priceAlerts).toMatchObject({ on: true, controllable: true, kind: 'flag' });
    expect(by.recovery).toMatchObject({ on: false, controllable: true });
    expect(by.orderReminders).toMatchObject({ on: true, controllable: true, kind: 'option' });
    expect(by.eveningDigest).toMatchObject({ on: true, controllable: false, kind: 'always', controlKey: null });
    expect(by.orderCapture).toMatchObject({ on: false, controllable: false, blockedBy: 'ingestWhatsapp' });
  });

  it('manager and bookkeeper read (canEdit false); receiver and chef → FORBIDDEN', async () => {
    expect((await caller(A).automations.list()).canEdit).toBe(true);
    expect((await caller(A, 'manager').automations.list()).canEdit).toBe(false);
    expect((await caller(A, 'bookkeeper').automations.list()).canEdit).toBe(false);
    await expect(caller(A, 'receiver').automations.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(A, 'chef').automations.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('automations.listForAdmin', () => {
  it('returns the same rows for a platform admin and writes an admin.viewed row', async () => {
    const [admin] = await db
      .insert(users)
      .values({ email: `ops-${randomUUID()}@restomatch.co`, name: 'Ops', isPlatformAdmin: true })
      .returning();
    await db.insert(userCredentials).values({ userId: admin!.id, totpSecretEnc: 'c', totpEnabledAt: new Date() });
    const ctx: AppContext = { db, session: { userId: admin!.id, restaurantId: null, role: null } };
    const out = await testRouter.createCaller(ctx).automations.listForAdmin({ restaurantId: A.restaurantId });
    expect(out.rows.map((r) => r.key)).toEqual(AUTOMATIONS.map((a) => a.key));
    const viewed = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'admin.viewed')));
    expect(viewed.some((v) => (v.after as { view?: string }).view === 'automations')).toBe(true);
  });
});

describe('owner.vatAtRisk receiver narrowing (AD1 gate for vatAtRisk in the pilot defaults)', () => {
  // #219 (G-07 pilot strip) is on main: with the flag on, a receiver (an invoice reader)
  // gets the count but null for totalVatAtRisk, currentThresholdIls and every row ₪.
  it('receiver gets null ₪ from owner.vatAtRisk; the owner still gets the amounts', async () => {
    await db
      .update(restaurants)
      .set({ settings: { features: { vatAtRisk: true } } as RestaurantSettings })
      .where(eq(restaurants.id, A.restaurantId));
    const day = restaurantDateKey({ dayOffset: -3 });
    await db.insert(invoices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: `AU01-VAT-${randomUUID().slice(0, 8)}`,
      invoiceDate: new Date(`${day}T10:00:00+02:00`),
      totalExclVat: '12000.00',
      vatAmount: '2160.00',
      allocationNumber: null,
      status: 'parsed',
      source: 'photo',
    });
    const owner = await caller(A).owner.vatAtRisk({ period: 'all' });
    expect(owner.count).toBeGreaterThan(0);
    expect(owner.totalVatAtRisk).not.toBeNull();

    const recv = await caller(A, 'receiver').owner.vatAtRisk({ period: 'all' });
    expect(recv.count).toBe(owner.count);
    expect(recv.totalVatAtRisk).toBeNull();
    expect(recv.currentThresholdIls).toBeNull();
    for (const r of recv.rows) {
      expect(r.totalExclVat).toBeNull();
      expect(r.vatAtRisk).toBeNull();
      expect(r.thresholdIls).toBeNull();
    }
  });
});
