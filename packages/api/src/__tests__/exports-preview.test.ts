/**
 * W3-05b exports.preview: the export BEFORE the download. The included set is the
 * file's own query (equal to invoicesCsv / uniform1000 row counts); every invoice
 * of the period left out is grouped by reason with ids for fix links; ₪ in exact
 * integer agorot; tenant B's rows never appear.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { toAgorot } from '../exports/preview';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const ids: Record<string, string> = {};

function callerFor(t: Tenant, role: Session['role'] = 'bookkeeper') {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function inv(
  t: Tenant,
  v: { day: string | null; incl: string | null; vat?: string | null; status: 'parsed' | 'matched' | 'disputed'; number?: string | null; createdDay?: string },
) {
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceNumber: v.number === undefined ? `P-${Math.random().toString(36).slice(2, 10)}` : v.number,
      invoiceDate: v.day ? new Date(`${v.day}T10:00:00+03:00`) : null,
      totalInclVat: v.incl,
      vatAmount: v.vat ?? null,
      status: v.status,
      source: 'photo',
      ...(v.createdDay ? { createdAt: new Date(`${v.createdDay}T10:00:00+03:00`) } : {}),
    })
    .returning({ id: invoices.id });
  return row!.id;
}

describe('exports.preview (W3-05b)', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    // In the file: two checked invoices (one disputed), VAT exact to the agora.
    ids.ok = await inv(A, { day: '2026-09-03', incl: '117.10', vat: '17.01', status: 'matched' });
    ids.disp = await inv(A, { day: '2026-09-29', incl: '0.20', vat: '0.03', status: 'disputed' });
    // In the file but not in the 1000 file: no invoice number.
    ids.noNum = await inv(A, { day: '2026-09-10', incl: '50.00', vat: '7.26', status: 'matched', number: null });
    // Left out: not checked yet.
    ids.parsed = await inv(A, { day: '2026-09-12', incl: '33.33', status: 'parsed' });
    // Left out: checked, no date, created in the period.
    ids.undated = await inv(A, { day: null, incl: '20.00', status: 'matched', createdDay: '2026-09-15' });
    // Left out: an unwaived duplicate copy (its latest run carries an open DUPLICATE_INVOICE).
    ids.dup = await inv(A, { day: '2026-09-20', incl: '117.10', status: 'disputed' });
    const [run] = await db
      .insert(matchRuns)
      .values({ restaurantId: A.restaurantId, invoiceId: ids.dup, overallStatus: 'blocked', totalDiscrepancyAmount: '117.10' })
      .returning();
    await db.insert(discrepancies).values({
      matchRunId: run!.id,
      restaurantId: A.restaurantId,
      type: 'DUPLICATE_INVOICE',
      severity: 'block',
      deltaAmount: '117.10',
      requiresRole: 'owner',
      resolutionStatus: 'open',
    });
    // Outside the period, and tenant B: never in A's preview.
    await inv(A, { day: '2026-10-01', incl: '999.00', status: 'matched' });
    await inv(B, { day: '2026-09-05', incl: '777.00', vat: '100.00', status: 'matched' });
    await inv(B, { day: '2026-09-05', incl: '1.00', status: 'parsed' });
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('count, ₪ incl. VAT and VAT of the file, agora-exact; disputed counted', async () => {
    const p = await callerFor(A).exports.preview(PERIOD);
    expect(p).toMatchObject({
      invoiceCount: 3,
      totalInclVatAgorot: 11_710 + 20 + 5_000,
      vatAgorot: 1_701 + 3 + 726,
      disputedCount: 1,
    });
  });

  it('the included set IS the file: equal to invoicesCsv and (minus notInUniform) uniform1000', async () => {
    const c = callerFor(A);
    const [p, csv, u] = await Promise.all([c.exports.preview(PERIOD), c.exports.invoicesCsv(PERIOD), c.exports.uniform1000(PERIOD)]);
    expect(csv.rowCount).toBe(p.invoiceCount);
    const notInUniform = p.excluded.find((g) => g.reason === 'notInUniform')?.count ?? 0;
    expect(u.rowCount).toBe(p.invoiceCount - notInUniform);
  });

  it('every left-out invoice of the period, by reason, with ids for the fix links', async () => {
    const p = await callerFor(A).exports.preview(PERIOD);
    const by = Object.fromEntries(p.excluded.map((g) => [g.reason, g]));
    expect(Object.keys(by)).toEqual(['notChecked', 'duplicate', 'undated', 'notInUniform']);
    expect(by.notChecked).toEqual({ reason: 'notChecked', count: 1, totalInclVatAgorot: 3_333, invoiceIds: [ids.parsed] });
    expect(by.duplicate).toEqual({ reason: 'duplicate', count: 1, totalInclVatAgorot: 11_710, invoiceIds: [ids.dup] });
    expect(by.undated).toEqual({ reason: 'undated', count: 1, totalInclVatAgorot: 2_000, invoiceIds: [ids.undated] });
    expect(by.notInUniform).toEqual({ reason: 'notInUniform', count: 1, totalInclVatAgorot: 5_000, invoiceIds: [ids.noNum] });
    // The undated group agrees with the summary's own count.
    expect((await callerFor(A).exports.summary(PERIOD)).undatedCount).toBe(by.undated.count);
  });

  it("tenant isolation: B's preview holds only B's rows, A's ids never leak", async () => {
    const p = await callerFor(B).exports.preview(PERIOD);
    expect(p.invoiceCount).toBe(1);
    expect(p.totalInclVatAgorot).toBe(77_700);
    const leaked = p.excluded.flatMap((g) => g.invoiceIds).filter((id) => Object.values(ids).includes(id));
    expect(leaked).toEqual([]);
  });

  it('an empty period: zeros and no groups (the UI shows it calm)', async () => {
    const p = await callerFor(A).exports.preview({ from: '2026-06-01', to: '2026-06-30' });
    expect(p).toMatchObject({ invoiceCount: 0, totalInclVatAgorot: 0, vatAgorot: 0, disputedCount: 0, excluded: [] });
  });

  it('manager, receiver and chef are refused (bookkeeper procedure)', async () => {
    for (const role of ['manager', 'receiver', 'chef'] as const) {
      await expect(callerFor(A, role).exports.preview(PERIOD)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('toAgorot', () => {
  it('parses 2-dp NUMERIC strings exactly, null as 0', () => {
    expect(toAgorot('117.10')).toBe(11_710);
    expect(toAgorot('0.2')).toBe(20);
    expect(toAgorot('-12.34')).toBe(-1_234);
    expect(toAgorot(null)).toBe(0);
  });
});
