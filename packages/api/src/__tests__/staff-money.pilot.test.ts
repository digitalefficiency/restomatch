import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants, testDbUrl, type UserRole } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';
import { hasShekel, stripShekelFigures } from '../lib/staffMoney';

/**
 * PILOT (train B): direct tRPC calls by a receiver / chef return no ₪ on the
 * pre-existing money paths (receiving.getPo / getInvoice, owner.kpis /
 * leakHero / leakSummary / vatAtRisk). Same shape, same tiers; owner / manager
 * / bookkeeper unchanged. orders.list, catalog.items and suppliers.ledger*
 * are H-11's.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function caller(role: UserRole) {
  const session: Session = { userId: A.ownerUserId, restaurantId: A.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

/** Money-bearing keys anywhere in a response. */
const MONEY_KEY = /(Ils|Agorot)$|^total|vatAmount|unitPrice|lineTotal|leakPct|^vatAtRisk$|threshold/i;

/** Every money key in `value` (path list) and whether each one is null. */
function moneyFields(value: unknown, path = '$'): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...moneyFields(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if (MONEY_KEY.test(k)) out.push({ path: `${path}.${k}`, value: v });
      else out.push(...moneyFields(v, `${path}.${k}`));
    }
  }
  return out;
}

function expectNoMoney(value: unknown) {
  expect(JSON.stringify(value)).not.toContain('₪');
  const fields = moneyFields(value);
  expect(fields.length).toBeGreaterThan(0); // the shape still carries the keys
  for (const f of fields) expect(f.value, f.path).toBeNull();
}

function expectSomeMoney(value: unknown) {
  expect(moneyFields(value).some((f) => f.value !== null && f.value !== 0)).toBe(true);
}

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'pilot-money-a');
  await db
    .update(restaurants)
    .set({ settings: { features: { vatAtRisk: true } } as typeof restaurants.$inferInsert['settings'] })
    .where(eq(restaurants.id, A.restaurantId));
});

afterAll(async () => {
  await resetDb(db);
});

describe('PILOT receiving — the receiver gets no ₪', () => {
  it('getPo: receiver → totalEstimated + unitPriceExpected null; chef / owner keep them', async () => {
    const recv = await caller('receiver').receiving.getPo({ poId: A.poId });
    expect(recv.totalEstimated).toBeNull();
    for (const l of recv.lines) expect(l.unitPriceExpected).toBeNull();
    expect(recv.lines.length).toBeGreaterThan(0);
    // Everything else is unchanged against the owner's response.
    const owner = await caller('owner').receiving.getPo({ poId: A.poId });
    expect({ ...recv, totalEstimated: owner.totalEstimated, lines: owner.lines }).toEqual(owner);
    expect(owner.lines.some((l) => l.unitPriceExpected !== null)).toBe(true);
    expect(await caller('chef').receiving.getPo({ poId: A.poId })).toEqual(owner);
    expect(await caller('manager').receiving.getPo({ poId: A.poId })).toEqual(owner);
  });

  it('getInvoice: receiver → header totals + line totals null; owner / manager / bookkeeper unchanged', async () => {
    const recv = await caller('receiver').receiving.getInvoice({ invoiceId: A.invoiceId });
    expect(recv.totalExclVat).toBeNull();
    expect(recv.vatAmount).toBeNull();
    expect(recv.totalInclVat).toBeNull();
    for (const l of recv.lines) {
      expect(l.lineTotal).toBeNull();
      expect(l.unitPriceBilled).toBeNull();
      // The wizard still knows the OCR read a price (not an unreadable line).
      expect(l.priceRead).toBe(true);
    }
    expect(JSON.stringify(recv)).not.toContain('₪');
    const owner = await caller('owner').receiving.getInvoice({ invoiceId: A.invoiceId });
    expect(owner.totalInclVat).not.toBeNull();
    expect(owner.lines.some((l) => l.lineTotal !== null)).toBe(true);
    expect(owner.lines.every((l) => l.priceRead === (l.unitPriceBilled != null && Number(l.unitPriceBilled) !== 0))).toBe(true);
    expect(await caller('manager').receiving.getInvoice({ invoiceId: A.invoiceId })).toEqual(owner);
    expect(await caller('bookkeeper').receiving.getInvoice({ invoiceId: A.invoiceId })).toEqual(owner);
    // Lines stay aligned (ids, qty) so the Delivery Check works the same.
    expect(recv.lines.map((l) => [l.id, l.qtyBilled])).toEqual(owner.lines.map((l) => [l.id, l.qtyBilled]));
  });
});

