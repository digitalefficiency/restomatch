import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeLeakHero, readClosedLeakMonth } from '@restomatch/charts';
import { sql, testDbUrl } from '@restomatch/db';
import {
  CATCH_UP_MONTHS,
  correctionDeltas,
  funnelOf,
  lastDayOf,
  monthsToClose,
  processLeakMonthClose,
  runLeakMonthClose,
} from '../jobs/leakMonthClose';
import type { WorkerJob } from '../queue';
import { cleanup, db, tenant } from './leakMonthCloseFixture';

/**
 * H-07ʰ: the monthly leak close. A month closes at 00:00 local on the 5th of the
 * next month; the snapshot equals the hero to the agora; the first run catches
 * up; later changes become dated corrections; a closed month never restates.
 */
process.env.DATABASE_URL ??= testDbUrl();
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });

// Asia/Jerusalem is UTC+2 in winter: local 00:00 on Tue 5.1.2027 = 2027-01-04T22:00Z.
const JAN4_2359 = new Date('2027-01-04T21:59:00Z');
const JAN5_0000 = new Date('2027-01-04T22:00:00Z');
const JAN5_0415 = new Date('2027-01-05T02:15:00Z');
const JAN6 = new Date('2027-01-06T02:15:00Z');
const JAN7 = new Date('2027-01-07T02:15:00Z');

const snapshots = async (restaurantId: string) =>
  (await db.execute(sql`
    SELECT to_char(month, 'YYYY-MM') AS month, version, leak_agorot, reason, created_by
    FROM leak_month_snapshots WHERE restaurant_id = ${restaurantId}::uuid ORDER BY month, version
  `)) as unknown as { month: string; version: number; leak_agorot: string; reason: string | null; created_by: string | null }[];

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(cleanup);

describe('pure planning', () => {
  it('monthsToClose: from the first month to the last closed one, minus the snapshotted ones, capped', () => {
    expect(monthsToClose(null, '2026-12-01', new Set())).toEqual([]);
    expect(monthsToClose('2026-10-01', '2026-12-01', new Set(['2026-11-01']))).toEqual(['2026-10-01', '2026-12-01']);
    expect(monthsToClose('2027-01-01', '2026-12-01', new Set())).toEqual([]);
    const capped = monthsToClose('2020-01-01', '2026-12-01', new Set());
    expect(capped).toHaveLength(CATCH_UP_MONTHS);
    expect(capped[0]).toBe('2025-01-01');
    expect(capped.at(-1)).toBe('2026-12-01');
  });

  it('correctionDeltas: current − (baseline + corrected), non-zero only', () => {
    const d = correctionDeltas({ a: 100, b: 50 }, new Map([['b', 10]]), new Map([['a', 100], ['b', 40], ['c', 5]]));
    expect(d).toEqual([
      { invoiceId: 'b', deltaAgorot: -20 },
      { invoiceId: 'c', deltaAgorot: 5 },
    ]);
  });
});

