import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, eq, invoices, posSales, procurementConnections, restaurants, suppliers, testDbUrl } from '@restomatch/db';
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
    ).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'FEATURE_DISABLED', appParams: { feature: 'integrations' } } });
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

  it('an invoice whose stored totals do not add up is skipped, never posted unbalanced', async () => {
    await db.update(invoices).set({ totalInclVat: '118.00' }).where(eq(invoices.id, A.invoiceId)); // 100 + 17 ≠ 118
    const out = await callerFor(A).integrations.accountingExport({ format: 'hashavshevet', ...PERIOD });
    expect(out).toMatchObject({ rowCount: 0, skippedCount: 1 });
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

const POS_FX = join(__dirname, '..', 'integrations', 'pos', '__tests__', 'fixtures');
const posFile = (name: string) => ({ filename: name, base64: readFileSync(join(POS_FX, name)).toString('base64') });
const csv64 = (text: string) => ({ filename: 'z.csv', base64: Buffer.from(text, 'utf8').toString('base64') });

describe('POS sales import', () => {
  beforeEach(async () => {
    await setFlag(A, true);
  });

  it('preview parses without saving; import saves; summary sums per item', async () => {
    const pre = await callerFor(A).integrations.posPreview(posFile('pos-sales-he-windows1255.csv'));
    expect(pre).toMatchObject({ rowCount: 4, from: '2026-10-01', to: '2026-10-02', totalNetAgorot: 136150, issueCount: 3 });
    expect(await db.select().from(posSales).where(eq(posSales.restaurantId, A.restaurantId))).toHaveLength(0);

    const imp = await callerFor(A).integrations.posImport(posFile('pos-sales-he-windows1255.csv'));
    expect(imp).toMatchObject({ rowCount: 4, replacedRows: 0 });
    const sum = await callerFor(A).integrations.posSummary({ from: '2026-10-01', to: '2026-10-31' });
    expect(sum.find((r) => r.itemRef === '101')).toMatchObject({ itemName: 'שקשוקה', qty: '5.500', netAmount: '297.00', days: 2 });
    expect(sum[0]!.itemRef).toBe('205'); // highest net first
    expect((await callerFor(A).integrations.posImports())[0]).toMatchObject({ rowCount: 4, totalNet: '1361.50' });
  });

  it('re-importing the same days replaces them (never double-counts)', async () => {
    await callerFor(A).integrations.posImport(posFile('pos-sales-en-utf8.csv'));
    const again = await callerFor(A).integrations.posImport(posFile('pos-sales-en-utf8.csv'));
    expect(again.replacedRows).toBe(3);
    const sum = await callerFor(A).integrations.posSummary({ from: '2026-10-01', to: '2026-10-31' });
    expect(sum.find((r) => r.itemRef === '101')?.netAmount).toBe('324.00');
  });

  it('a corrected file with fewer days replaces only those days (never the gaps)', async () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')},Soup,1,10.00`);
    await callerFor(A).integrations.posImport(csv64(`date,item,qty,net\n${days.join('\n')}\n`));
    const fix = await callerFor(A).integrations.posImport(
      csv64('date,item,qty,net\n2026-09-01,Soup,2,20.00\n2026-09-30,Soup,2,20.00\n'),
    );
    expect(fix.replacedRows).toBe(2);
    const sum = await callerFor(A).integrations.posSummary({ from: '2026-09-01', to: '2026-09-30' });
    expect(sum[0]).toMatchObject({ days: 30, netAmount: '320.00' });
    const history = await callerFor(A).integrations.posImports();
    expect(history.map((h) => h.liveRows)).toEqual([2, 28]);
  });

  it('a file with nothing usable is BAD_REQUEST with a stable code', async () => {
    await expect(callerFor(A).integrations.posImport(posFile('pos-sales-missing-columns.csv'))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'POS_FILE_NO_COLUMNS:qty,net',
    });
    await expect(
      callerFor(A).integrations.posImport(csv64('date,item,qty,net\nnot-a-date,Soup,1,10\n')),
    ).rejects.toMatchObject({ message: 'POS_FILE_NO_ROWS' });
  });

  it('roles: manager imports, chef reads the summary only, receiver/bookkeeper nothing', async () => {
    await expect(callerFor(A, 'manager').integrations.posImport(posFile('pos-sales-en-utf8.csv'))).resolves.toBeTruthy();
    await expect(callerFor(A, 'chef').integrations.posSummary({ from: '2026-10-01', to: '2026-10-31' })).resolves.toHaveLength(2);
    await expect(callerFor(A, 'chef').integrations.posImport(posFile('pos-sales-en-utf8.csv'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const role of ['receiver', 'bookkeeper'] as const) {
      await expect(
        callerFor(A, role).integrations.posSummary({ from: '2026-10-01', to: '2026-10-31' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('procurement providers (offline sample data)', () => {
  beforeEach(async () => {
    await setFlag(A, true);
  });

  it('lists MarketMan + Zester with connection state; preview runs on the recorded fixture', async () => {
    const before = await callerFor(A).integrations.procurementProviders();
    expect(before.map((p) => [p.platform, p.adapter, p.connected])).toEqual([
      ['marketman', true, false],
      ['zester', true, false],
    ]);
    await db.insert(procurementConnections).values({ restaurantId: A.restaurantId, platform: 'zester', credentialsVaultRef: 'fixture:demo' });
    const after = await callerFor(A).integrations.procurementProviders();
    expect(after.find((p) => p.platform === 'zester')).toMatchObject({ connected: true, mode: 'sample' });
    const pre = await callerFor(A).integrations.procurementPreview({ platform: 'zester' });
    expect(pre).toMatchObject({ sample: true, suppliers: 2, products: 3 });
    expect(pre.orders.map((o) => o.externalId)).toEqual(['zs-o-501', 'zs-o-502']);
  });
});

describe('POS + procurement — cross-tenant attacks', () => {
  beforeEach(async () => {
    await setFlag(A, true);
    await setFlag(B, true);
  });

  it("A's import never deletes B's sales for the same days; summaries stay per restaurant", async () => {
    await callerFor(B).integrations.posImport(posFile('pos-sales-en-utf8.csv'));
    await callerFor(A).integrations.posImport(posFile('pos-sales-en-utf8.csv'));
    await callerFor(A).integrations.posImport(posFile('pos-sales-en-utf8.csv'));
    expect(await db.select().from(posSales).where(eq(posSales.restaurantId, B.restaurantId))).toHaveLength(3);
    const a = await callerFor(A).integrations.posSummary({ from: '2026-10-01', to: '2026-10-31' });
    expect(a.find((r) => r.itemRef === '101')?.netAmount).toBe('324.00'); // A's only, not A + B
    const imports = await callerFor(A).integrations.posImports();
    expect(imports).toHaveLength(2);
  });

  it("procurementProviders shows only the caller's connections", async () => {
    await db.insert(procurementConnections).values({ restaurantId: B.restaurantId, platform: 'marketman', credentialsVaultRef: 'env:B_KEY' });
    const a = await callerFor(A).integrations.procurementProviders();
    expect(a.every((p) => !p.connected)).toBe(true);
  });
});
