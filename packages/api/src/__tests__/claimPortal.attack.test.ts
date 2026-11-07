import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  testDbUrl,
  withRestaurant,
} from '@restomatch/db';
import { loadClaimLetter, mintClaimLink, resolveClaimLink, submitClaimAnswer } from '../claimPortal/service';
import { signClaimToken } from '../claimPortal/token';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * H-06ʰ public-route attack suite: the supplier's reply link for a
 * "מכתב בקשת זיכוי". Add-only (tenant-security-warden reviews).
 *
 * The token is the only credential, so every test asks: can a link reach a row
 * that is not (its restaurant, its supplier, its letter)? Can it move ₪? Can it
 * answer twice? Does anything internal leak into the supplier's view?
 */

const db = createDb(testDbUrl());
const ENV = { CLAIM_PORTAL_SECRET: 's'.repeat(48) } as NodeJS.ProcessEnv;
const SENT = new Date('2026-10-20T08:00:00.000Z');
const NOW = new Date('2026-10-21T09:40:00.000Z');
const INTERNAL = 'INTERNAL-NOTE-do-not-show';

let A: Tenant;
let B: Tenant;

async function claim(t: Tenant, over: Partial<typeof recoveryClaims.$inferInsert> = {}): Promise<string> {
  const [d] = await db
    .insert(discrepancies)
    .values({
      matchRunId: t.matchRunId,
      restaurantId: t.restaurantId,
      invoiceLineId: t.invoiceLineId,
      productId: t.productId,
      type: 'PRICE_HIGHER',
      severity: 'block',
      deltaAmount: '17.00',
      resolutionStatus: 'accepted',
    })
    .returning({ id: discrepancies.id });
  const [c] = await db
    .insert(recoveryClaims)
    .values({
      restaurantId: t.restaurantId,
      discrepancyId: d!.id,
      supplierId: t.supplierId,
      invoiceId: t.invoiceId,
      amountAgorot: 1700,
      status: 'letter_sent',
      letterSentAt: SENT,
      note: INTERNAL,
      ...over,
    })
    .returning({ id: recoveryClaims.id });
  return c!.id;
}

async function wipe(t: Tenant) {
  await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, t.restaurantId));
  const cs = await db.select({ d: recoveryClaims.discrepancyId }).from(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
  for (const c of cs) if (c.d !== t.discrepancyId) await db.delete(discrepancies).where(eq(discrepancies.id, c.d));
}

async function setRecovery(t: Tenant, on: boolean) {
  await db
    .update(restaurants)
    .set({ settings: { features: on ? { all: true } : { all: true, recovery: false } } as never })
    .where(eq(restaurants.id, t.restaurantId));
}

function linkFor(t: Tenant, supplierId = t.supplierId, now = NOW) {
  return signClaimToken({ restaurantId: t.restaurantId, supplierId, now }, ENV).token;
}

async function resolved(token: string) {
  const r = await resolveClaimLink(db, token, NOW, ENV);
  if (!r.ok) throw new Error(`expected a link, got ${r.error}`);
  return r.link;
}

const statusOf = async (id: string) =>
  (await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, id)))[0]!;

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

beforeEach(async () => {
  await wipe(A);
  await wipe(B);
  await setRecovery(A, true);
  await setRecovery(B, true);
});

afterAll(async () => {
  await wipe(A);
  await wipe(B);
  await resetDb(db);
});

