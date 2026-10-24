import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, isNotNull, matchRuns, memberships, restaurants, testDbUrl, users } from '@restomatch/db';
import { computeLeakBreakdown, computeLeakHero } from '@restomatch/charts';
import { claimableLines } from '../lib/claims';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb } from './fixtures';

/**
 * Dock dispute slip ₪ on the DEMO SEED: per invoice it must equal the supplier
 * claims letters (claimableLines over the month's leak breakdown) to the agora,
 * and per month the slips must add up to the letters' grand total — the slip
 * never invents ₪ from the wizard's client-side estimates.
 */
const db = createDb(testDbUrl());
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let restaurantId = '';
let ownerId = '';

function caller() {
  const ctx: AppContext = { db, session: { userId: ownerId, restaurantId, role: 'owner' } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  // The demo seed exactly as scripts/dev-setup.sh runs it: base data, then the
  // invoices/receipts matched by the real engine (worker seed-demo).
  for (const [pkg, script] of [
    ['@restomatch/db', 'scripts/seed.ts'],
    ['@restomatch/worker', 'scripts/seed-demo.ts'],
  ] as const) {
    const run = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsx', script], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: testDbUrl(), DEMO_TODAY: '2026-10-25' },
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`demo seed (${script}) failed:\n${run.stdout}\n${run.stderr}`);
  }
  const [r] = await db.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  if (!r) throw new Error('demo restaurant missing after seed');
  restaurantId = r.id;
  const [owner] = await db
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.restaurantId, r.id), eq(memberships.role, 'owner')))
    .limit(1);
  ownerId = owner!.id;
}, 180_000);

afterAll(async () => {
  await resetDb(db);
});

describe('receiving.dockSlip on the demo seed', () => {
  it('is enabled for the demo tenant (features.all)', async () => {
    const [run] = await db
      .select({ grId: matchRuns.grId })
      .from(matchRuns)
      .where(and(eq(matchRuns.restaurantId, restaurantId), isNotNull(matchRuns.grId)))
      .limit(1);
    const slip = await caller().receiving.dockSlip({ grId: run!.grId! });
    expect(slip.enabled).toBe(true);
  });

  it('per invoice: slip ₪ = the claims letters ₪, to the agora; per month: Σ slips = Σ letters', async () => {
    const runs = await db
      .selectDistinctOn([matchRuns.invoiceId], { invoiceId: matchRuns.invoiceId, grId: matchRuns.grId })
      .from(matchRuns)
      .where(and(eq(matchRuns.restaurantId, restaurantId), isNotNull(matchRuns.grId), isNotNull(matchRuns.invoiceId)));
    expect(runs.length).toBeGreaterThan(5);

    const hero = await computeLeakHero(db, restaurantId, { now: new Date('2026-10-25T09:00:00Z') });
    const breakdown = await computeLeakBreakdown(db, restaurantId, { now: new Date('2026-10-25T09:00:00Z'), limit: 200 });
    const letterByInvoice = new Map(
      breakdown.map((inv) => [inv.invoiceId, claimableLines(inv).reduce((s, c) => s + Math.round(c.amount * 100), 0)]),
    );

    let slipsAgorot = 0;
    let withMoney = 0;
    for (const r of runs) {
      const slip = await caller().receiving.dockSlip({ grId: r.grId!, invoiceId: r.invoiceId! });
      if (!slip.enabled) throw new Error('flag off');
      expect(slip.engine.ready).toBe(true);
      const agorot = Math.round(slip.engine.totalIls * 100);
      // Σ lines = total, exactly.
      expect(slip.engine.lines.reduce((s, l) => s + Math.round(l.amountIls * 100), 0)).toBe(agorot);
      const letter = letterByInvoice.get(r.invoiceId!);
      if (letter !== undefined) {
        expect(agorot, `invoice ${r.invoiceId}`).toBe(letter);
        slipsAgorot += agorot;
      }
      if (agorot > 0) withMoney += 1;
    }
    expect(withMoney).toBeGreaterThan(0);
    const lettersAgorot = [...letterByInvoice.values()].reduce((s, v) => s + v, 0);
    expect(slipsAgorot).toBe(lettersAgorot);
    // …and never more than the month's hero leak.
    expect(lettersAgorot).toBeLessThanOrEqual(Math.round(hero.leakIls * 100));
  }, 120_000);
});
