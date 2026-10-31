import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  restaurants,
  testDbUrl,
} from '@restomatch/db';
import { leakComparison } from '../ask/compare';
import {
  alignedWindows,
  comparisonLabel,
  fairlyComparable,
  monthKey,
  monthPeriod,
  plainLabel,
  spanLabel,
} from '../ask/periods';
import { runTool } from '../ask/tools';
import { offlineAnswer } from '../ask/offline';
import { resetDb, seedTenant } from './fixtures';

/**
 * G-12b — Ask's periods: every window in the restaurant's time zone, like for
 * like (the same days of the previous month), labelled.
 */
const IL = 'Asia/Jerusalem';
const at = (iso: string) => new Date(iso);

describe('aligned windows — case table', () => {
  it.each([
    // [now (UTC), tz, cur, prev, label he]
    [
      '25.10 → 1–25.09',
      '2026-10-25T09:00:00Z',
      IL,
      ['2026-10-01', '2026-10-25'],
      ['2026-09-01', '2026-09-25'],
      '1–25 באוק׳ מול 1–25 בספט׳',
    ],
    [
      '30.10 → 1–30.09 (not 1–29)',
      '2026-10-30T09:00:00Z',
      IL,
      ['2026-10-01', '2026-10-30'],
      ['2026-09-01', '2026-09-30'],
      '1–30 באוק׳ מול 1–30 בספט׳',
    ],
    [
      '31.10 → 1–30.09 (clamped)',
      '2026-10-31T09:00:00Z',
      IL,
      ['2026-10-01', '2026-10-31'],
      ['2026-09-01', '2026-09-30'],
      '1–31 באוק׳ מול 1–30 בספט׳',
    ],
    [
      'January → December',
      '2027-01-12T09:00:00Z',
      IL,
      ['2027-01-01', '2027-01-12'],
      ['2026-12-01', '2026-12-12'],
      '1–12 בינו׳ מול 1–12 בדצמ׳',
    ],
    [
      '31.03 → 1–28.02',
      '2027-03-31T09:00:00Z',
      IL,
      ['2027-03-01', '2027-03-31'],
      ['2027-02-01', '2027-02-28'],
      '1–31 במרץ מול 1–28 בפבר׳',
    ],
    // Israel leaves DST on Sun 25.10.2026 at 02:00: 22:30Z on the 24th is already 01:30 on the 25th.
    [
      'DST weekend: 24.10 22:30Z is 25.10 local',
      '2026-10-24T22:30:00Z',
      IL,
      ['2026-10-01', '2026-10-25'],
      ['2026-09-01', '2026-09-25'],
      '1–25 באוק׳ מול 1–25 בספט׳',
    ],
    [
      'after DST: 31.10 21:59Z is still 31.10 (UTC+2)',
      '2026-10-31T21:59:00Z',
      IL,
      ['2026-10-01', '2026-10-31'],
      ['2026-09-01', '2026-09-30'],
      '1–31 באוק׳ מול 1–30 בספט׳',
    ],
    [
      'after DST: 31.10 22:00Z is 1.11 local',
      '2026-10-31T22:00:00Z',
      IL,
      ['2026-11-01', '2026-11-01'],
      ['2026-10-01', '2026-10-01'],
      '1 בנוב׳ מול 1 באוק׳',
    ],
    [
      'a restaurant in New York: 1.11 02:00Z is still 31.10',
      '2026-11-01T02:00:00Z',
      'America/New_York',
      ['2026-10-01', '2026-10-31'],
      ['2026-09-01', '2026-09-30'],
      '1–31 באוק׳ מול 1–30 בספט׳',
    ],
  ] as const)('%s', (_name, now, tz, cur, prev, label) => {
    const w = alignedWindows(at(now), tz);
    expect([w.cur.from, w.cur.through]).toEqual(cur);
    expect([w.prev.from, w.prev.through]).toEqual(prev);
    expect(w.cur.complete).toBe(false);
    expect(plainLabel(comparisonLabel(w.cur, w.prev, 'he'))).toBe(label);
    // The digits of a span never break across lines (word joiners around the dash).
    expect(comparisonLabel(w.cur, w.prev, 'he')).not.toMatch(/\d–|–\d/);
    expect(fairlyComparable(w.cur, w.prev)).toBe(true);
  });

  it('a closed month compares in full with the full month before it', () => {
    const w = alignedWindows(at('2026-10-25T09:00:00Z'), IL, -1);
    expect(w.cur).toEqual({ from: '2026-09-01', through: '2026-09-30', complete: true });
    expect(w.prev).toEqual({ from: '2026-08-01', through: '2026-08-31', complete: true });
    expect(fairlyComparable(w.cur, w.prev)).toBe(true);
  });

  it('monthKey / monthPeriod take the restaurant time zone', () => {
    const now = at('2026-11-01T02:00:00Z'); // Israel: 1.11 04:00 · New York: 31.10 22:00
    expect(monthKey(0, now, IL)).toBe('2026-11');
    expect(monthKey(0, now, 'America/New_York')).toBe('2026-10');
    expect(monthKey(-1, at('2027-01-05T09:00:00Z'), IL)).toBe('2026-12');
    expect(monthPeriod(0, now, 'America/New_York')).toEqual({
      from: '2026-10-01',
      through: '2026-10-31',
      complete: false,
    });
    expect(monthPeriod(-1, now, IL)).toEqual({
      from: '2026-10-01',
      through: '2026-10-31',
      complete: true,
    });
  });

  it('a month to date against a full month is NOT a fair comparison', () => {
    const cur = monthPeriod(0, at('2026-10-25T09:00:00Z'), IL);
    const fullSep = monthPeriod(-1, at('2026-10-25T09:00:00Z'), IL);
    expect(fairlyComparable(cur, fullSep)).toBe(false);
    expect(plainLabel(spanLabel(fullSep, 'en'))).toBe('Sep 1–30');
    expect(plainLabel(comparisonLabel(cur, fullSep, 'en'))).toBe('Oct 1–25 vs Sep 1–30');
  });
});

