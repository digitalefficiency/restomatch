import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, recoveryClaims, recoveryEvents, restaurants, testDbUrl } from '@restomatch/db';
import { transitionClaim } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * H-06 security-review hand-offs, folded into W3-11 (recovery/service.ts only):
 *  (1) re-opening a written-off request re-stamps letter_sent_at, so a supplier link
 *      issued before the re-open is stale;
 *  (2) a back-dated `at` on a transition is clamped to now(), never earlier than the
 *      request's last event.
 */
const db = createDb(testDbUrl());
let T: Tenant;
let claimId: string;
const OLD = new Date('2026-09-01T09:00:00Z');

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'H');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
});

beforeEach(async () => {
  await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, T.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  const [c] = await db
    .insert(recoveryClaims)
    .values({
      restaurantId: T.restaurantId,
      discrepancyId: T.discrepancyId,
      supplierId: T.supplierId,
      invoiceId: T.invoiceId,
      amountAgorot: 1_000,
      claimedAt: OLD,
      letterSentAt: OLD,
    })
    .returning({ id: recoveryClaims.id });
  claimId = c!.id;
});

afterAll(async () => {
  await resetDb(db);
});

const claim = async () => (await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claimId)))[0]!;
const events = async () =>
  (await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, claimId))).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

describe('recovery hardening (H-06 review → W3-11)', () => {
  it('re-opening a written-off request re-stamps letter_sent_at to the re-open instant', async () => {
    await transitionClaim(db, T.restaurantId, { claimId, to: 'written_off' });
    const before = Date.now();
    await transitionClaim(db, T.restaurantId, { claimId, to: 'claimed' });
    const c = await claim();
    expect(c.status).toBe('claimed');
    expect(c.closedAt).toBeNull();
    expect(c.letterSentAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(c.letterSentAt!.getTime()).toBeGreaterThan(OLD.getTime());
    const reopen = (await events()).at(-1)!;
    expect(reopen.toStatus).toBe('claimed');
    expect(c.letterSentAt!.getTime()).toBe(reopen.createdAt.getTime());
  });

  it('a non-reopen transition leaves letter_sent_at alone', async () => {
    await transitionClaim(db, T.restaurantId, { claimId, to: 'acknowledged' });
    expect((await claim()).letterSentAt!.getTime()).toBe(OLD.getTime());
  });

  it('clamps a back-dated `at` to now()', async () => {
    const before = Date.now();
    await transitionClaim(db, T.restaurantId, { claimId, to: 'acknowledged', at: new Date('2020-01-01T00:00:00Z') });
    const c = await claim();
    expect(c.acknowledgedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect((await events()).at(-1)!.createdAt.getTime()).toBe(c.acknowledgedAt!.getTime());
  });

  it("never records a transition earlier than the request's last event", async () => {
    const later = new Date(Date.now() + 3_600_000);
    await db.insert(recoveryEvents).values({
      restaurantId: T.restaurantId,
      claimId,
      fromStatus: 'claimed',
      toStatus: 'letter_sent',
      createdAt: later,
    });
    await transitionClaim(db, T.restaurantId, { claimId, to: 'disputed', at: new Date('2020-01-01T00:00:00Z') });
    const last = (await events()).at(-1)!;
    expect(last.toStatus).toBe('disputed');
    expect(last.createdAt.getTime()).toBe(later.getTime());
  });
});
