import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  invoiceLines,
  invoices,
  matchRuns,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakSummary, VIEW_PERIODS, type ViewSpec } from '../leak-views';
import { computeLeakComparison, localToday, measuredStateOf, resolveWindow } from '../period';

const db = createDb(testDbUrl());
async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(suppliers);
  await db.delete(restaurants);
}
beforeEach(resetDb);
afterAll(resetDb);

const at = (s: string) => new Date(s);

describe('resolveWindow (pure, Asia/Jerusalem)', () => {
  it('at 25.10 the running month is 1–25 Oct vs 1–25 Sep', () => {
    expect(resolveWindow({ period: 'this_month' }, at('2026-10-25T12:00:00+03:00'))).toEqual({
      current: { from: '2026-10-01', to: '2026-10-25' },
      previous: { from: '2026-09-01', to: '2026-09-25' },
      running: true,
    });
  });

  it('a closed month is full vs full', () => {
    expect(resolveWindow({ period: 'last_month' }, at('2026-10-25T12:00:00+03:00'))).toEqual({
      current: { from: '2026-09-01', to: '2026-09-30' },
      previous: { from: '2026-08-01', to: '2026-08-31' },
      running: false,
    });
  });

  it('Jerusalem midnight decides "today", not UTC', () => {
    // 21:30Z on 24.10 is 00:30 on 25.10 in Jerusalem (+03:00 until 25.10).
    expect(localToday(at('2026-10-24T21:30:00Z'), 'Asia/Jerusalem')).toBe('2026-10-25');
    expect(resolveWindow({ period: 'this_month' }, at('2026-10-24T21:30:00Z')).current.to).toBe('2026-10-25');
    // 21:30Z on 31.10 is already 1.11 (+02:00 after DST): a new month, day 1 vs day 1.
    expect(resolveWindow({ period: 'this_month' }, at('2026-10-31T22:30:00Z'))).toMatchObject({
      current: { from: '2026-11-01', to: '2026-11-01' },
      previous: { from: '2026-10-01', to: '2026-10-01' },
    });
  });

  it('the previous window is clamped to the shorter month (30.10, 31.10, 31.03)', () => {
    const prevOf = (iso: string) => resolveWindow({ period: 'this_month' }, at(iso)).previous;
    expect(prevOf('2026-10-30T12:00:00+02:00')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(prevOf('2026-10-31T12:00:00+02:00')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(prevOf('2026-03-31T12:00:00+03:00')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(prevOf('2028-03-31T12:00:00+03:00')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('ytd and custom shift by their length', () => {
    expect(resolveWindow({ period: 'custom', from: '2026-10-10', to: '2026-10-19' }, at('2026-10-25T12:00:00+03:00'))).toEqual({
      current: { from: '2026-10-10', to: '2026-10-19' },
      previous: { from: '2026-09-30', to: '2026-10-09' },
      running: false,
    });
  });
});

describe('resolveWindow mirrors the SQL bounds (boundsCte), every period', () => {
  const localDate = (iso: string) => localToday(new Date(iso), 'Asia/Jerusalem');
  const lastDay = (isoExclusive: string) => localDate(new Date(new Date(isoExclusive).getTime() - 1).toISOString());

  for (const nowIso of ['2026-10-25T12:00:00+03:00', '2026-10-31T12:00:00+02:00', '2026-03-31T12:00:00+03:00', '2026-01-01T08:00:00+02:00']) {
    it(`now ${nowIso}`, async () => {
      const [r] = await db.insert(restaurants).values({ name: 'Period Bistro' }).returning();
      for (const period of VIEW_PERIODS) {
        // A custom range is always in the past (the UI caps it at today): 14 to 5 days ago.
        const today = localDate(nowIso);
        const daysAgo = (n: number) => localDate(new Date(new Date(`${today}T12:00:00Z`).getTime() - n * 86_400_000).toISOString());
        const view: ViewSpec =
          period === 'custom' ? { period, from: daysAgo(14), to: daysAgo(5) } : { period, now: new Date(nowIso) };
        const spec = { ...view, now: new Date(nowIso) };
        const w = resolveWindow(view, spec.now);
        const cur = await computeLeakSummary(db, r!.id, spec, 'off');
        const prev = await computeLeakSummary(db, r!.id, spec, 'prev');
        // The current SQL window ends at the period's natural end; the pure one cuts a running period at today.
        expect([period, localDate(cur.monthStart)]).toEqual([period, w.current.from]);
        expect([period, localDate(prev.monthStart), lastDay(prev.monthEnd)]).toEqual([period, w.previous.from, w.previous.to]);
      }
    });
  }
});

describe('computeLeakComparison', () => {
  async function seed() {
    const [r] = await db.insert(restaurants).values({ name: 'Compare Bistro' }).returning();
    const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק' }).returning();
    let n = 0;
    async function inv(date: string, opts: { matched: boolean; delta?: string }) {
      n += 1;
      const [i] = await db
        .insert(invoices)
        .values({
          restaurantId: r!.id, supplierId: s!.id, invoiceNumber: `C-${n}`, invoiceDate: new Date(date),
          totalExclVat: '1000', vatAmount: '0', totalInclVat: '1000', status: 'matched', source: 'photo',
        })
        .returning();
      if (!opts.matched) return;
      const [mr] = await db
        .insert(matchRuns)
        .values({ restaurantId: r!.id, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
        .returning();
      if (opts.delta) {
        await db.insert(discrepancies).values({
          restaurantId: r!.id, matchRunId: mr!.id, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: opts.delta,
        });
      }
    }
    return { rid: r!.id, inv };
  }
  const NOW = at('2026-10-25T12:00:00+03:00');

  it('same-span windows, Δ in agorot, coverage per window and the partial state', async () => {
    const { rid, inv } = await seed();
    await inv('2026-10-10T09:00:00Z', { matched: true, delta: '80.50' });
    await inv('2026-10-12T09:00:00Z', { matched: false }); // not checked yet → partial
    await inv('2026-09-10T09:00:00Z', { matched: true, delta: '50' });
    await inv('2026-09-28T09:00:00Z', { matched: true, delta: '999' }); // after 25.09: outside the previous window
    const c = await computeLeakComparison(db, rid, { period: 'this_month', now: NOW });
    expect(c.running).toBe(true);
    expect([c.current.from, c.current.to, c.previous.from, c.previous.to]).toEqual(['2026-10-01', '2026-10-25', '2026-09-01', '2026-09-25']);
    expect([c.current.leakIls, c.previous.leakIls, c.deltaAgorot]).toEqual([80.5, 50, 3050]);
    expect([c.current.checked, c.current.invoices, c.current.state]).toEqual([1, 2, 'partial']);
    expect([c.previous.checked, c.previous.invoices, c.previous.state]).toEqual([1, 1, 'leak']);
    // 50% vs 100% checked: the % would mislead, so it is hidden.
    expect([c.comparable, c.deltaPct]).toEqual([false, null]);
  });

  it('comparable coverage shows the relative change', async () => {
    const { rid, inv } = await seed();
    await inv('2026-10-10T09:00:00Z', { matched: true, delta: '75' });
    await inv('2026-09-10T09:00:00Z', { matched: true, delta: '50' });
    const c = await computeLeakComparison(db, rid, { period: 'this_month', now: NOW });
    expect([c.comparable, c.deltaPct, c.current.state]).toEqual([true, 0.5, 'leak']);
  });

  it('measuredStateOf: unknown is never ₪0 clean', () => {
    expect(measuredStateOf({ leakIls: 0, checked: 0, invoices: 3 })).toBe('noData');
    expect(measuredStateOf({ leakIls: 0, checked: 3, invoices: 3 })).toBe('clean');
    expect(measuredStateOf({ leakIls: 10, checked: 1, invoices: 13 })).toBe('partial');
  });
});
