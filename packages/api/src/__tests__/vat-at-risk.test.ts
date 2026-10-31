import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns, restaurants, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import {
  allocationThreshold,
  daysBetween,
  deductionDeadline,
  isValidAllocationNumber,
  vatAtRisk,
} from '../vat/vatAtRisk';
import { resetDb, seedTenant, type Tenant } from './fixtures';

describe('allocation-number threshold table (Invoices reform)', () => {
  it('uses the threshold in force on the INVOICE date', () => {
    expect(allocationThreshold('2024-05-04')).toBeNull();
    expect(allocationThreshold('2024-05-05')).toBe(25_000);
    expect(allocationThreshold('2024-12-31')).toBe(25_000);
    expect(allocationThreshold('2025-01-01')).toBe(20_000);
    expect(allocationThreshold('2025-12-31')).toBe(20_000);
    expect(allocationThreshold('2026-01-01')).toBe(10_000);
    expect(allocationThreshold('2026-05-31')).toBe(10_000);
    expect(allocationThreshold('2026-06-01')).toBe(5_000);
    expect(allocationThreshold('2026-10-25')).toBe(5_000);
  });

  it('validates the allocation-number FORMAT only (9 digits)', () => {
    expect(isValidAllocationNumber('123456789')).toBe(true);
    expect(isValidAllocationNumber(' 123-456-789 ')).toBe(true);
    for (const bad of [null, undefined, '', '   ', '12345678', '1234567890', '12345678a', '99887766']) {
      expect(isValidAllocationNumber(bad), String(bad)).toBe(false);
    }
  });

  it('closes the deduction window 6 months after the invoice date (month-end clamped)', () => {
    expect(deductionDeadline('2026-06-15')).toBe('2026-12-15');
    expect(deductionDeadline('2026-08-31')).toBe('2027-02-28');
    expect(deductionDeadline('2026-10-01')).toBe('2027-04-01');
    expect(daysBetween('2026-10-24', '2026-12-15')).toBe(52);
    expect(daysBetween('2026-10-24', '2026-10-23')).toBe(-1);
  });
});

const db = createDb(testDbUrl());
let A: Tenant;
const NOW = new Date('2026-10-24T09:00:00Z');

