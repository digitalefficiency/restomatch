import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, notificationsOutbox, recoveryClaims, recoveryEvents, restaurants, testDbUrl } from '@restomatch/db';
import { findOverdue, recoveryReminderEmail } from '../recovery/reminders';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Day-boundary fixes in the 08:30 reminder (conductor, 8.11):
 *  1) the per-supplier "N ימים" counts Israel CALENDAR days, the same basis as the
 *     overdue gate — a letter at 14:00 IL is 8 days old at 08:30 IL eight days later;
 *  2) the weekly re-chase compares calendar days, not 168h instants — a run a minute
 *     earlier than last week's (or the 167h spring-forward week) does not slip a day.
 * Times are explicit Israel wall-clock instants (UTC+2 in Nov, UTC+3 before 25.10 / after 27.3).
 */
const db = createDb(testDbUrl());
let T: Tenant;

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'D');
});
beforeEach(async () => {
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));
  await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, T.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
});
afterAll(async () => {
  await resetDb(db);
});

async function claim(over: Partial<typeof recoveryClaims.$inferInsert>): Promise<string> {
  const [d] = await db
    .insert(discrepancies)
    .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'PRICE_HIGHER', severity: 'block', deltaAmount: '10.00', resolutionStatus: 'accepted' })
    .returning({ id: discrepancies.id });
  const [c] = await db
    .insert(recoveryClaims)
    .values({ restaurantId: T.restaurantId, discrepancyId: d!.id, supplierId: T.supplierId, invoiceId: T.invoiceId, amountAgorot: 1000, status: 'letter_sent', ...over })
    .returning({ id: recoveryClaims.id });
  return c!.id;
}

describe('reminder day counts are Israel calendar days', () => {
  it('a letter at 14:00 IL on 10.11 is 8 days old at the 08:30 IL run on 18.11 (was 7)', async () => {
    await claim({ letterSentAt: new Date('2026-11-10T12:00:00Z'), claimedAt: new Date('2026-11-10T12:00:00Z') });
    const out = await findOverdue(db, T.restaurantId, new Date('2026-11-18T06:30:00Z'));
    expect(out.suppliers).toHaveLength(1);
    expect(out.suppliers[0]!.oldestDays).toBe(8);
  });

  it('the e-mail never says "7 ימים" under "more than 7 days" on the first overdue morning', async () => {
    for (const hhmmUtc of ['05:00', '06:29', '12:00', '19:59', '21:59']) {
      await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
      const sent = new Date(`2026-11-10T${hhmmUtc}:00Z`); // any time of 10.11 IL
      await claim({ letterSentAt: sent, claimedAt: sent });
      const out = await findOverdue(db, T.restaurantId, new Date('2026-11-18T06:30:00Z'));
      // Every send time of 10.11 IL is 8 calendar days old at the 18.11 08:30 run.
      expect(out.suppliers.map((x) => x.oldestDays), hhmmUtc).toEqual([8]);
      const email = recoveryReminderEmail({ suppliers: out.suppliers });
      expect(email.html, hhmmUtc).not.toContain('7 ימים</li>');
      expect(email.html, hhmmUtc).not.toContain('· 7 ימים');
    }
  });
});

describe('weekly re-chase counts calendar days, not 168h', () => {
  const letter = new Date('2026-11-01T08:00:00Z');

  it('168h minus a minute later (run started earlier in its minute) is still due', async () => {
    await claim({ letterSentAt: letter, claimedAt: letter, lastReminderAt: new Date('2026-11-10T06:30:30Z') });
    const out = await findOverdue(db, T.restaurantId, new Date('2026-11-17T06:29:30Z'));
    expect(out.dueClaimIds).toHaveLength(1);
  });

  it('6 calendar days later is not due', async () => {
    await claim({ letterSentAt: letter, claimedAt: letter, lastReminderAt: new Date('2026-11-10T06:30:00Z') });
    expect((await findOverdue(db, T.restaurantId, new Date('2026-11-16T06:30:00Z'))).dueClaimIds).toHaveLength(0);
  });

  it('the spring-forward week (167h between two 08:30 IL runs) is still due', async () => {
    // Israel DST starts Fri 27.3.2026 02:00 → 03:00. 08:30 IL = 06:30Z on 24.3, 05:30Z on 31.3.
    const old = new Date('2026-03-01T08:00:00Z');
    await claim({ letterSentAt: old, claimedAt: old, lastReminderAt: new Date('2026-03-24T06:30:00Z') });
    expect((await findOverdue(db, T.restaurantId, new Date('2026-03-31T05:30:00Z'))).dueClaimIds).toHaveLength(1);
  });
});
