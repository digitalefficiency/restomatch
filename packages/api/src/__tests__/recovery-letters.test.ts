/**
 * W2-10 — claim letters built only from recovery_claims (acceptance 2–3):
 * one letter per supplier; decision-18 (no undecided gap) and decision-19
 * (paid → "לזיכוי", unpaid → "לקיזוז לפני תשלום") sections; Σ letter = Σ its
 * claims to the agora; send moves its claims together; unsend within the
 * window; a stale screen is a CONFLICT.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, recoveryClaims, restaurants, sql, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { buildClaimLetters, sendLetter, unsendLetter, UNSEND_WINDOW_MINUTES } from '../recovery/letters';
import { materializeClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;
let second: string; // a second accepted discrepancy on the same invoice
let undecided: string; // open: never in a letter

const caller = () => appRouter.createCaller({ db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' } } as AppContext);
const claimOf = async (discrepancyId: string) =>
  (await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, discrepancyId)))[0]!;

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'L');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
  const [d2] = await db
    .insert(discrepancies)
    .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '12.34', resolutionStatus: 'accepted', resolvedAt: new Date() })
    .returning();
  second = d2!.id;
  const [d3] = await db
    .insert(discrepancies)
    .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '3.00', resolutionStatus: 'open' })
    .returning();
  undecided = d3!.id;
});

beforeEach(async () => {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, T.invoiceId));
  await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, T.discrepancyId));
  await materializeClaims(db, { restaurantId: T.restaurantId, discrepancyIds: [T.discrepancyId, second, undecided], actorId: T.ownerUserId });
});

afterAll(async () => {
  await resetDb(db);
});

describe('buildClaimLetters', () => {
  it('one letter per supplier, from claimed claims only; never an undecided gap', async () => {
    const letters = await caller().recovery.letters();
    expect(letters).toHaveLength(1);
    const [l] = letters;
    expect(l!.supplierId).toBe(T.supplierId);
    const lines = [...l!.beforePayment, ...l!.forCredit];
    expect(lines.map((x) => x.discrepancyId).sort()).toEqual([T.discrepancyId, second].sort());
    expect(lines.some((x) => x.discrepancyId === undecided)).toBe(false);
  });

  it('Σ letter = Σ its claims (outstanding) to the agora; each claim in exactly one section', async () => {
    const [l] = await buildClaimLetters(db, T.restaurantId);
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    const owed = claims.reduce((a, c) => a + c.amountAgorot - c.creditedAgorot, 0);
    expect(l!.totalAgorot).toBe(owed);
    expect(l!.beforePaymentAgorot + l!.forCreditAgorot).toBe(l!.totalAgorot);
    expect(l!.beforePayment.reduce((a, x) => a + x.amountAgorot, 0)).toBe(l!.beforePaymentAgorot);
    const ids = [...l!.beforePayment, ...l!.forCredit].map((x) => x.claimId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...l!.claimIds].sort());
  });

  it('decision 19: unpaid → before payment; paid → for credit (never both)', async () => {
    let [l] = await buildClaimLetters(db, T.restaurantId);
    expect(l!.forCredit).toHaveLength(0);
    expect(l!.beforePayment).toHaveLength(2);
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, T.invoiceId));
    [l] = await buildClaimLetters(db, T.restaurantId);
    expect(l!.beforePayment).toHaveLength(0);
    expect(l!.forCredit).toHaveLength(2);
    expect(l!.forCredit.every((x) => x.invoicePaid)).toBe(true);
  });

  it('a claim that already went out, was credited in full or written off is not in a draft', async () => {
    const c = await claimOf(second);
    await db.update(recoveryClaims).set({ status: 'letter_sent' }).where(eq(recoveryClaims.id, c.id));
    let [l] = await buildClaimLetters(db, T.restaurantId);
    expect(l!.claimIds).not.toContain(c.id);
    await db.update(recoveryClaims).set({ status: 'claimed', creditedAgorot: c.amountAgorot }).where(eq(recoveryClaims.id, c.id));
    [l] = await buildClaimLetters(db, T.restaurantId);
    expect(l!.claimIds).not.toContain(c.id);
  });

  it('a reading writes nothing', async () => {
    const count = async () => Number(((await db.execute(sql`select count(*)::int n from recovery_events`)) as unknown as Array<{ n: number }>)[0]!.n);
    const before = await count();
    await caller().recovery.letters();
    expect(await count()).toBe(before);
  });
});

describe('send / unsend', () => {
  it('send moves ALL of the letter claims to letter_sent together, only on confirm', async () => {
    const [l] = await caller().recovery.letters();
    const res = await caller().recovery.sendLetter({ supplierId: T.supplierId, claimIds: l!.claimIds, channel: 'whatsapp' });
    expect(res.claimIds.sort()).toEqual([...l!.claimIds].sort());
    for (const id of l!.claimIds) {
      const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, id));
      expect(c!.status).toBe('letter_sent');
      expect(c!.letterSentAt).not.toBeNull();
    }
    expect(await caller().recovery.letters()).toEqual([]);
  });

  it('a stale screen (a claim missing from what was shown) is a CONFLICT and nothing moves', async () => {
    const [l] = await caller().recovery.letters();
    await expect(
      caller().recovery.sendLetter({ supplierId: T.supplierId, claimIds: [l!.claimIds[0]!], channel: 'email' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const id of l!.claimIds) expect((await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, id)))[0]!.status).toBe('claimed');
  });

  it('sending twice is a CONFLICT (the claims are no longer claimed)', async () => {
    const [l] = await caller().recovery.letters();
    await caller().recovery.sendLetter({ supplierId: T.supplierId, claimIds: l!.claimIds, channel: 'email' });
    await expect(caller().recovery.sendLetter({ supplierId: T.supplierId, claimIds: l!.claimIds, channel: 'email' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it(`unsend within ${UNSEND_WINDOW_MINUTES} minutes returns the claims to claimed; after it, CONFLICT`, async () => {
    const [l] = await caller().recovery.letters();
    await caller().recovery.sendLetter({ supplierId: T.supplierId, claimIds: l!.claimIds, channel: 'email' });
    await caller().recovery.unsendLetter({ claimIds: l!.claimIds });
    const [again] = await caller().recovery.letters();
    expect([...again!.claimIds].sort()).toEqual([...l!.claimIds].sort());
    // Second unsend: they are claimed now → CONFLICT (stale screen).
    await expect(caller().recovery.unsendLetter({ claimIds: l!.claimIds })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Too late: sent 11 minutes ago.
    const sentAt = new Date(Date.now() - (UNSEND_WINDOW_MINUTES + 1) * 60_000);
    await db.transaction((tx) => sendLetter(tx as never, T.restaurantId, { supplierId: T.supplierId, claimIds: l!.claimIds, channel: 'print', actorId: T.ownerUserId, at: sentAt }));
    await expect(
      db.transaction((tx) => unsendLetter(tx as never, T.restaurantId, { claimIds: l!.claimIds, actorId: T.ownerUserId })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('reminder draft (owner decision 16)', () => {
  it('lists only the supplier’s overdue, still-owed claims, and writes / queues nothing', async () => {
    const { OVERDUE_DAYS } = await import('../recovery/service');
    const c = await claimOf(T.discrepancyId);
    const old = new Date(Date.now() - (OVERDUE_DAYS + 1) * 86_400_000);
    await db.update(recoveryClaims).set({ status: 'letter_sent', letterSentAt: old }).where(eq(recoveryClaims.id, c.id));
    await db.update(suppliers).set({ contactWhatsapp: '+972501234567', contactEmail: 'sales@supplier.test' }).where(eq(suppliers.id, T.supplierId));
    const count = async () =>
      Number(((await db.execute(sql`select (select count(*) from notifications_outbox) + (select count(*) from recovery_events) as n`)) as unknown as Array<{ n: number }>)[0]!.n);
    const before = await count();
    const d = await caller().recovery.reminderDraft({ supplierId: T.supplierId });
    expect(d).toMatchObject({ count: 1, outstandingAgorot: c.amountAgorot, claimIds: [c.id], whatsapp: '+972501234567', email: 'sales@supplier.test' });
    expect(d.oldestDays).toBeGreaterThanOrEqual(OVERDUE_DAYS);
    expect(await count()).toBe(before);
    // Not overdue yet → an empty draft.
    await db.update(recoveryClaims).set({ letterSentAt: new Date() }).where(eq(recoveryClaims.id, c.id));
    expect((await caller().recovery.reminderDraft({ supplierId: T.supplierId })).count).toBe(0);
  });
});