describe('claim portal: resolve', () => {
  it('a valid link of an existing, flag-on restaurant resolves to its own ids', async () => {
    const link = await resolved(linkFor(A));
    expect(link.restaurantId).toBe(A.restaurantId);
    expect(link.supplierId).toBe(A.supplierId);
  });

  it('flag off, FEATURES_OFF kill-switch, unknown restaurant and no secret are all NOT_FOUND', async () => {
    const token = linkFor(A);
    await setRecovery(A, false);
    expect(await resolveClaimLink(db, token, NOW, ENV)).toEqual({ ok: false, error: 'NOT_FOUND' });
    await setRecovery(A, true);
    expect(await resolveClaimLink(db, token, NOW, { ...ENV, FEATURES_OFF: 'recovery' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    const ghost = signClaimToken({ restaurantId: '00000000-0000-4000-8000-000000000000', supplierId: A.supplierId, now: NOW }, ENV).token;
    expect(await resolveClaimLink(db, ghost, NOW, ENV)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await resolveClaimLink(db, token, NOW, {})).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('a link past 72 h is EXPIRED', async () => {
    const token = linkFor(A, A.supplierId, new Date(NOW.getTime() - 73 * 3600 * 1000));
    expect(await resolveClaimLink(db, token, NOW, ENV)).toEqual({ ok: false, error: 'EXPIRED' });
  });
});

describe('claim portal: the view is this letter only, supplier-safe', () => {
  it('shows only this restaurant + supplier, letter_sent, sent ≤ issuedAt — and no internal words', async () => {
    const mine = await claim(A);
    await claim(A, { status: 'claimed', letterSentAt: null }); // not sent
    await claim(A, { status: 'acknowledged' }); // already answered
    await claim(A, { letterSentAt: new Date(NOW.getTime() + 60_000) }); // sent after the link
    await claim(B); // other tenant
    const link = await resolved(linkFor(A));
    const view = await withRestaurant(db, A.restaurantId, (tx) => loadClaimLetter(tx, link));
    expect(view!.lines.map((l) => l.claimId)).toEqual([mine]);
    expect(view!.totalAgorot).toBe(1700);
    expect(view!.lines[0]!.reason).toBe('price');
    const json = JSON.stringify(view);
    expect(json).not.toContain(INTERNAL);
    expect(json).not.toContain('PRICE_HIGHER');
    expect(json).not.toContain('letter_sent');
    expect(json).not.toContain(B.restaurantId);
  });

  it('a link that pairs tenant A with tenant B’s supplier shows nothing', async () => {
    await claim(A);
    await claim(B);
    const link = await resolved(linkFor(A, B.supplierId));
    const view = await withRestaurant(db, A.restaurantId, (tx) => loadClaimLetter(tx, link));
    expect(view!.lines).toEqual([]);
    expect(view!.supplierName).toBeNull();
  });

  it('a fully credited line is not shown (nothing left to ask for)', async () => {
    await claim(A, { creditedAgorot: 1700 });
    const link = await resolved(linkFor(A));
    const view = await withRestaurant(db, A.restaurantId, (tx) => loadClaimLetter(tx, link));
    expect(view!.lines).toEqual([]);
  });
});

describe('claim portal: the answer', () => {
  it('moves letter_sent → acknowledged / disputed, writes events with actor NULL, keeps the internal note and every ₪', async () => {
    const yes = await claim(A);
    const check = await claim(A);
    const link = await resolved(linkFor(A));
    const res = await withRestaurant(db, A.restaurantId, (tx) =>
      submitClaimAnswer(
        tx,
        link,
        {
          lines: [
            { claimId: yes, answer: 'agree' },
            { claimId: check, answer: 'check', note: 'יש תעודה חתומה‮' },
          ],
          creditNoteNumber: 'CN-77',
        },
        NOW,
      ),
    );
    expect(res).toEqual({ ok: true, acknowledged: 1, checking: 1 });
    const a = await statusOf(yes);
    const c = await statusOf(check);
    expect([a.status, c.status]).toEqual(['acknowledged', 'disputed']);
    expect(a.acknowledgedAt?.toISOString()).toBe(NOW.toISOString());
    for (const row of [a, c]) {
      expect(row.note).toBe(INTERNAL);
      expect(row.amountAgorot).toBe(1700);
      expect(row.creditedAgorot).toBe(0);
      expect(row.creditNoteId).toBeNull();
    }
    const events = await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, check));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBeNull();
    expect(events[0]!.note).toContain('נבדוק יחד');
    expect(events[0]!.note).toContain('CN-77');
    expect(events[0]!.note).not.toContain('‮');
  });

  it('a replay is ALREADY_ANSWERED and writes nothing', async () => {
    const id = await claim(A);
    const link = await resolved(linkFor(A));
    const answer = { lines: [{ claimId: id, answer: 'agree' as const }] };
    await withRestaurant(db, A.restaurantId, (tx) => submitClaimAnswer(tx, link, answer, NOW));
    const again = await withRestaurant(db, A.restaurantId, (tx) =>
      submitClaimAnswer(tx, link, { lines: [{ claimId: id, answer: 'check' }] }, NOW),
    );
    expect(again).toEqual({ ok: false, error: 'ALREADY_ANSWERED' });
    expect((await statusOf(id)).status).toBe('acknowledged');
    expect(await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, id))).toHaveLength(1);
  });

  it('a foreign claim id (other tenant) in the body refuses the WHOLE answer; nothing moves on either side', async () => {
    const mine = await claim(A);
    const theirs = await claim(B);
    const link = await resolved(linkFor(A));
    const res = await withRestaurant(db, A.restaurantId, (tx) =>
      submitClaimAnswer(
        tx,
        link,
        { lines: [{ claimId: mine, answer: 'agree' }, { claimId: theirs, answer: 'agree' }] },
        NOW,
      ),
    );
    expect(res).toEqual({ ok: false, error: 'INVALID_LINES' });
    expect((await statusOf(mine)).status).toBe('letter_sent');
    expect((await statusOf(theirs)).status).toBe('letter_sent');
    expect(await db.select().from(recoveryEvents).where(eq(recoveryEvents.restaurantId, B.restaurantId))).toHaveLength(0);
  });

  it('A’s link carrying B’s supplier id cannot touch B’s claim even when run in B’s tenant', async () => {
    const theirs = await claim(B);
    const forged = await resolved(linkFor(A, B.supplierId));
    const res = await withRestaurant(db, B.restaurantId, (tx) =>
      submitClaimAnswer(tx, forged, { lines: [{ claimId: theirs, answer: 'agree' }] }, NOW),
    );
    expect(res).toEqual({ ok: false, error: 'INVALID_LINES' });
    expect((await statusOf(theirs)).status).toBe('letter_sent');
  });

  it('same tenant, another supplier, a line sent after issuedAt, empty and duplicate lists are INVALID_LINES', async () => {
    const later = await claim(A, { letterSentAt: new Date(NOW.getTime() + 60_000) });
    const link = await resolved(linkFor(A));
    const otherSupplier = await resolved(linkFor(A, B.supplierId));
    const mine = await claim(A);
    const run = (l: typeof link, lines: { claimId: string; answer: 'agree' | 'check' }[]) =>
      withRestaurant(db, A.restaurantId, (tx) => submitClaimAnswer(tx, l, { lines }, NOW));
    expect(await run(link, [{ claimId: later, answer: 'agree' }])).toEqual({ ok: false, error: 'INVALID_LINES' });
    expect(await run(otherSupplier, [{ claimId: mine, answer: 'agree' }])).toEqual({ ok: false, error: 'INVALID_LINES' });
    expect(await run(link, [])).toEqual({ ok: false, error: 'INVALID_LINES' });
    expect(
      await run(link, [
        { claimId: mine, answer: 'agree' },
        { claimId: mine, answer: 'check' },
      ]),
    ).toEqual({ ok: false, error: 'INVALID_LINES' });
    expect((await statusOf(mine)).status).toBe('letter_sent');
    expect((await statusOf(later)).status).toBe('letter_sent');
  });
});

describe('claim portal: mint', () => {
  it('mints only for this tenant’s supplier with a sent line, and only with the secret set', async () => {
    await claim(A);
    const ok = await withRestaurant(db, A.restaurantId, (tx) => mintClaimLink(tx, A.restaurantId, A.supplierId, { now: NOW, env: ENV }));
    expect(ok?.token).toMatch(/^c1\./);
    expect((await resolveClaimLink(db, ok!.token, NOW, ENV)).ok).toBe(true);
    // B's supplier, through A's scope → nothing.
    await claim(B);
    expect(
      await withRestaurant(db, A.restaurantId, (tx) => mintClaimLink(tx, A.restaurantId, B.supplierId, { now: NOW, env: ENV })),
    ).toBeNull();
    // Portal off → nothing.
    expect(
      await withRestaurant(db, A.restaurantId, (tx) => mintClaimLink(tx, A.restaurantId, A.supplierId, { now: NOW, env: {} })),
    ).toBeNull();
  });

  it('no sent line → no link', async () => {
    await claim(A, { status: 'claimed', letterSentAt: null });
    expect(
      await withRestaurant(db, A.restaurantId, (tx) => mintClaimLink(tx, A.restaurantId, A.supplierId, { now: NOW, env: ENV })),
    ).toBeNull();
  });
});
