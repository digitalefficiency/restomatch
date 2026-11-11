import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditNotes, eq, recoveryClaims, recoveryEvents, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { proposeCreditAllocations } from '../recovery/creditSuggest';
import { addClaim, addCreditLine, addSupplier, setSettings } from './au03-helpers';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-03 AC 7–9: credit suggestions. Proposal = allocateCredit oldest first;
 * nothing is booked before the human confirms; confirm books exactly the
 * ticked claims. Cross-tenant: B's line or claim from A's session → NOT_FOUND
 * and B untouched; another supplier's claim → BAD_REQUEST supplier_mismatch.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'SA');
  B = await seedTenant(db, 'SB');
});
beforeEach(async () => {
  for (const t of [A, B]) {
    await db.delete(creditNotes).where(eq(creditNotes.restaurantId, t.restaurantId));
    await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, t.restaurantId));
    await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
    await setSettings(db, t, { features: { all: true } });
  }
});
afterAll(async () => {
  await resetDb(db);
});

describe('proposeCreditAllocations (pure)', () => {
  const line = (id: string, agorot: number, date: string, supplierId = 's1') => ({
    invoiceLineId: id,
    invoiceId: `inv-${id}`,
    invoiceNumber: id,
    invoiceDate: date,
    supplierId,
    supplierName: null,
    supplierNameEn: null,
    description: '',
    descriptionEn: null,
    amountAgorot: agorot,
  });
  const claim = (id: string, amount: number, claimedAt: string, credited = 0, supplierId = 's1') => ({
    id,
    supplierId,
    status: 'letter_sent',
    amountAgorot: amount,
    creditedAgorot: credited,
    claimedAt,
    invoiceNumber: null,
    discrepancyType: 'PRICE_HIGHER',
  });

  it('oldest claim first, partial credit honoured, remainder reported', () => {
    const [s] = proposeCreditAllocations(
      [line('L1', 5_000, '2026-10-20')],
      [claim('new', 4_000, '2026-10-15T00:00:00Z'), claim('old', 3_000, '2026-10-01T00:00:00Z', 1_000)],
    );
    expect(s!.proposal).toEqual([
      { claimId: 'old', agorot: 2_000 },
      { claimId: 'new', agorot: 3_000 },
    ]);
    expect(s!.remainderAgorot).toBe(0);
    expect(s!.openClaims.map((c) => c.claimId)).toEqual(['old', 'new']);
  });

  it('two lines never propose the same ₪ twice; a line larger than what is owed keeps a remainder', () => {
    const out = proposeCreditAllocations(
      [line('L2', 2_500, '2026-10-22'), line('L1', 1_000, '2026-10-20')],
      [claim('c1', 3_000, '2026-10-01T00:00:00Z')],
    );
    const byLine = Object.fromEntries(out.map((s) => [s.invoiceLineId, s]));
    expect(byLine.L1!.proposal).toEqual([{ claimId: 'c1', agorot: 1_000 }]);
    expect(byLine.L2!.proposal).toEqual([{ claimId: 'c1', agorot: 2_000 }]);
    expect(byLine.L2!.remainderAgorot).toBe(500);
  });
});

