import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, notificationsOutbox, recoveryClaims, recoveryEvents, suppliers, testDbUrl } from '@restomatch/db';
import { supplierReminderDraft } from '../recovery/reminders';
import { addClaim, setSettings } from './au03-helpers';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-03 (c), orchestrator 14.11 + train-C gate follow-ups due 15.11: W2-10's
 * reminder draft (`recovery.reminderDraft`) runs on the ONE chase predicate
 * (recovery/overdue.ts) and the chase.ts addressing — so the draft, the 08:30
 * digest and the desk badge always name the same claims and the same ₪.
 *  • an unsent request (status `claimed`, no letter) is never in a chase figure;
 *  • `chaseAcknowledged` off drops acknowledged claims from the draft;
 *  • never-claimable types are excluded;
 *  • the boundary is whole Israel calendar days (> 7), never the runner clock;
 *  • WhatsApp is E.164 digits (05x → 9725x); an invalid e-mail is null.
 */
const db = createDb(testDbUrl());
let T: Tenant;
// 25.10 13:00 IL. A letter on 17.10 is 8 days old (chased); on 18.10, 7 days (not yet).
const NOW = new Date('2026-10-25T10:00:00.000Z');
const DAY8 = new Date('2026-10-17T20:30:00.000Z'); // 17.10 23:30 IL
const DAY7 = new Date('2026-10-17T21:30:00.000Z'); // 18.10 00:30 IL
const OLD = new Date('2026-10-05T08:00:00.000Z');

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'RD');
});
beforeEach(async () => {
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));
  await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, T.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await setSettings(db, T, { features: { all: true } });
  await db.update(suppliers).set({ contactWhatsapp: '052-123-4567', contactEmail: 'office@sharon.test' } as never).where(eq(suppliers.id, T.supplierId));
});
afterAll(async () => {
  await resetDb(db);
});

describe('AU-03 · supplierReminderDraft on the one chase predicate (DB)', () => {
  it('never counts an unsent request (claimed, no letter) — train-C gate 11.11', async () => {
    const sent = await addClaim(db, T, { status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD, amountAgorot: 4_000 });
    await addClaim(db, T, { status: 'claimed', claimedAt: OLD, amountAgorot: 9_999 });
    const d = await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(d.claimIds).toEqual([sent]);
    expect(d.count).toBe(1);
    expect(d.outstandingAgorot).toBe(4_000);
  });

  it('honours chaseAcknowledged: on (default) includes acknowledged, off drops it', async () => {
    const ack = await addClaim(db, T, { status: 'acknowledged', letterSentAt: OLD, claimedAt: OLD, amountAgorot: 2_000, creditedAgorot: 500 });
    let d = await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(d.claimIds).toEqual([ack]);
    expect(d.outstandingAgorot).toBe(1_500);
    await setSettings(db, T, { features: { all: true }, automations: { chaseAcknowledged: false } });
    d = await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(d.count).toBe(0);
    expect(d.claimIds).toEqual([]);
  });

  it('excludes never-claimable types and fully credited claims', async () => {
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD, type: 'MISSING_ON_INVOICE' });
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD, amountAgorot: 1_000, creditedAgorot: 1_000 });
    expect((await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW)).count).toBe(0);
  });

  it('boundary in whole Israel calendar days: day 8 is chased, day 7 is not (one hour apart in UTC)', async () => {
    const d8 = await addClaim(db, T, { status: 'letter_sent', letterSentAt: DAY8, claimedAt: DAY8 });
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: DAY7, claimedAt: DAY7 });
    const d = await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(d.claimIds).toEqual([d8]);
    expect(d.oldestDays).toBe(8);
    expect(d.oldestSentAt).toBe(DAY8.toISOString());
  });

  it('addresses: WhatsApp as E.164 digits (05x → 9725x); an invalid e-mail is null', async () => {
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD });
    let d = await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(d.whatsapp).toBe('972521234567');
    expect(d.email).toBe('office@sharon.test');
    await db.update(suppliers).set({ contactWhatsapp: '123', contactEmail: 'not an email' } as never).where(eq(suppliers.id, T.supplierId));
    d = await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(d.whatsapp).toBeNull();
    expect(d.email).toBeNull();
  });

  it('writes and queues nothing (a draft only — nothing is sent to a supplier)', async () => {
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: OLD, claimedAt: OLD });
    await supplierReminderDraft(db, T.restaurantId, T.supplierId, NOW);
    expect(await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId))).toHaveLength(0);
    expect(await db.select().from(recoveryEvents).where(eq(recoveryEvents.restaurantId, T.restaurantId))).toHaveLength(0);
  });
});
