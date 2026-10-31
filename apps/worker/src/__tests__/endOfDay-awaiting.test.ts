import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, notificationsOutbox, restaurants, sql, testDbUrl } from '@restomatch/db';
import { awaitingDecision, claimableLines, formatIlsAgorot, materializeClaims } from '@restomatch/api';
import { computeInvoiceLeak } from '@restomatch/charts';
import { processEndOfDayReport } from '../jobs/endOfDayReport';
import { approvalsGoLink, invoiceClaimAgorot, matchInvoiceForJob } from '../jobs/matchInvoice';

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
    const [{ invoice_id: invoiceId } = { invoice_id: '' }] = (await db.execute(sql`
      SELECT mr.invoice_id FROM discrepancies d JOIN match_runs mr ON mr.id = d.match_run_id
      WHERE d.restaurant_id = ${restaurantId} AND d.resolution_status IN ('open','escalated') AND mr.invoice_id IS NOT NULL
      ORDER BY abs(d.delta_amount) DESC LIMIT 1`)) as unknown as Array<{ invoice_id: string }>;
    const inv = await computeInvoiceLeak(db, restaurantId, invoiceId);
    const expected = claimableLines(inv!).reduce((n, c) => n + Math.round(c.amount * 100), 0);
    expect(await invoiceClaimAgorot(db, restaurantId, invoiceId)).toBe(expected);
  });

});

describe('match-invoice re-match keeps claims honest (W2-04 §8)', () => {
  async function decidedInvoice() {
    const [row = null] = (await db.execute(sql`
      SELECT d.id, mr.invoice_id, m.user_id
      FROM discrepancies d
      JOIN match_runs mr ON mr.id = d.match_run_id
      JOIN memberships m ON m.restaurant_id = d.restaurant_id AND m.role = 'manager'
      WHERE d.restaurant_id = ${restaurantId} AND d.resolution_status IN ('open','escalated')
        AND d.severity IN ('warn','block') AND d.type = 'PRICE_HIGHER' AND mr.invoice_id IS NOT NULL
      ORDER BY abs(d.delta_amount) DESC LIMIT 1`)) as unknown as Array<{ id: string; invoice_id: string; user_id: string }>;
    return row!;
  }

  it('releases the bare claim before deleting runs and rebinds it to the ORIGINAL decider', async () => {
    const { id, invoice_id: invoiceId, user_id: decider } = await decidedInvoice();
    await db.transaction(async (raw) => {
      const tx = raw as unknown as typeof db;
      await tx.execute(sql`UPDATE discrepancies SET resolution_status = 'accepted', resolved_by = ${decider}::uuid, resolved_at = now() WHERE id = ${id}::uuid`);
      await materializeClaims(tx, { restaurantId, discrepancyIds: [id], actorId: decider });
    });
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true });
    if (!out.persisted) throw new Error(`re-match skipped: ${out.skipped}`);
    const rows = (await db.execute(sql`
      SELECT c.created_by, d.resolution_status FROM recovery_claims c
      JOIN discrepancies d ON d.id = c.discrepancy_id
      JOIN match_runs mr ON mr.id = d.match_run_id
      WHERE mr.invoice_id = ${invoiceId}::uuid`)) as unknown as Array<{ created_by: string; resolution_status: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.created_by === decider && r.resolution_status === 'accepted')).toBe(true);
  });

  it('a claim with money history refuses the re-match with CONFLICT (surfaced, not swallowed)', async () => {
    const [inv] = (await db.execute(sql`
      SELECT mr.invoice_id FROM recovery_claims c JOIN discrepancies d ON d.id = c.discrepancy_id
      JOIN match_runs mr ON mr.id = d.match_run_id WHERE c.restaurant_id = ${restaurantId} LIMIT 1`)) as unknown as Array<{ invoice_id: string }>;
    await db.execute(sql`UPDATE recovery_claims SET letter_sent_at = now() WHERE invoice_id = ${inv!.invoice_id}::uuid`);
    await expect(matchInvoiceForJob(db, { restaurantId, invoiceId: inv!.invoice_id, rematch: true })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