describe('recovery.creditSuggestions / confirmCreditSuggestion (DB)', () => {
  it('suggests, books nothing, then confirm credits exactly the ticked claims (idempotent replay)', async () => {
    const c1 = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z'), letterSentAt: new Date('2026-10-02T08:00:00Z'), amountAgorot: 3_000 });
    const c2 = await addClaim(db, A, { status: 'acknowledged', claimedAt: new Date('2026-10-05T08:00:00Z'), letterSentAt: new Date('2026-10-06T08:00:00Z'), amountAgorot: 4_000 });
    const lineId = await addCreditLine(db, A, { agorot: 5_000, date: '2026-10-20', number: 'CR-A-1' });

    const list = await caller(A).recovery.creditSuggestions();
    const s = list.find((x) => x.invoiceLineId === lineId)!;
    expect(s.amountAgorot).toBe(5_000);
    expect(s.proposal).toEqual([
      { claimId: c1, agorot: 3_000 },
      { claimId: c2, agorot: 2_000 },
    ]);
    expect(s.remainderAgorot).toBe(0);
    // Suggesting wrote nothing.
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, A.restaurantId))).toHaveLength(0);
    const before = await db.select({ status: recoveryClaims.status }).from(recoveryClaims).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    expect(before.map((b) => b.status).sort()).toEqual(['acknowledged', 'letter_sent']);

    const key = randomUUID();
    const res = await caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [c1, c2], idempotencyKey: key });
    expect(res.allocatedAgorot).toBe(5_000);
    expect(res.creditedClaimIds.sort()).toEqual([c1, c2].sort());
    const after = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    expect(after.every((c) => c.status === 'credited')).toBe(true);
    expect(after.find((c) => c.id === c2)!.creditedAgorot).toBe(2_000);

    const replay = await caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [c1, c2], idempotencyKey: key });
    expect(replay.duplicate).toBe(true);
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, A.restaurantId))).toHaveLength(1);
    // The used line is no longer suggested.
    expect((await caller(A).recovery.creditSuggestions()).find((x) => x.invoiceLineId === lineId)).toBeUndefined();
  });

  it('the human may untick: only the selected claim is credited', async () => {
    const c1 = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z'), amountAgorot: 3_000 });
    const c2 = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-05T08:00:00Z'), amountAgorot: 4_000 });
    const lineId = await addCreditLine(db, A, { agorot: 4_000, date: '2026-10-20', number: 'CR-A-2' });
    const res = await caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [c2] });
    expect(res.creditedClaimIds).toEqual([c2]);
    const [k1] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, c1));
    expect(k1!.status).toBe('letter_sent');
  });

  it("another supplier's claim → BAD_REQUEST supplier_mismatch, nothing booked", async () => {
    const other = await addSupplier(db, A, 'ספק אחר SA');
    const c = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z'), supplierId: other });
    const lineId = await addCreditLine(db, A, { agorot: 1_000, date: '2026-10-20', number: 'CR-A-3' });
    await expect(caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [c] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'supplier_mismatch',
    });
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, A.restaurantId))).toHaveLength(0);
  });

  it("attack: B's credit line or B's claim from A's session → NOT_FOUND; B untouched and never suggested to A", async () => {
    const bClaim = await addClaim(db, B, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z'), amountAgorot: 2_000 });
    const bLine = await addCreditLine(db, B, { agorot: 2_000, date: '2026-10-20', number: 'CR-B-1' });
    const aClaim = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z') });
    const aLine = await addCreditLine(db, A, { agorot: 1_000, date: '2026-10-20', number: 'CR-A-4' });

    const aList = await caller(A).recovery.creditSuggestions();
    expect(aList.some((s) => s.invoiceLineId === bLine)).toBe(false);
    for (const sg of aList) {
      expect(sg.proposal.some((p) => p.claimId === bClaim)).toBe(false);
      expect(sg.openClaims.some((c) => c.claimId === bClaim)).toBe(false);
    }
    await expect(caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: bLine, claimIds: [aClaim] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: aLine, claimIds: [bClaim] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, B.restaurantId))).toHaveLength(0);
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, A.restaurantId))).toHaveLength(0);
    const [b] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, bClaim));
    expect(b!.status).toBe('letter_sent');
    expect(b!.creditedAgorot).toBe(0);
  });

  it('a before-VAT credit line never proposes or closes an incl-VAT (duplicate) or VAT-only claim', async () => {
    const dup = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z'), amountAgorot: 11_700, type: 'DUPLICATE_INVOICE' });
    const vat = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-02T08:00:00Z'), amountAgorot: 1_700, type: 'VAT_MISMATCH' });
    const net = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-03T08:00:00Z'), amountAgorot: 2_000 });
    const lineId = await addCreditLine(db, A, { agorot: 5_000, date: '2026-10-04', number: 'CR-A-6' });
    const s = (await caller(A).recovery.creditSuggestions()).find((x) => x.invoiceLineId === lineId)!;
    expect(s.proposal).toEqual([{ claimId: net, agorot: 2_000 }]);
    expect(s.remainderAgorot).toBe(3_000);
    expect(s.openClaims.map((c) => c.claimId)).toEqual([net]);
    for (const id of [dup, vat]) {
      await expect(caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [id] })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'basis_mismatch',
      });
    }
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, A.restaurantId))).toHaveLength(0);
  });

  it('receiver and chef → FORBIDDEN; flag off → FEATURE_DISABLED', async () => {
    const lineId = await addCreditLine(db, A, { agorot: 1_000, date: '2026-10-20', number: 'CR-A-5' });
    const c = await addClaim(db, A, { status: 'letter_sent', claimedAt: new Date('2026-10-01T08:00:00Z') });
    for (const role of ['receiver', 'chef'] as const) {
      await expect(caller(A, role).recovery.creditSuggestions()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(A, role).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [c] })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    await setSettings(db, A, { features: {} });
    const err = await caller(A).recovery.creditSuggestions().catch((e: unknown) => e);
    expect((err as { cause?: { appCode?: string } }).cause?.appCode).toBe('FEATURE_DISABLED');
    const err2 = await caller(A).recovery.confirmCreditSuggestion({ invoiceLineId: lineId, claimIds: [c] }).catch((e: unknown) => e);
    expect((err2 as { cause?: { appCode?: string } }).cause?.appCode).toBe('FEATURE_DISABLED');
  });
});
