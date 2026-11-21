/**
 * Train-C fix round (W2-10 / #194 #197):
 *  B1 — approving a finding makes its recovery claim AT the decision, whatever the
 *       recovery flag: right after approve, the letters (recovery.letters) carry the
 *       same ₪ as the decided claimable rule the supplier card shows (lib/claims
 *       claimableLines over the leak breakdown); undo takes the claim back at once.
 *  C1 — the supplier reminder draft chases exactly what the reminder job would:
 *       draft.claimIds ⊆ findOverdue.claimIds with equal ₪ on both sides of the
 *       7/8 calendar-day boundary, and never a never-claimable type.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, recoveryClaims, restaurants, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { claimableLines, OVERDUE_BOUNDARY_CASES, OVERDUE_BOUNDARY_NOW } from '../lib/claims';
import { findOverdue, supplierReminderDraft } from '../recovery/reminders';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
const callerOf = (t: Tenant) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);

/** The decided claimable ₪ of the month (agorot) — the card's rule, from the shared lib/claims. */
async function cardAgorot(t: Tenant): Promise<number> {
  const rows = await callerOf(t).owner.leakBreakdown({});
  const amount = rows.flatMap((inv) => claimableLines(inv)).filter((l) => !l.undecided).reduce((s, l) => s + l.amount, 0);
  return Math.round(amount * 100);
}
async function letterAgorot(t: Tenant): Promise<number> {
  const letters = await callerOf(t).recovery.letters();
  return letters.reduce((s, l) => s + l.totalAgorot, 0);
}

beforeAll(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await resetDb(db);
});

describe.each([
  { flag: 'on', features: { all: true } },
  { flag: 'off', features: { all: true, recovery: false } },
])('B1: approve makes the claim at the decision (recovery $flag)', ({ flag, features }) => {
  let T: Tenant;
  beforeAll(async () => {
    T = await seedTenant(db, `DP${flag}`);
    await db.update(restaurants).set({ settings: { features } as never }).where(eq(restaurants.id, T.restaurantId));
  });

  it('before: an open finding is on neither the card nor a letter', async () => {
    expect(await cardAgorot(T)).toBe(0);
    expect(await letterAgorot(T)).toBe(0);
  });

  it('approve → one claim by the decider, and recovery.letters ₪ == the card ₪, to the agora', async () => {
    await callerOf(T).approvals.approve({ discrepancyId: T.discrepancyId });
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ status: 'claimed', amountAgorot: 10000, createdBy: T.ownerUserId });
    const card = await cardAgorot(T);
    expect(card).toBe(10000);
    expect(await letterAgorot(T)).toBe(card);
  });

  it('undo → the untouched claim is written off in the same step; both read 0', async () => {
    await callerOf(T).approvals.reopen({ discrepancyId: T.discrepancyId });
    const [claim] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(claim!.status).toBe('written_off');
    expect(await cardAgorot(T)).toBe(0);
    expect(await letterAgorot(T)).toBe(0);
  });

  it('approve again → the same claim comes back (one claim per finding, no duplicate)', async () => {
    await callerOf(T).approvals.approve({ discrepancyId: T.discrepancyId });
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.status).toBe('claimed');
    expect(await letterAgorot(T)).toBe(await cardAgorot(T));
  });
});

describe('C1: the reminder draft uses findOverdue’s rule', () => {
  let T: Tenant;
  let claimId: string;
  const now = new Date(OVERDUE_BOUNDARY_NOW);

  beforeAll(async () => {
    T = await seedTenant(db, 'RDP');
    await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
    await callerOf(T).approvals.approve({ discrepancyId: T.discrepancyId });
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    claimId = c!.id;
  });

  async function both() {
    const draft = await supplierReminderDraft(db, T.restaurantId, T.supplierId, now);
    const job = await findOverdue(db, T.restaurantId, now);
    return { draft, job, jobAgorot: job.suppliers.reduce((s, x) => s + x.outstandingAgorot, 0) };
  }

  for (const k of OVERDUE_BOUNDARY_CASES) {
    it(`${k.why}: draft ⊆ job, equal ₪, overdue=${k.overdue}`, async () => {
      await db
        .update(recoveryClaims)
        .set({ status: 'letter_sent', letterSentAt: new Date(k.letterSentAt), lastReminderAt: null })
        .where(eq(recoveryClaims.id, claimId));
      const { draft, job, jobAgorot } = await both();
      for (const id of draft.claimIds) expect(job.claimIds).toContain(id);
      expect(draft.outstandingAgorot).toBe(jobAgorot);
      expect(draft.claimIds.length > 0).toBe(k.overdue);
      if (k.overdue) expect(draft.oldestDays).toBe(8);
    });
  }

  it('a never-claimable type is chased by neither (owner 31.10)', async () => {
    const overdue = OVERDUE_BOUNDARY_CASES.find((k) => k.overdue)!;
    await db
      .update(recoveryClaims)
      .set({ status: 'letter_sent', letterSentAt: new Date(overdue.letterSentAt), lastReminderAt: null })
      .where(eq(recoveryClaims.id, claimId));
    await db.update(discrepancies).set({ type: 'MISSING_ON_INVOICE' }).where(eq(discrepancies.id, T.discrepancyId));
    try {
      const { draft, job } = await both();
      expect(draft.claimIds).toEqual([]);
      expect(job.claimIds).not.toContain(claimId);
    } finally {
      await db.update(discrepancies).set({ type: 'PRICE_HIGHER' }).where(eq(discrepancies.id, T.discrepancyId));
    }
  });
});
