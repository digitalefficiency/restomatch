/**
 * W2-14 exports.summary: what the export will contain, before the download.
 * Counts, ₪ total, open gaps and ₪ in dispute (latest match run only), and the
 * CSV's localised status + "₪ במחלוקת" columns.
 */
import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
const PERIOD = { from: '2000-01-01', to: '2100-12-31' };

function callerFor(role: Session['role']) {
  const session: Session = { userId: A.ownerUserId, restaurantId: A.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('exports.summary (W2-14)', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    // The seed: one matched invoice, ₪117 incl. VAT, latest run has one open ₪100 gap.
    await db.update(invoices).set({ status: 'disputed' }).where(eq(invoices.id, A.invoiceId));
    // A second, resolved gap on the same run must not count.
    await db.insert(discrepancies).values({
      matchRunId: A.matchRunId,
      restaurantId: A.restaurantId,
      type: 'QTY_SHORT',
      severity: 'warn',
      deltaAmount: '-12.34',
      requiresRole: 'manager',
      resolutionStatus: 'escalated',
    });
    await db.insert(discrepancies).values({
      matchRunId: A.matchRunId,
      restaurantId: A.restaurantId,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      deltaAmount: '999.00',
      requiresRole: 'manager',
      resolutionStatus: 'resolved',
    });
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('reports count, ₪ total, open-gap count and ₪ in dispute (|Δ|, open + escalated only)', async () => {
    const s = await callerFor('bookkeeper').exports.summary(PERIOD);
    expect(s).toMatchObject({
      invoiceCount: 1,
      totalInclVat: '117.00',
      disputedCount: 1,
      withOpenGapCount: 1,
      amountInDispute: '112.34',
      undatedCount: 0,
    });
  });

  it('only the LATEST match run counts', async () => {
    const [run] = await db
      .insert(matchRuns)
      .values({
        restaurantId: A.restaurantId,
        invoiceId: A.invoiceId,
        overallStatus: 'clean',
        totalDiscrepancyAmount: '0.00',
        runAt: new Date(Date.now() + 60_000),
      })
      .returning();
    const s = await callerFor('owner').exports.summary(PERIOD);
    expect(s.withOpenGapCount).toBe(0);
    expect(s.amountInDispute).toBe('0.00');
    await db.delete(matchRuns).where(eq(matchRuns.id, run!.id));
  });

  it('the CSV keeps the raw status and adds the localised status and ₪ in dispute', async () => {
    const csv = await callerFor('bookkeeper').exports.invoicesCsv(PERIOD);
    const [header, row] = csv.content.split('\n');
    expect(header).toContain('סטטוס,מצב,₪ במחלוקת');
    expect(row).toContain('disputed,פער פתוח,112.34');
  });

  it('is FORBIDDEN for a receiver (receivers never reach exports)', async () => {
    await expect(callerFor('receiver').exports.summary(PERIOD)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
