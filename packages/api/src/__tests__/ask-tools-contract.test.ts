import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, matchRuns, testDbUrl } from '@restomatch/db';
import { awaitingDecision } from '../approvals/awaiting';
import { plainLabel } from '../ask/periods';
import { runTool, TOOL_DEFINITIONS } from '../ask/tools';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-12b — the Ask tool contract: every period tool says which days its figures
 * cover; the comparison tool exists and is like for like; no description
 * invites comparing months by hand; no target / 1.5 % anywhere; the claimable
 * facts are awaitingDecision's (no month window, no limit, ₪ per basis).
 */
const db = createDb(testDbUrl());
let A: Tenant;
const NOW = new Date('2026-10-25T09:00:00Z');

const PERIOD_TOOLS = TOOL_DEFINITIONS.filter(
  (t) => 'month' in (t.input_schema.properties as object),
).map((t) => t.name);

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'contract');
});

/** Every key name anywhere in a value. */
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) (out.push(k), keysOf(x, out));
  return out;
}

describe('Ask tools contract', () => {
  it('the period tools are leak_hero, leak_report, leak_breakdown and leak_change', () => {
    expect([...PERIOD_TOOLS].sort()).toEqual([
      'leak_breakdown',
      'leak_change',
      'leak_hero',
      'leak_report',
    ]);
  });

  it.each(PERIOD_TOOLS)('%s returns {from, through, complete} with its figures', async (name) => {
    const out = await runTool(
      name,
      {},
      { db, restaurantId: A.restaurantId, now: NOW, locale: 'he' },
    );
    const period = (out.data as { period?: unknown }).period;
    expect(period).toEqual({ from: '2026-10-01', through: '2026-10-25', complete: false });
    expect(out.period).toMatchObject({
      from: '2026-10-01',
      through: '2026-10-25',
      complete: false,
    });
    // A closed month is complete and covers the whole month.
    const closed = await runTool(
      name,
      { month: '2026-09' },
      { db, restaurantId: A.restaurantId, now: NOW, locale: 'he' },
    );
    if (name !== 'leak_change') {
      expect((closed.data as { period: unknown }).period).toEqual({
        from: '2026-09-01',
        through: '2026-09-30',
        complete: true,
      });
    } else {
      expect(closed.data).toMatchObject({
        period: { from: '2026-09-01', through: '2026-09-30', complete: true },
        comparedWith: { from: '2026-08-01', through: '2026-08-31', complete: true },
      });
    }
  });

  it('leak_change is like for like and ships its span label and both coverages', async () => {
    const out = await runTool(
      'leak_change',
      {},
      { db, restaurantId: A.restaurantId, now: NOW, locale: 'he' },
    );
    expect(out.data).toMatchObject({
      period: { from: '2026-10-01', through: '2026-10-25', complete: false },
      comparedWith: { from: '2026-09-01', through: '2026-09-25', complete: false },
    });
    expect(plainLabel((out.data as { spanLabel: string }).spanLabel)).toBe('1–25 באוק׳ מול 1–25 בספט׳');
    expect(out.comparison?.labels.map(plainLabel)).toContain('1–25 באוק׳ מול 1–25 בספט׳');
  });

  it('no description invites comparing months by hand; recoveredIls is "accepted for claim"', () => {
    for (const t of TOOL_DEFINITIONS) expect(t.description, t.name).not.toMatch(/compare months/i);
    const hero = TOOL_DEFINITIONS.find((t) => t.name === 'leak_hero')!;
    expect(hero.description).toMatch(/recoveredIls \(₪ accepted for claim/);
  });

  it('no tool output field is named target, and nothing mentions 1.5 % or a goal', async () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description, t.name).not.toMatch(/1\.5\s*%|target|יעד/i);
      const out = await runTool(
        t.name,
        {},
        { db, restaurantId: A.restaurantId, now: NOW, locale: 'he' },
      );
      expect(
        keysOf(out.data).filter((k) => /target|goal/i.test(k)),
        t.name,
      ).toEqual([]);
      expect(JSON.stringify(out.data), t.name).not.toMatch(/1\.5\s*%|יעד/);
    }
  });

  it('claimable_lines = awaitingDecision: every open row, no month window, ₪ per basis', async () => {
    // An old open row (a year back) still counts: no month window, no limit.
    const [old] = await db
      .insert(matchRuns)
      .values({
        restaurantId: A.restaurantId,
        invoiceId: A.invoiceId,
        overallStatus: 'major',
        totalDiscrepancyAmount: '0',
      })
      .returning();
    await db.insert(discrepancies).values({
      restaurantId: A.restaurantId,
      matchRunId: old!.id,
      type: 'DUPLICATE_INVOICE',
      severity: 'warn',
      deltaAmount: '50.00',
      requiresRole: 'bookkeeper',
      resolutionStatus: 'open',
    });
    const out = await runTool(
      'claimable_lines',
      {},
      { db, restaurantId: A.restaurantId, now: NOW, locale: 'he' },
    );
    const a = await awaitingDecision(
      db,
      { session: { restaurantId: A.restaurantId, role: 'manager' } },
      { scope: 'all' },
    );
    const d = out.data as { totalIls: number; duplicateInclVatIls: number; vatIls: number };
    expect(d.totalIls).toBe(a.ils!.excl);
    expect(d.duplicateInclVatIls).toBe(a.ils!.incl);
    expect(d.vatIls).toBe(a.ils!.vat);
    expect(d.duplicateInclVatIls).toBeGreaterThan(0);
  });
});
