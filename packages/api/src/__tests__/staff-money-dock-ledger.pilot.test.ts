import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, goodsReceipts, matchRuns, restaurants, testDbUrl, type UserRole } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * PILOT (train B, pilot-blocking): receiving.dockSlip and suppliers.ledger /
 * ledgerGrid return no ₪ to the RECEIVER (owner rule: the receiver sees no ₪).
 * Both flags are on in the pilot defaults. Same shape (null, never omitted);
 * owner / manager / bookkeeper unchanged; the chef can't call them at all.
 * The fixture: PO 5 kg × ₪8.50 → receipt → invoice ₪100 → a PRICE_HIGHER ₪100.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function caller(role: UserRole) {
  const session: Session = { userId: A.ownerUserId, restaurantId: A.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

const MONEY_KEY = /(Ils|Agorot)$|^agorot$/;

/** Every money-keyed value anywhere in `value`. */
function moneyValues(value: unknown, path = '$'): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...moneyValues(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if (MONEY_KEY.test(k)) out.push({ path: `${path}.${k}`, value: v });
      else out.push(...moneyValues(v, `${path}.${k}`));
    }
  }
  return out;
}

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'pilot-dock-a');
  await db
    .update(restaurants)
    .set({ settings: { features: { dockSlip: true, supplierLedger: true } } as typeof restaurants.$inferInsert['settings'] })
    .where(eq(restaurants.id, A.restaurantId));
  // The receipt closed, then the re-match ran after it: the slip's ₪ is "ready".
  const closedAt = new Date(Date.now() - 60_000);
  await db.update(goodsReceipts).set({ status: 'completed', updatedAt: closedAt }).where(eq(goodsReceipts.id, A.grId));
  await db.update(matchRuns).set({ runAt: new Date() }).where(eq(matchRuns.id, A.matchRunId));
  // The price finding carries its prices (₪8.50 ordered vs ₪10.00 billed), as the engine writes them.
  await db
    .update(discrepancies)
    .set({ expectedValue: '8.5000', actualValue: '10.0000' })
    .where(eq(discrepancies.id, A.discrepancyId));
});

afterAll(async () => {
  await resetDb(db);
});

describe('PILOT receiving.dockSlip — the receiver gets the quantities, never the ₪', () => {
  it('owner: engine total + per-line ₪ are numbers (the slip is ready)', async () => {
    const slip = await caller('owner').receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
    if (!slip.enabled) throw new Error('dockSlip flag off');
    expect(slip.engine.ready).toBe(true);
    expect(slip.engine.totalIls).toBeGreaterThan(0);
    expect(slip.engine.lines.length).toBeGreaterThan(0);
    for (const l of slip.engine.lines) expect(typeof l.amountIls).toBe('number');
    expect(slip.engine.lines.some((l) => l.type === 'PRICE_HIGHER' && l.expected !== null && l.actual !== null)).toBe(true);
    for (const role of ['manager', 'bookkeeper'] as const) {
      expect(await caller(role).receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId })).toEqual(slip);
    }
  });

  it('receiver: totalIls, every amountIls and the prices of price-type findings are null; same shape', async () => {
    const owner = await caller('owner').receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
    const slip = await caller('receiver').receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
    if (!slip.enabled || !owner.enabled) throw new Error('dockSlip flag off');
    expect(slip.engine.totalIls).toBeNull();
    expect(slip.engine.lines).toHaveLength(owner.engine.lines.length);
    for (const l of slip.engine.lines) {
      expect(l.amountIls).toBeNull();
      expect(Object.keys(l).sort()).toEqual(Object.keys(owner.engine.lines[0]!).sort());
    }
    const price = slip.engine.lines.find((l) => l.type === 'PRICE_HIGHER')!;
    expect(price.expected).toBeNull();
    expect(price.actual).toBeNull();
    for (const f of moneyValues(slip)) expect(f.value, f.path).toBeNull();
    expect(JSON.stringify(slip)).not.toContain('₪');
    // Everything that isn't ₪ is the owner's slip as is.
    expect({ ...slip, engine: { ...slip.engine, totalIls: owner.engine.totalIls, lines: owner.engine.lines } }).toEqual(owner);
  });

  it('chef: not an invoice reader — FORBIDDEN', async () => {
    await expect(caller('chef').receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('PILOT suppliers.ledger / ledgerGrid — the receiver gets counts and statuses, never the ₪', () => {
  it('owner: agorot are numbers; manager / bookkeeper equal', async () => {
    const ledger = await caller('owner').suppliers.ledger({ supplierId: A.supplierId, months: 3 });
    const grid = await caller('owner').suppliers.ledgerGrid({ months: 3 });
    expect(moneyValues(ledger).some((f) => typeof f.value === 'number' && f.value > 0)).toBe(true);
    expect(moneyValues(grid).some((f) => typeof f.value === 'number' && f.value > 0)).toBe(true);
    for (const role of ['manager', 'bookkeeper'] as const) {
      expect(await caller(role).suppliers.ledger({ supplierId: A.supplierId, months: 3 })).toEqual(ledger);
      expect(await caller(role).suppliers.ledgerGrid({ months: 3 })).toEqual(grid);
    }
  });

  it('receiver: every …Agorot / agorot is null, counts and statuses kept, same shape', async () => {
    const owner = await caller('owner').suppliers.ledger({ supplierId: A.supplierId, months: 3 });
    const ledger = await caller('receiver').suppliers.ledger({ supplierId: A.supplierId, months: 3 });
    const fields = moneyValues(ledger);
    expect(fields.length).toBe(moneyValues(owner).length);
    for (const f of fields) expect(f.value, f.path).toBeNull();
    expect(ledger.months.map((m) => [m.month, m.notes.count, m.status])).toEqual(
      owner.months.map((m) => [m.month, m.notes.count, m.status]),
    );

    const ownerGrid = await caller('owner').suppliers.ledgerGrid({ months: 3 });
    const grid = await caller('receiver').suppliers.ledgerGrid({ months: 3 });
    const gridFields = moneyValues(grid);
    expect(gridFields.length).toBe(moneyValues(ownerGrid).length);
    for (const f of gridFields) expect(f.value, f.path).toBeNull();
    expect(grid.suppliers.map((s) => [s.supplierId, s.cells.map((c) => c.status)])).toEqual(
      ownerGrid.suppliers.map((s) => [s.supplierId, s.cells.map((c) => c.status)]),
    );
  });

  it('chef: not an invoice reader — FORBIDDEN on both', async () => {
    await expect(caller('chef').suppliers.ledger({ supplierId: A.supplierId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('chef').suppliers.ledgerGrid()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
