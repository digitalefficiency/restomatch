import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * Wave-1 integrations router (flag `integrations`). Functional checks plus the
 * cross-tenant attacks declared in cross-tenant.attack.test.ts COVERAGE.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function setFlag(tenant: Tenant, on: boolean) {
  await db
    .update(restaurants)
    .set({ settings: on ? { features: { integrations: true } } : {} } as never)
    .where(eq(restaurants.id, tenant.restaurantId));
}

const PERIOD = (() => {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  return { from: `${iso.slice(0, 8)}01`, to: iso };
})();

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
});
afterAll(async () => {
  await resetDb(db);
});
beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

describe('integrations flag', () => {
  it('status reports the flag; everything else is FORBIDDEN while it is off', async () => {
    expect(await callerFor(A).integrations.status()).toEqual({ enabled: false });
    await expect(
      callerFor(A).integrations.accountingExport({ format: 'hashavshevet', ...PERIOD }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FEATURE_DISABLED:integrations' });
    await expect(callerFor(A).integrations.accountingConfig()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setFlag(A, true);
    expect(await callerFor(A).integrations.status()).toEqual({ enabled: true });
  });

  it('FEATURES_OFF kill-switch wins over the per-restaurant flag', async () => {
    await setFlag(A, true);
    process.env.FEATURES_OFF = 'integrations';
    try {
      await expect(
        callerFor(A).integrations.accountingExport({ format: 'rivhit', ...PERIOD }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      delete process.env.FEATURES_OFF;
    }
  });
});

describe('accounting exports', () => {
  beforeEach(async () => {
    await setFlag(A, true);
  });

  it('exports the same checked invoices as the CSV, in each package format', async () => {
    const csv = await callerFor(A).exports.invoicesCsv(PERIOD);
    for (const format of ['hashavshevet', 'priority', 'rivhit'] as const) {
      const out = await callerFor(A).integrations.accountingExport({ format, ...PERIOD });
      expect(out.rowCount).toBe(csv.rowCount);
      expect(out.filename).toContain(format);
      expect(Buffer.from(out.base64, 'base64').length).toBeGreaterThan(0);
    }
    const h = await callerFor(A).integrations.accountingExport({ format: 'hashavshevet', ...PERIOD });
    const text = new TextDecoder('windows-1255').decode(Buffer.from(h.base64, 'base64'));
    expect(text).toContain(A.invoiceNumber);
    expect(text).toContain('100.00\t17.00\t117.00');
    expect(text).not.toContain(B.invoiceNumber);
  });

  it('a saved supplier mapping and accounts flow into the file', async () => {
    await callerFor(A).integrations.setAccountingConfig({
      expenseAccount: '6100',
      vatInputAccount: '3710',
      movementType: 'קנ',
      supplierAccounts: { [A.supplierId]: '40099' },
    });
    const cfg = await callerFor(A).integrations.accountingConfig();
    expect(cfg.config.expenseAccount).toBe('6100');
    expect(cfg.suppliers.find((s) => s.id === A.supplierId)?.account).toBe('40099');
    const h = await callerFor(A).integrations.accountingExport({ format: 'hashavshevet', ...PERIOD });
    const row = new TextDecoder('windows-1255').decode(Buffer.from(h.base64, 'base64')).split('\t');
    expect(row[0]).toBe('קנ');
    expect(row.slice(6, 9)).toEqual(['6100', '3710', '40099']);
    // The rest of restaurants.settings (the feature flag) survives the save.
    expect(await callerFor(A).integrations.status()).toEqual({ enabled: true });
  });

  it('roles: bookkeeper exports, manager/receiver/chef cannot; only the owner saves the mapping', async () => {
    await expect(
      callerFor(A, 'bookkeeper').integrations.accountingExport({ format: 'rivhit', ...PERIOD }),
    ).resolves.toMatchObject({ rowCount: 1 });
    for (const role of ['manager', 'receiver', 'chef'] as const) {
      await expect(
        callerFor(A, role).integrations.accountingExport({ format: 'rivhit', ...PERIOD }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      callerFor(A, 'bookkeeper').integrations.setAccountingConfig({
        expenseAccount: '1',
        vatInputAccount: '2',
        movementType: 'x',
        supplierAccounts: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects account codes that would break a delimited record', async () => {
    await expect(
      callerFor(A).integrations.setAccountingConfig({
        expenseAccount: '60\t00',
        vatInputAccount: '3700',
        movementType: 'חס',
        supplierAccounts: {},
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('integrations — cross-tenant attacks', () => {
  beforeEach(async () => {
    await setFlag(A, true);
    await setFlag(B, true);
  });

  it('setAccountingConfig with a foreign supplier id → NOT_FOUND, nothing saved', async () => {
    await expect(
      callerFor(A).integrations.setAccountingConfig({
        expenseAccount: '6000',
        vatInputAccount: '3700',
        movementType: 'חס',
        supplierAccounts: { [B.supplierId]: 'HIJACK' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [r] = await db.select({ s: restaurants.settings }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    expect(JSON.stringify(r?.s)).not.toContain('HIJACK');
  });

  it('accountingConfig lists only the caller restaurant suppliers', async () => {
    const cfg = await callerFor(A).integrations.accountingConfig();
    const ids = cfg.suppliers.map((s) => s.id);
    expect(ids).toContain(A.supplierId);
    expect(ids).not.toContain(B.supplierId);
  });

  it("A's flag does not enable B, and B's mapping never reaches A's file", async () => {
    await setFlag(B, false);
    await expect(callerFor(B).integrations.accountingConfig()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setFlag(B, true);
    await callerFor(B).integrations.setAccountingConfig({
      expenseAccount: '9999',
      vatInputAccount: '9998',
      movementType: 'BB',
      supplierAccounts: { [B.supplierId]: 'B-CARD' },
    });
    const h = await callerFor(A).integrations.accountingExport({ format: 'hashavshevet', ...PERIOD });
    const text = new TextDecoder('windows-1255').decode(Buffer.from(h.base64, 'base64'));
    expect(text).not.toMatch(/9999|B-CARD|BB/);
    const [sb] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, B.supplierId));
    expect(text).not.toContain(sb!.name);
  });
});
