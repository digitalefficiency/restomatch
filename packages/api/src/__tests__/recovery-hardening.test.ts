import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditNotes, discrepancies, eq, invoiceLines, invoices, recoveryClaims, recoveryEvents, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { recordCreditNote, transitionClaim } from '../recovery/service';
import { appRouter } from '../index';
import type { AppContext } from '../context';
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
  await db.delete(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
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

  it("a credit line on an undated invoice gets the restaurant's calendar day, not the UTC one", async () => {
    // 31.10 22:30Z = 1.11 00:30 in Israel: the credit note is dated 1.11 (November), not 31.10.
    await db
      .update(restaurants)
      .set({ timezone: 'Asia/Jerusalem' })
      .where(eq(restaurants.id, T.restaurantId));
    await db
      .update(invoices)
      .set({ invoiceDate: null, createdAt: new Date('2026-10-31T22:30:00Z') })
      .where(eq(invoices.id, T.invoiceId));
    await db.update(invoiceLines).set({ lineTotal: '-5.00' }).where(eq(invoiceLines.id, T.invoiceLineId));
    const out = await recordCreditNote(db, T.restaurantId, { claimIds: [claimId], invoiceLineId: T.invoiceLineId });
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.id, out.creditNoteId));
    expect(note!.issuedOn).toBe('2026-11-01');
    expect(note!.amountAgorot).toBe(500);
  });

  it("suggestAllocation converts the printed amount with #197's rule, the same ₪ recordCreditNote books", async () => {
    // ₪11.80 printed incl. VAT at the supplier's 18% → ₪10.00 before VAT = the 1_000-agorot claim.
    await db.update(suppliers).set({ vatRate: '0.1800' }).where(eq(suppliers.id, T.supplierId));
    const caller = appRouter.createCaller({
      db,
      session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' },
    } as AppContext);
    const printed = { printedAgorot: 1_180, vat: 'incl' as const };
    const out = await caller.recovery.suggestAllocation({ supplierId: T.supplierId, ...printed });
    expect(out.suggestion).toMatchObject({ basis: 'exact_single', allocations: [{ id: claimId, agorot: 1_000 }], remainderAgorot: 0 });

    const booked = await caller.recovery.recordCreditNote({
      claimIds: out.suggestion.allocations.map((a) => a.id),
      supplierId: T.supplierId,
      issuedOn: '2026-11-01',
      ...printed,
    });
    expect(booked).toMatchObject({ allocatedAgorot: 1_000, unallocatedAgorot: 0, creditedClaimIds: [claimId] });
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.id, booked.creditNoteId));
    expect(note!.amountAgorot).toBe(1_000);

    // Excl. VAT passes through; a printed amount without its VAT mode is refused.
    await expect(caller.recovery.suggestAllocation({ supplierId: T.supplierId, printedAgorot: 1_180 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('never proposes a claim that is not measured before VAT (a duplicate invoice is incl. VAT)', async () => {
    const [d] = await db.select({ type: discrepancies.type }).from(discrepancies).where(eq(discrepancies.id, T.discrepancyId));
    await db.update(discrepancies).set({ type: 'DUPLICATE_INVOICE' }).where(eq(discrepancies.id, T.discrepancyId));
    try {
      const caller = appRouter.createCaller({
        db,
        session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' },
      } as AppContext);
      const out = await caller.recovery.suggestAllocation({ supplierId: T.supplierId, amountAgorot: 1_000 });
      expect(out.candidates).toEqual([]);
      expect(out.suggestion).toMatchObject({ basis: 'none', allocations: [], remainderAgorot: 1_000 });
    } finally {
      await db.update(discrepancies).set({ type: d!.type }).where(eq(discrepancies.id, T.discrepancyId));
    }
  });
});

