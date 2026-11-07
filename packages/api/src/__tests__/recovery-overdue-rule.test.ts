import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditNotes, eq, recoveryClaims, recoveryEvents, sql, testDbUrl } from '@restomatch/db';
import { OVERDUE_BOUNDARY_CASES, OVERDUE_BOUNDARY_NOW } from '../lib/claims';
import { awaitingChaseSql, isAwaitingChase, type ChaseClaim } from '../recovery/overdue';
import { findOverdue } from '../recovery/reminders';
import { listClaims } from '../recovery/service';
import { addClaim, setSettings } from './au03-helpers';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-03 AC 1–2: ONE predicate. The TS rule and its SQL twin agree on every
 * boundary case and every status / option / outstanding / type case, and the
 * job (findOverdue) and the tracker badge (listClaims.overdue) use it.
 */
const db = createDb(testDbUrl());
let T: Tenant;
const NOW = new Date(OVERDUE_BOUNDARY_NOW);
const OLD = '2026-10-10T08:00:00.000Z'; // 15 Israel days before NOW

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'O');
});
beforeEach(async () => {
  await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, T.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.delete(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
  await setSettings(db, T, { features: { all: true } });
});
afterAll(async () => {
  await resetDb(db);
});

async function sqlSays(claimId: string, opts: { chaseAcknowledged?: boolean } = {}): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT ${awaitingChaseSql(NOW, sql`'Asia/Jerusalem'`, opts)} AS hit
    FROM recovery_claims c JOIN discrepancies d ON d.id = c.discrepancy_id
    WHERE c.id = ${claimId}`);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<{ hit: boolean }>;
  return rows[0]!.hit === true;
}

interface Case {
  why: string;
  status: string;
  letterSentAt: string | null;
  claimedAt: string;
  amount?: number;
  credited?: number;
  type?: string;
  chaseAcknowledged?: boolean;
  expected: boolean;
}

const CASES: Case[] = [
  ...OVERDUE_BOUNDARY_CASES.map((k) => ({
    why: `boundary: ${k.why}`,
    status: 'letter_sent',
    letterSentAt: k.letterSentAt,
    claimedAt: '2026-10-01T08:00:00.000Z',
    expected: k.overdue,
  })),
  ...OVERDUE_BOUNDARY_CASES.map((k) => ({
    why: `boundary, no letter (clock from claimed_at): ${k.why}`,
    status: 'claimed',
    letterSentAt: null,
    claimedAt: k.letterSentAt,
    expected: k.overdue,
  })),
  { why: 'acknowledged, option on', status: 'acknowledged', letterSentAt: OLD, claimedAt: OLD, expected: true },
  { why: 'acknowledged, option off', status: 'acknowledged', letterSentAt: OLD, claimedAt: OLD, chaseAcknowledged: false, expected: false },
  { why: 'letter_sent, fully credited → nothing outstanding', status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD, credited: 1000, expected: false },
  { why: 'credited status is not waiting', status: 'credited', letterSentAt: OLD, claimedAt: OLD, credited: 400, expected: false },
  { why: 'disputed is not chased', status: 'disputed', letterSentAt: OLD, claimedAt: OLD, expected: false },
  { why: 'written_off is not chased', status: 'written_off', letterSentAt: OLD, claimedAt: OLD, expected: false },
  { why: 'never-claimable MISSING_ON_INVOICE', status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD, type: 'MISSING_ON_INVOICE', expected: false },
  { why: 'never-claimable PRICE_LOWER', status: 'acknowledged', letterSentAt: OLD, claimedAt: OLD, type: 'PRICE_LOWER', expected: false },
  { why: 'partially credited still outstanding', status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD, credited: 300, expected: true },
];

describe('AU-03 · isAwaitingChase (TS) ≡ awaitingChaseSql (SQL)', () => {
  for (const k of CASES) {
    it(k.why, async () => {
      const amount = k.amount ?? 1000;
      const credited = k.credited ?? 0;
      const claim: ChaseClaim = {
        status: k.status,
        outstandingAgorot: amount - credited,
        letterSentAt: k.letterSentAt,
        claimedAt: k.claimedAt,
        discrepancyType: k.type ?? 'PRICE_HIGHER',
      };
      const ts = isAwaitingChase(claim, NOW.toISOString(), { chaseAcknowledged: k.chaseAcknowledged });
      const id = await addClaim(db, T, {
        status: k.status as never,
        amountAgorot: amount,
        creditedAgorot: credited,
        letterSentAt: k.letterSentAt ? new Date(k.letterSentAt) : null,
        claimedAt: new Date(k.claimedAt),
        type: k.type,
      });
      const db_ = await sqlSays(id, { chaseAcknowledged: k.chaseAcknowledged });
      expect(ts, k.why).toBe(k.expected);
      expect(db_, k.why).toBe(ts);
    });
  }
});

describe('AU-03 · the job and the badge use the one rule; ₪ summed per claim', () => {
  it('a supplier with one fresh letter does not hide its older waiting claims (membership is per claim)', async () => {
    const older = await addClaim(db, T, { status: 'letter_sent', letterSentAt: new Date(OLD), claimedAt: new Date(OLD), amountAgorot: 12_345 });
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: new Date('2026-10-24T08:00:00Z'), claimedAt: new Date(OLD), amountAgorot: 999 });
    const unsent = await addClaim(db, T, { status: 'claimed', claimedAt: new Date(OLD), amountAgorot: 500 });
    const ack = await addClaim(db, T, { status: 'acknowledged', letterSentAt: new Date(OLD), claimedAt: new Date(OLD), amountAgorot: 2000, creditedAgorot: 250 });
    const out = await findOverdue(db, T.restaurantId, NOW);
    expect(new Set(out.claimIds)).toEqual(new Set([older, unsent, ack]));
    expect(out.totalAgorot).toBe(12_345 + 500 + 1750);
    expect(out.count).toBe(3);
    const kinds = Object.fromEntries(out.suppliers.map((s) => [s.kind, s.outstandingAgorot]));
    expect(kinds).toEqual({ no_reply: 12_345, unsent: 500, acknowledged: 1750 });
    // claimed with no letter is "unsent", never shown with a letter date.
    expect(out.suppliers.find((s) => s.kind === 'unsent')!.latestLetterAt).toBeNull();

    const rows = await listClaims(db, T.restaurantId, { now: NOW, limit: null });
    const badge = rows.filter((r) => r.overdue).map((r) => r.id);
    expect(new Set(badge)).toEqual(new Set(out.claimIds));
  });

  it('chaseAcknowledged off drops acknowledged claims from the job', async () => {
    await addClaim(db, T, { status: 'acknowledged', letterSentAt: new Date(OLD), claimedAt: new Date(OLD) });
    expect((await findOverdue(db, T.restaurantId, NOW, { chaseAcknowledged: false })).count).toBe(0);
    expect((await findOverdue(db, T.restaurantId, NOW)).count).toBe(1);
  });
});