const db = createDb(testDbUrl());

describe('periods on real data', () => {
  beforeAll(async () => {
    await resetDb(db);
  });

  it('every period tool output carries {from, through, complete} in the restaurant time zone', async () => {
    const t = await seedTenant(db, 'tz');
    await db
      .update(restaurants)
      .set({ timezone: 'America/New_York' })
      .where(eq(restaurants.id, t.restaurantId));
    const now = at('2026-11-01T02:00:00Z');
    const out = await runTool('leak_hero', {}, { db, restaurantId: t.restaurantId, now });
    expect((out.data as { period: unknown }).period).toEqual({
      from: '2026-10-01',
      through: '2026-10-31',
      complete: false,
    });
    expect(out.period).toEqual({ from: '2026-10-01', through: '2026-10-31', complete: false });
  });

  it('a late invoice of last month counts in last month’s span (by invoice date, not entry date)', async () => {
    const t = await seedTenant(db, 'late');
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: t.restaurantId,
        source: 'manual',
        status: 'matched',
        totalInclVat: '500.00',
        totalExclVat: '427.35',
        invoiceDate: new Date('2026-09-20T09:00:00Z'),
        createdAt: new Date('2026-10-10T09:00:00Z'),
      })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({
        restaurantId: t.restaurantId,
        invoiceId: inv!.id,
        overallStatus: 'major',
        totalDiscrepancyAmount: '40',
      })
      .returning();
    await db.insert(discrepancies).values({
      restaurantId: t.restaurantId,
      matchRunId: mr!.id,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      deltaAmount: '40.00',
      requiresRole: 'owner',
      resolutionStatus: 'open',
    });
    // Entered on 10.10, dated 20.09: on 25.10 it sits in the 1–25.09 span.
    const c = await leakComparison(db, t.restaurantId, at('2026-10-25T09:00:00Z'), 'he');
    expect(c.prev).toMatchObject({ from: '2026-09-01', through: '2026-09-25' });
    expect(c.prev.leakIls).toBe(40);
    expect(plainLabel(c.spanLabel)).toBe('1–25 באוק׳ מול 1–25 בספט׳');
  });
});

/* ─────────────── the lab's fair delta (demo seed, 25.10) ─────────────── */

describe('lab invariant: the fair delta on 25.10', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  let rid = '';
  beforeAll(async () => {
    await resetDb(db);
    for (const [pkg, script] of [
      ['@restomatch/db', 'scripts/seed.ts'],
      ['@restomatch/worker', 'scripts/seed-demo.ts'],
    ] as const) {
      const r = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsx', script], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: testDbUrl(), DEMO_TODAY: '2026-10-25' },
        encoding: 'utf8',
      });
      if (r.status !== 0)
        throw new Error(`demo seed (${script}) failed:\n${r.stdout}\n${r.stderr}`);
    }
    const [r] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.name, 'כפר הזיתים'))
      .limit(1);
    rid = r!.id;
  }, 180_000);
  afterAll(async () => {
    await resetDb(db);
  });

  it('₪759.54 (1–25 Oct) vs ₪773.89 (1–25 Sep) = −₪14.35, never a month to date against all of September', async () => {
    const now = at('2026-10-25T09:00:00Z');
    const c = await leakComparison(db, rid, now, 'he');
    expect(c.cur.leakIls).toBe(759.54);
    expect(c.prev.leakIls).toBe(773.89);
    expect(c.deltaIls).toBe(-14.35);
    expect(plainLabel(c.spanLabel)).toBe('1–25 באוק׳ מול 1–25 בספט׳');
    // The offline answer and the leak_change tool use the same function: same facts.
    const off = await offlineAnswer(db, rid, 'מה השתנה בדליפה החודש?', now, 'he');
    expect(off.intent).toBe('leakChange');
    expect(off.facts).toMatchObject({
      leakIls: 759.54,
      prevLeakIls: 773.89,
      deltaIls: -14.35,
    });
    expect(plainLabel(String(off.facts.prevSpanLabel))).toBe('1–25 בספט׳');
    const tool = await runTool('leak_change', {}, { db, restaurantId: rid, now, locale: 'he' });
    expect(tool.data).toMatchObject({
      leakIls: 759.54,
      prevLeakIls: 773.89,
      deltaIls: -14.35,
      spanLabel: c.spanLabel,
    });
  });
});