describe('leak-month-close (DB)', () => {
  it('no December snapshot before 00:00 on the 5th (local); on the 5th it equals the hero to the agora', async () => {
    const t = await tenant('close');
    await t.invoice(new Date('2026-11-15T10:00:00Z'), '500', [{ delta: '12.34' }]);
    await t.invoice(new Date('2026-12-10T10:00:00Z'), '1000', [
      { delta: '50' },
      { delta: '3', severity: 'info' }, // inside tolerance: not leak
      { delta: '9', type: 'PRICE_LOWER' }, // under-charge: not leak
    ]);
    await t.invoice(new Date('2026-12-20T10:00:00Z'), '30', [{ delta: '20' }, { delta: '25', severity: 'block' }]); // capped at 30
    // 00:30 on 1.12 local = 30.11 22:30Z: belongs to December.
    await t.invoice(new Date('2026-11-30T22:30:00Z'), '100', [{ delta: '7.01' }]);

    const r1 = await runLeakMonthClose(db, { now: JAN4_2359, restaurantId: t.restaurantId });
    expect(r1).toMatchObject({ restaurants: 1, snapshots: 1, corrections: 0, failed: [] });
    expect(await snapshots(t.restaurantId)).toEqual([
      { month: '2026-11', version: 1, leak_agorot: '1234', reason: null, created_by: null },
    ]);
    expect(await readClosedLeakMonth(db, t.restaurantId, '2026-12')).toBeNull();

    const r2 = await runLeakMonthClose(db, { now: JAN5_0000, restaurantId: t.restaurantId });
    expect(r2).toMatchObject({ snapshots: 1, corrections: 0 });
    const dec = await readClosedLeakMonth(db, t.restaurantId, '2026-12');
    expect(dec!.frozenLeakAgorot).toBe(5000 + 3000 + 701);
    const hero = await computeLeakHero(db, t.restaurantId, { now: JAN5_0415, monthOffset: -1 });
    expect(Math.round(hero.leakIls * 100)).toBe(dec!.frozenLeakAgorot);
    expect(dec!.payload).toMatchObject({ schema: 'leak-month-close/v2', tz: 'Asia/Jerusalem', hero: { leakAgorot: 8701 } });
    expect(Object.keys(dec!.payload.invoices as object)).toHaveLength(3);
    expect(dec!.corrections).toEqual([]);
  });

  it('catch-up: the first run snapshots every closed month; a second run writes nothing', async () => {
    const t = await tenant('catchup');
    await t.invoice(new Date('2026-09-10T10:00:00Z'), '100', [{ delta: '1' }]);
    await t.invoice(new Date('2026-12-10T10:00:00Z'), '100', [{ delta: '4' }]);
    await t.invoice(new Date('2027-01-02T10:00:00Z'), '100', [{ delta: '9' }]); // the open month: never
    const first = await processLeakMonthClose(job({ restaurantId: t.restaurantId, forDate: JAN5_0415.toISOString() }));
    expect(first).toMatchObject({ snapshots: 4, corrections: 0, failed: [] });
    expect((await snapshots(t.restaurantId)).map((s) => [s.month, s.leak_agorot])).toEqual([
      ['2026-09', '100'],
      ['2026-10', '0'],
      ['2026-11', '0'],
      ['2026-12', '400'],
    ]);
    const second = await runLeakMonthClose(db, { now: JAN6, restaurantId: t.restaurantId });
    expect(second).toMatchObject({ snapshots: 0, corrections: 0 });
    expect(await snapshots(t.restaurantId)).toHaveLength(4);
  });

  it('a closed month never restates: a late change is a dated correction line, once', async () => {
    const t = await tenant('correct');
    const a = await t.invoice(new Date('2026-12-10T10:00:00Z'), '1000', [{ delta: '50' }]);
    await runLeakMonthClose(db, { now: JAN5_0415, restaurantId: t.restaurantId });

    const late = await a.add({ delta: '10.5' }); // found after the close
    const r1 = await runLeakMonthClose(db, { now: JAN6, restaurantId: t.restaurantId });
    expect(r1).toMatchObject({ snapshots: 0, corrections: 1 });
    expect(await runLeakMonthClose(db, { now: JAN6, restaurantId: t.restaurantId })).toMatchObject({ corrections: 0 });

    await a.remove(late); // and taken back
    expect(await runLeakMonthClose(db, { now: JAN7, restaurantId: t.restaurantId })).toMatchObject({ corrections: 1 });

    const dec = await readClosedLeakMonth(db, t.restaurantId, '2026-12');
    expect(dec!.frozenLeakAgorot).toBe(5000); // unchanged
    expect(dec!.corrections.map((c) => [c.deltaAgorot, c.entityId, c.createdAt, c.reason])).toEqual([
      [1050, a.invoiceId, JAN6.toISOString(), 'שינוי אחרי סגירת החודש · חושב מחדש ב-06.01.2027'],
      [-1050, a.invoiceId, JAN7.toISOString(), 'שינוי אחרי סגירת החודש · חושב מחדש ב-07.01.2027'],
    ]);
    expect(dec!.correctionsAgorot).toBe(0);
    expect(await snapshots(t.restaurantId)).toEqual([
      { month: '2026-12', version: 1, leak_agorot: '5000', reason: null, created_by: null },
    ]);
  });

  it('the snapshot row cannot be rewritten (0072 append-only backstop)', async () => {
    const t = await tenant('immutable');
    await t.invoice(new Date('2026-12-10T10:00:00Z'), '100', [{ delta: '2' }]);
    await runLeakMonthClose(db, { now: JAN5_0415, restaurantId: t.restaurantId });
    await expect(
      db.execute(sql`UPDATE leak_month_snapshots SET leak_agorot = 0 WHERE restaurant_id = ${t.restaurantId}::uuid`),
    ).rejects.toThrow();
  });
});