async function invoice(
  t: Tenant,
  v: { day: string; exVat: string; vat?: string | null; alloc?: string | null; status?: 'parsed' | 'ocr_pending'; supplierId?: string; number?: string },
) {
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: v.supplierId ?? t.supplierId,
      invoiceNumber: v.number ?? `VAT-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: new Date(`${v.day}T10:00:00+03:00`),
      totalExclVat: v.exVat,
      vatAmount: v.vat === undefined ? null : v.vat,
      allocationNumber: v.alloc ?? null,
      status: v.status ?? 'parsed',
      source: 'photo',
    })
    .returning({ id: invoices.id });
  return row!.id;
}

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('vatAtRisk (DB)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db.update(restaurants).set({ settings: { features: { vatAtRisk: true } } as never }).where(eq(restaurants.id, A.restaurantId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('flags exactly the invoices above the threshold of their date with no valid number', async () => {
    const atRisk = {
      justAbove: await invoice(A, { day: '2026-10-05', exVat: '5000.01', vat: '900.00' }),
      malformed: await invoice(A, { day: '2026-09-10', exVat: '12000.00', vat: '2160.00', alloc: '1234' }),
      feb: await invoice(A, { day: '2026-07-01', exVat: '15000.00' }), // no vat_amount → ex-VAT × 18%
    };
    // Not at risk:
    await invoice(A, { day: '2026-10-06', exVat: '5000.00', vat: '900.00' }); // exactly 5,000 — "above" only
    await invoice(A, { day: '2026-05-20', exVat: '9000.00', vat: '1620.00' }); // May 2026: threshold 10,000
    await invoice(A, { day: '2026-10-07', exVat: '8000.00', vat: '1440.00', alloc: '123456789' }); // valid number
    await invoice(A, { day: '2026-10-08', exVat: '-6000.00', vat: '-1080.00' }); // credit invoice — excluded
    await invoice(A, { day: '2026-10-09', exVat: '7000.00', status: 'ocr_pending' }); // not read yet
    const [exempt] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ירקות פטורים', vatRate: '0' }).returning();
    await invoice(A, { day: '2026-10-10', exVat: '6000.00', supplierId: exempt!.id }); // VAT-exempt produce: nothing to lose

    const r = await vatAtRisk(db, A.restaurantId, 'all', { now: NOW });
    expect(r.rows.map((x) => x.invoiceId).sort()).toEqual(Object.values(atRisk).sort());
    const byId = Object.fromEntries(r.rows.map((x) => [x.invoiceId, x]));
    expect(byId[atRisk.justAbove]).toMatchObject({ vatAtRisk: 900, thresholdIls: 5000, allocationNumber: null, deductionDeadline: '2027-04-05' });
    expect(byId[atRisk.malformed]).toMatchObject({ allocationNumber: '1234', thresholdIls: 5000 });
    expect(byId[atRisk.feb]).toMatchObject({ vatAtRisk: 2700, deductionDeadline: '2027-01-01', daysLeft: 69 });
    expect(r).toMatchObject({ count: 3, totalVatAtRisk: 5760, currentThresholdIls: 5000 });
    // Most urgent (window closing soonest) first.
    expect(r.rows[0]!.invoiceId).toBe(atRisk.feb);
  });

  it('pre-June-2026 invoices use the older thresholds; a closed window drops out of "open"', async () => {
    const jan2026 = await invoice(A, { day: '2026-01-15', exVat: '10500.00', vat: '1890.00' }); // > 10,000 → at risk, window closed 2026-07-15
    await invoice(A, { day: '2025-06-01', exVat: '19000.00', vat: '3230.00' }); // 2025: threshold 20,000 → fine
    const old = await invoice(A, { day: '2025-06-02', exVat: '21000.00', vat: '3570.00' }); // > 20,000 → at risk
    const all = await vatAtRisk(db, A.restaurantId, 'all', { now: NOW });
    expect(all.rows.map((x) => x.invoiceId).sort()).toEqual([jan2026, old].sort());
    expect(all.rows.find((x) => x.invoiceId === jan2026)).toMatchObject({ thresholdIls: 10_000, daysLeft: -101 });
    const open = await vatAtRisk(db, A.restaurantId, 'open', { now: NOW });
    expect(open.count).toBe(0);
  });

  it('a confirmed / undecided duplicate copy is excluded; a duplicate flag a manager rejected is not', async () => {
    const copy = await invoice(A, { day: '2026-10-11', exVat: '7000.00', vat: '1260.00' });
    const [run] = await db.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: copy, overallStatus: 'major' }).returning();
    const [d] = await db
      .insert(discrepancies)
      .values({ restaurantId: A.restaurantId, matchRunId: run!.id, type: 'DUPLICATE_INVOICE', severity: 'block' } as never)
      .returning();
    expect((await vatAtRisk(db, A.restaurantId, 'all', { now: NOW })).count).toBe(0);
    await db.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, d!.id));
    expect((await vatAtRisk(db, A.restaurantId, 'all', { now: NOW })).rows.map((x) => x.invoiceId)).toEqual([copy]);
  });

  it('router: flag-gated, chef forbidden, invoiceId narrows to one invoice', async () => {
    const id = await invoice(A, { day: '2026-10-12', exVat: '6000.00', vat: '1080.00' });
    const r = await callerFor(A).owner.vatAtRisk({ period: 'all', invoiceId: id });
    expect(r.rows.map((x) => x.invoiceId)).toEqual([id]);
    await expect(callerFor(A, 'chef').owner.vatAtRisk({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await callerFor(A, 'receiver').owner.vatAtRisk({ period: 'all' })).count).toBe(1);
    await db.update(restaurants).set({ settings: {} as never }).where(eq(restaurants.id, A.restaurantId));
    await expect(callerFor(A).owner.vatAtRisk({})).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'FEATURE_DISABLED' } });
  });
});
