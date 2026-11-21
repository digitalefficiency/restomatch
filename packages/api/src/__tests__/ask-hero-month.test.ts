import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, testDbUrl } from '@restomatch/db';
import { computeLeakHero, computeLeakReport } from '@restomatch/charts';
import { heroMonthKey, reportData } from '../ask/tools';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * The Ask hero's month label (day-boundary audit): computeLeakHero returns the
 * month bounds as UTC instants of Israel midnight, so a slice of monthStart
 * named the previous month at every hour, and the previous year in January.
 */
describe('heroMonthKey', () => {
  it('names the local month from the bounds, not the UTC slice of monthStart', () => {
    // November 2026 in Israel (IST, UTC+2): starts 31.10 22:00Z.
    expect(
      heroMonthKey({
        monthStart: '2026-10-31T22:00:00.000Z',
        monthEnd: '2026-11-30T22:00:00.000Z',
      }),
    ).toBe('2026-11');
    // January 2027: starts 31.12.2026 22:00Z (the old slice said 2026-12).
    expect(
      heroMonthKey({
        monthStart: '2026-12-31T22:00:00.000Z',
        monthEnd: '2027-01-31T22:00:00.000Z',
      }),
    ).toBe('2027-01');
    // A summer month (IDT, UTC+3) and a UTC restaurant.
    expect(
      heroMonthKey({
        monthStart: '2026-06-30T21:00:00.000Z',
        monthEnd: '2026-07-31T21:00:00.000Z',
      }),
    ).toBe('2026-07');
    expect(
      heroMonthKey({
        monthStart: '2026-03-01T00:00:00.000Z',
        monthEnd: '2026-04-01T00:00:00.000Z',
      }),
    ).toBe('2026-03');
  });
});

describe('Ask leak_hero month with real bounds (computeLeakHero)', () => {
  const db = createDb(testDbUrl());
  let A: Tenant;
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('20.11.2026 midday Israel → 2026-11', async () => {
    const hero = await computeLeakHero(db, A.restaurantId, {
      now: new Date('2026-11-20T10:00:00Z'),
    });
    expect(heroMonthKey(hero)).toBe('2026-11');
  });

  it('1.1.2027 00:30 Israel (31.12 22:30Z) → 2027-01, and last month → 2026-12', async () => {
    const now = new Date('2026-12-31T22:30:00Z');
    expect(heroMonthKey(await computeLeakHero(db, A.restaurantId, { now }))).toBe('2027-01');
    expect(heroMonthKey(await computeLeakHero(db, A.restaurantId, { now, monthOffset: -1 }))).toBe(
      '2026-12',
    );
  });

  it('the hero block inside leak_report carries its own month (Jan 2027 too)', async () => {
    for (const month of ['2026-11', '2027-01']) {
      const r = reportData(await computeLeakReport(db, A.restaurantId, month));
      expect(r.hero.month).toBe(month);
    }
  });
});