describe('slice b: payload v2 (G-14 partition, funnel, caught before payment)', () => {
  it('pure helpers: lastDayOf and funnelOf', () => {
    expect(lastDayOf('2026-12-01')).toBe('2026-12-31');
    expect(lastDayOf('2027-02-01')).toBe('2027-02-28');
    expect(lastDayOf('2028-02-01')).toBe('2028-02-29');
    const states = { undecided: 1, to_offset: 2, to_send: 3, requested: 4, disputed: 5, credited: 6, recovered: 7, waived: 8 };
    expect(funnelOf({ states, totalAgorot: 36 })).toEqual({
      foundAgorot: 36,
      requestedAgorot: 4 + 5 + 6 + 7,
      creditedAgorot: 6 + 7,
      recoveredAgorot: 7,
    });
  });

  it('the frozen partition adds up to the frozen leak; undecided, recovered and the funnel are right', async () => {
    const t = await tenant('v2');
    const a = await t.invoice(new Date('2026-12-10T10:00:00Z'), '1000', []);
    const open = await a.add({ delta: '50' });
    const b = await t.invoice(new Date('2026-12-12T10:00:00Z'), '500', []);
    const back = await b.add({ delta: '20' });
    // A credit request that came back in full.
    await db.execute(sql`
      INSERT INTO recovery_claims (restaurant_id, discrepancy_id, status, amount_agorot, credited_agorot)
      VALUES (${t.restaurantId}::uuid, ${back}::uuid, 'recovered', 2000, 2000)
    `);
    await db.execute(sql`UPDATE discrepancies SET resolution_status = 'accepted', resolved_at = created_at WHERE id = ${back}::uuid`);
    expect(open).toBeTruthy();

    await runLeakMonthClose(db, { now: JAN5_0415, restaurantId: t.restaurantId });
    const dec = await readClosedLeakMonth(db, t.restaurantId, '2026-12');
    expect(dec!.frozenLeakAgorot).toBe(7000);
    expect(dec!.partition).toMatchObject({ totalAgorot: 7000, heroAgorot: 7000, driftAgorot: 0 });
    expect(dec!.partition!.states).toMatchObject({ undecided: 5000, recovered: 2000 });
    expect(dec!.funnel).toEqual({ foundAgorot: 7000, requestedAgorot: 2000, creditedAgorot: 2000, recoveredAgorot: 2000 });
    // Nothing paid yet: every agora was found before payment.
    expect(dec!.caughtBeforePaymentAgorot).toBe(7000);
  });

  it('caught before payment is measured by day, not by status: a gap found after the pay day is not caught', async () => {
    const t = await tenant('caught');
    const early = await t.invoice(new Date('2026-12-03T10:00:00Z'), '300', []);
    const e = await early.add({ delta: '30' });
    const late = await t.invoice(new Date('2026-12-04T10:00:00Z'), '400', []);
    const l = await late.add({ delta: '40' });
    // Both invoices paid on 15.12. The first gap was found on 10.12 (before), the second on 20.12 (after).
    for (const id of [early.invoiceId, late.invoiceId]) {
      await db.execute(sql`
        UPDATE invoices SET status = 'paid', paid_at = '2026-12-14T22:00:00Z', paid_amount = total_incl_vat WHERE id = ${id}::uuid
      `);
    }
    await db.execute(sql`UPDATE discrepancies SET created_at = '2026-12-10T08:00:00Z' WHERE id = ${e}::uuid`);
    await db.execute(sql`UPDATE discrepancies SET created_at = '2026-12-20T08:00:00Z' WHERE id = ${l}::uuid`);

    await runLeakMonthClose(db, { now: JAN5_0415, restaurantId: t.restaurantId });
    const dec = await readClosedLeakMonth(db, t.restaurantId, '2026-12');
    expect(dec!.frozenLeakAgorot).toBe(7000);
    expect(dec!.caughtBeforePaymentAgorot).toBe(3000);
    expect(dec!.payload).toMatchObject({ caughtBeforePayment: { agorot: 3000, onInterimPaidAgorot: 0 } });
  });

  it('a v1 snapshot (written before slice b) is read unchanged next to a v2 one', async () => {
    const t = await tenant('v1read');
    await t.invoice(new Date('2026-11-10T10:00:00Z'), '100', [{ delta: '5' }]);
    await t.invoice(new Date('2026-12-10T10:00:00Z'), '100', [{ delta: '6' }]);
    await db.execute(sql`
      INSERT INTO leak_month_snapshots (restaurant_id, month, version, leak_agorot, payload)
      VALUES (${t.restaurantId}::uuid, '2026-11-01', 1, 500, '{"schema":"leak-month-close/v1","invoices":{}}'::jsonb)
    `);
    await runLeakMonthClose(db, { now: JAN5_0415, restaurantId: t.restaurantId });
    const nov = await readClosedLeakMonth(db, t.restaurantId, '2026-11');
    const dec = await readClosedLeakMonth(db, t.restaurantId, '2026-12');
    expect(nov).toMatchObject({ frozenLeakAgorot: 500, partition: null, funnel: null, caughtBeforePaymentAgorot: null });
    expect(dec).toMatchObject({ frozenLeakAgorot: 600, funnel: { foundAgorot: 600 } });
  });
});
