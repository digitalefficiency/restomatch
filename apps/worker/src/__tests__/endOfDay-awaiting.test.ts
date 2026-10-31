import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, notificationsOutbox, restaurants, sql, testDbUrl } from '@restomatch/db';
import { awaitingDecision, claimableLines, formatIlsAgorot } from '@restomatch/api';
import { computeInvoiceLeak } from '@restomatch/charts';
import { processEndOfDayReport } from '../jobs/endOfDayReport';
import { approvalsGoLink, invoiceClaimAgorot } from '../jobs/matchInvoice';

/**
 * W2-04 §5.11-12 (deep-fix class 5): the end-of-day digest's "awaiting
 * decision" count and ₪ ARE `awaitingDecision` — the same figure as the queue
 * tiles, home and the badge — and every approval link is branch-aware.
 * Runs on the demo seed (DEMO_TODAY 2026-10-25).
 */
const db = createDb(testDbUrl());
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
let restaurantId = '';

beforeAll(async () => {
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
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  restaurantId = r!.id;
}, 180_000);

describe('end-of-day digest = awaitingDecision', () => {
  it('count and ₪ equal awaitingDecision (scope all), and the link is the branch-aware go-link', async () => {
    const awaiting = await awaitingDecision(db, { session: { restaurantId, role: 'owner' } }, { scope: 'all' });
    expect(awaiting.count).toBeGreaterThan(0);
    process.env.DATABASE_URL = testDbUrl();
    await processEndOfDayReport({
      id: 'eod-test',
      name: 'end-of-day-report',
      data: { restaurantId, forDate: '2026-10-25T16:00:00Z' },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    const rows = await db
      .select()
      .from(notificationsOutbox)
      .where(and(eq(notificationsOutbox.restaurantId, restaurantId), eq(notificationsOutbox.relatedEntityType, 'restaurant')));
    expect(rows.length).toBeGreaterThan(0);
    const body = rows[0]!.body;
    const ils = formatIlsAgorot(Math.round((awaiting.ils?.excl ?? 0) * 100), { maximumFractionDigits: 0 });
    expect(body).toContain(ils);
    expect(body).toContain(String(awaiting.count));
    expect(body).toContain(approvalsGoLink(restaurantId, null).replace(/^https?:\/\/[^/]+/, ''));
    expect(rows.every((r) => !r.target.startsWith('role:'))).toBe(true);
  });
});

describe('match-invoice notification copy', () => {
  it('₪ = Σ claimableLines(computeInvoiceLeak(id)) for an invoice with open gaps', async () => {
    const awaiting = await awaitingDecision(db, { session: { restaurantId, role: 'owner' } }, { scope: 'all' });
    expect(awaiting.count).toBeGreaterThan(0);
    const [{ invoice_id: invoiceId }] = (await db.execute(sql`
      SELECT mr.invoice_id FROM discrepancies d JOIN match_runs mr ON mr.id = d.match_run_id
      WHERE d.restaurant_id = ${restaurantId} AND d.resolution_status IN ('open','escalated') AND mr.invoice_id IS NOT NULL
      ORDER BY abs(d.delta_amount) DESC LIMIT 1`)) as unknown as Array<{ invoice_id: string }>;
    const inv = await computeInvoiceLeak(db, restaurantId, invoiceId);
    const expected = claimableLines(inv!).reduce((n, c) => n + Math.round(c.amount * 100), 0);
    expect(await invoiceClaimAgorot(db, restaurantId, invoiceId)).toBe(expected);
  });

});
