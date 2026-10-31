/**
 * W2-10 — guarded claim transitions (deep-fix class 8, acceptance 6 + 10):
 *  - `transition({ items:[{claimId, expectedStatus}], to })` is all-or-nothing;
 *  - a claim that moved meanwhile is a CONFLICT naming it;
 *  - terminal edges (written off, a short recovered) need a reason;
 *  - `recovery.list` returns `next[]` from the server machine — the cases of
 *    the web's old client mirror (`logic.ts NEXT`) live here now, unweakened.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, recoveryClaims, recoveryEvents, restaurants, testDbUrl, type RecoveryStatus } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { nextEdges, RECOVERY_TRANSITIONS } from '../recovery/lifecycle';
import { materializeClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;
let extraId: string;

const caller = () => appRouter.createCaller({ db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' } } as AppContext);

async function claims() {
  const rows = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId)).orderBy(recoveryClaims.amountAgorot);
  return rows;
}

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'TB');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
  const [extra] = await db
    .insert(discrepancies)
    .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '5.00', resolutionStatus: 'accepted', resolvedAt: new Date() })
    .returning();
  extraId = extra!.id;
});

beforeEach(async () => {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, T.discrepancyId));
  await materializeClaims(db, { restaurantId: T.restaurantId, discrepancyIds: [T.discrepancyId, extraId], actorId: T.ownerUserId });
});

afterAll(async () => {
  await resetDb(db);
});

describe('transition items (all-or-nothing)', () => {
  it('moves every item together and records one event each, by the actor', async () => {
    const [a, b] = await claims();
    const out = await caller().recovery.transition({
      items: [
        { claimId: a!.id, expectedStatus: 'claimed' },
        { claimId: b!.id, expectedStatus: 'claimed' },
      ],
      to: 'letter_sent',
    });
    expect(out.map((o) => o.status)).toEqual(['letter_sent', 'letter_sent']);
    for (const c of await claims()) expect(c.status).toBe('letter_sent');
    const ev = await db.select().from(recoveryEvents).where(eq(recoveryEvents.toStatus, 'letter_sent'));
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.actorId === T.ownerUserId)).toBe(true);
  });

  it('a stale expectedStatus on ONE item is a CONFLICT naming it, and nothing moves', async () => {
    const [a, b] = await claims();
    await db.update(recoveryClaims).set({ status: 'acknowledged' }).where(eq(recoveryClaims.id, b!.id));
    const err = await caller()
      .recovery.transition({
        items: [
          { claimId: a!.id, expectedStatus: 'claimed' },
          { claimId: b!.id, expectedStatus: 'claimed' },
        ],
        to: 'disputed',
      })
      .then(
        () => null,
        (e: unknown) => e as { code?: string; message?: string },
      );
    expect(err).toMatchObject({ code: 'CONFLICT' });
    expect(String(err?.message)).toContain(b!.id);
    const after = await claims();
    expect(after.find((c) => c.id === a!.id)!.status).toBe('claimed');
    expect(after.find((c) => c.id === b!.id)!.status).toBe('acknowledged');
  });

  it('an illegal edge on one item rolls back the others', async () => {
    const [a, b] = await claims();
    await db.update(recoveryClaims).set({ status: 'acknowledged' }).where(eq(recoveryClaims.id, b!.id));
    await expect(
      caller().recovery.transition({
        items: [
          { claimId: a!.id, expectedStatus: 'claimed' },
          { claimId: b!.id, expectedStatus: 'acknowledged' },
        ],
        to: 'letter_sent', // acknowledged → letter_sent is not an edge
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await claims()).find((c) => c.id === a!.id)!.status).toBe('claimed');
  });

  it('written off needs a reason (BAD_REQUEST without one); with one it closes', async () => {
    const [a] = await claims();
    const items = [{ claimId: a!.id, expectedStatus: 'claimed' as const }];
    await expect(caller().recovery.transition({ items, to: 'written_off' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller().recovery.transition({ items, to: 'written_off', note: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller().recovery.transition({ items, to: 'written_off', note: 'הספק נסגר' });
    const [ev] = await db.select().from(recoveryEvents).where(eq(recoveryEvents.toStatus, 'written_off'));
    expect(ev!.note).toBe('הספק נסגר');
  });

  it('recovered with a shortfall needs a reason; fully credited does not', async () => {
    const [a, b] = await claims();
    await db.update(recoveryClaims).set({ status: 'credited', creditedAgorot: 100 }).where(eq(recoveryClaims.id, a!.id));
    await db.update(recoveryClaims).set({ status: 'credited', creditedAgorot: b!.amountAgorot }).where(eq(recoveryClaims.id, b!.id));
    await expect(
      caller().recovery.transition({ items: [{ claimId: a!.id, expectedStatus: 'credited' }], to: 'recovered' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller().recovery.transition({ items: [{ claimId: b!.id, expectedStatus: 'credited' }], to: 'recovered' });
    expect((await claims()).find((c) => c.id === b!.id)!.status).toBe('recovered');
  });

  it('a foreign / unknown claim is NOT_FOUND before any state is revealed; a duplicate id is refused', async () => {
    const [a] = await claims();
    await expect(
      caller().recovery.transition({
        items: [
          { claimId: a!.id, expectedStatus: 'acknowledged' },
          { claimId: '00000000-0000-4000-8000-000000000000', expectedStatus: 'claimed' },
        ],
        to: 'written_off',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller().recovery.transition({
        items: [
          { claimId: a!.id, expectedStatus: 'claimed' },
          { claimId: a!.id, expectedStatus: 'claimed' },
        ],
        to: 'letter_sent',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses claimIds and items together', async () => {
    const [a] = await claims();
    await expect(
      caller().recovery.transition({ claimIds: [a!.id], items: [{ claimId: a!.id, expectedStatus: 'claimed' }], to: 'letter_sent' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('next[] comes from the server machine', () => {
  // The web mirror's cases (apps/web/app/dashboard/recovery/__tests__/logic.test.ts NEXT), moved here.
  const expected: Record<RecoveryStatus, RecoveryStatus[]> = {
    claimed: ['letter_sent', 'acknowledged', 'disputed', 'written_off'],
    letter_sent: ['acknowledged', 'disputed', 'written_off'],
    acknowledged: ['disputed', 'written_off'],
    credited: ['recovered', 'disputed'],
    recovered: [],
    disputed: ['letter_sent', 'acknowledged', 'written_off'],
    written_off: ['claimed'],
  };

  it('nextEdges lists exactly the transition table, with reason/terminal metadata', () => {
    for (const [from, tos] of Object.entries(expected) as Array<[RecoveryStatus, RecoveryStatus[]]>) {
      expect(nextEdges(from).map((e) => e.to)).toEqual(tos);
      expect([...RECOVERY_TRANSITIONS[from]]).toEqual(tos);
    }
    expect(nextEdges('claimed').find((e) => e.to === 'written_off')).toMatchObject({ requiresReason: true, terminal: true, undoable: false });
    expect(nextEdges('claimed').find((e) => e.to === 'letter_sent')).toMatchObject({ requiresReason: false, terminal: false, undoable: true });
    expect(nextEdges('credited', { amountAgorot: 100, creditedAgorot: 60 }).find((e) => e.to === 'recovered')!.requiresReason).toBe(true);
    expect(nextEdges('credited', { amountAgorot: 100, creditedAgorot: 100 }).find((e) => e.to === 'recovered')!.requiresReason).toBe(false);
    // `credited` is entered only through a credit note.
    for (const tos of Object.values(expected)) expect(tos).not.toContain('credited');
  });

  it('recovery.list carries next[] per claim', async () => {
    const list = await caller().recovery.list();
    expect(list.length).toBe(2);
    for (const c of list) expect(c.next.map((e) => e.to)).toEqual(expected[c.status]);
  });
});
