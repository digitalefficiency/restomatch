import { afterAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, invoices, matchRuns, restaurants, suppliers, testDbUrl, eq } from '@restomatch/db';
import { endOfDayFigures } from '../jobs/endOfDayReport';
import { startOfIlDay } from '../lib/notifyHelpers';

/**
 * Money review G: the 19:00 digest summed |Δ| over EVERY open/escalated finding and
 * every finding made today — a MISSING_ON_INVOICE line and an info line included,
 * never capped. Open credits now follow the claimable rule (warn/block, a leak type —
 * never-claimable types are all outside it — |Δ| > 0, capped per invoice at its total);
 * "caught today" is the hero's LEAK_FILTER with the same cap.
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
let restaurantId = '';

afterAll(async () => {
  if (restaurantId) await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('end-of-day digest ₪ (money review G)', () => {
  it('a MISSING_ON_INVOICE line and an info line are never counted; each invoice is capped at its total', async () => {
    const [r] = await db.insert(restaurants).values({ name: `eod ${RUN}` }).returning();
    restaurantId = r!.id;
    const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ספק' }).returning();
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId, supplierId: s!.id, invoiceNumber: `EOD-${RUN}`, totalInclVat: '100.00', status: 'matched', source: 'photo' })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '660.00' })
      .returning();
    const d = (type: string, severity: string, deltaAmount: string, resolutionStatus = 'open') => ({
      matchRunId: mr!.id,
      restaurantId,
      type: type as 'PRICE_HIGHER',
      severity: severity as 'warn',
      deltaAmount,
      resolutionStatus: resolutionStatus as 'open',
      requiresRole: 'manager' as const,
    });
    await db.insert(discrepancies).values([
      d('PRICE_HIGHER', 'warn', '30.00'),
      d('PRICE_HIGHER', 'block', '90.00', 'escalated'),
      d('MISSING_ON_INVOICE', 'block', '-500.00'),
      d('QTY_SHORT', 'info', '40.00'),
    ]);

    const f = await endOfDayFigures(db, restaurantId, startOfIlDay(new Date()));
    // 30 + 90 = 120, capped at the invoice's ₪100; the ₪500 MISSING_ON_INVOICE and the ₪40 info line never count.
    expect(f).toMatchObject({ openCount: 2, openIls: 100, todayCount: 2, todayIls: 100 });
  });
});