describe('PILOT owner.* aggregates — receiver / chef get counts, never ₪', () => {
  const view = { view: { period: 'this_month' as const }, compare: 'prev' as const };

  for (const role of ['receiver', 'chef'] as const) {
    it(`${role}: kpis, leakHero, leakSummary are ₪-free with the same keys`, async () => {
      const c = caller(role);
      const [kpis, hero, summary] = await Promise.all([c.owner.kpis(), c.owner.leakHero(), c.owner.leakSummary(view)]);
      expectNoMoney(kpis);
      expectNoMoney(hero);
      expectNoMoney(summary);
      const o = caller('owner');
      const [oKpis, oHero] = await Promise.all([o.owner.kpis(), o.owner.leakHero()]);
      expect(Object.keys(kpis).sort()).toEqual(Object.keys(oKpis).sort());
      expect(Object.keys(hero).sort()).toEqual(Object.keys(oHero).sort());
      // Counts survive.
      expect(kpis.pendingApprovalsCount).toBe(oKpis.pendingApprovalsCount);
      expect(hero.invoiceCount).toBe(oHero.invoiceCount);
      expect(hero.invoicesWithLeak).toBe(oHero.invoicesWithLeak);
    });
  }

  it('receiver: vatAtRisk is ₪-free (count kept)', async () => {
    const recv = await caller('receiver').owner.vatAtRisk({ period: 'all' });
    const owner = await caller('owner').owner.vatAtRisk({ period: 'all' });
    expect(recv.count).toBe(owner.count);
    expect(recv.totalVatAtRisk).toBeNull();
    expect(recv.currentThresholdIls).toBeNull();
    for (const r of recv.rows) {
      expect(r.totalExclVat).toBeNull();
      expect(r.vatAtRisk).toBeNull();
      expect(r.thresholdIls).toBeNull();
    }
  });

  it('owner / manager / bookkeeper: unchanged and equal', async () => {
    const o = caller('owner');
    const [kpis, hero, summary, vat] = await Promise.all([
      o.owner.kpis(),
      o.owner.leakHero(),
      o.owner.leakSummary(view),
      o.owner.vatAtRisk({ period: 'all' }),
    ]);
    expectSomeMoney(hero);
    for (const role of ['manager', 'bookkeeper'] as const) {
      const c = caller(role);
      expect(await c.owner.kpis()).toEqual(kpis);
      expect(await c.owner.leakHero()).toEqual(hero);
      expect(await c.owner.leakSummary(view)).toEqual(summary);
      expect(await c.owner.vatAtRisk({ period: 'all' })).toEqual(vat);
    }
  });
});

describe('shekel matcher', () => {
  it.each([
    ['₪12', ''],
    ['12 ₪', ''],
    ['45 ש"ח', ''],
    ['45 ש״ח', ''],
    ['45 ש”ח', ''],
    ["45 ש''ח", ''],
    ['45 שח', ''],
    ['45 שקל', ''],
    ['45 שקלים', ''],
    ['nis 45', ''],
    ['ILS45', ''],
    ['הפסד ‏₪1,234.50 בחודש', 'הפסד בחודש'],
  ])('%s → stripped', (input, expected) => {
    expect(hasShekel(input)).toBe(true);
    expect(stripShekelFigures(input)).toBe(expected);
  });

  it.each(['חשבונית 1001', 'שחר הספק', 'משקל 5 ק"ג', 'NISSAN', 'ILSA'])('%s → untouched', (text) => {
    expect(hasShekel(text)).toBe(false);
  });
});
