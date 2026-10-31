/**
 * W2-10 — tenant wall around the letters, the reminder draft and the export
 * (coverage/W2-10.ts). Tenant A calls with tenant B's ids.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, recoveryClaims, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { materializeClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let aClaim: string;
let bClaim: string;

const callerFor = (t: Tenant) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'LA');
  B = await seedTenant(db, 'LB');
  for (const t of [A, B]) {
    await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, t.restaurantId));
    await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, t.discrepancyId));
    await materializeClaims(db, { restaurantId: t.restaurantId, discrepancyIds: [t.discrepancyId], actorId: t.ownerUserId });
  }
  await db.update(suppliers).set({ contactEmail: 'b-secret@supplier.test', contactWhatsapp: '+972500000000' }).where(eq(suppliers.id, B.supplierId));
  const ids = await Promise.all(
    [A, B].map(async (t) => (await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId)))[0]!.id),
  );
  aClaim = ids[0]!;
  bClaim = ids[1]!;
});

afterAll(async () => {
  await resetDb(db);
});

const status = async (id: string) => (await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, id)))[0]!.status;

describe('recovery letters (A → B)', () => {
  it('recovery.letters holds only A claims; a foreign supplierId returns nothing', async () => {
    const all = await callerFor(A).recovery.letters();
    expect(all.flatMap((l) => l.claimIds)).toEqual([aClaim]);
    expect(JSON.stringify(all)).not.toContain(bClaim);
    expect(await callerFor(A).recovery.letters({ supplierId: B.supplierId })).toEqual([]);
  });

  it('recovery.sendLetter: a foreign supplierId or claimId is NOT_FOUND and nothing moves', async () => {
    await expect(
      callerFor(A).recovery.sendLetter({ supplierId: B.supplierId, claimIds: [bClaim], channel: 'email' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callerFor(A).recovery.sendLetter({ supplierId: A.supplierId, claimIds: [aClaim, bClaim], channel: 'email' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await status(aClaim)).toBe('claimed');
    expect(await status(bClaim)).toBe('claimed');
  });

  it('recovery.unsendLetter: a foreign claimId is NOT_FOUND and B stays letter_sent', async () => {
    await callerFor(B).recovery.sendLetter({ supplierId: B.supplierId, claimIds: [bClaim], channel: 'whatsapp' });
    expect(await status(bClaim)).toBe('letter_sent');
    await expect(callerFor(A).recovery.unsendLetter({ claimIds: [bClaim] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await status(bClaim)).toBe('letter_sent');
  });

  it('recovery.reminderDraft: a foreign supplierId is NOT_FOUND (no contact or ₪ leaks)', async () => {
    const err = await callerFor(A).recovery.reminderDraft({ supplierId: B.supplierId }).catch((e: unknown) => e as { code?: string; message?: string });
    expect(err).toMatchObject({ code: 'NOT_FOUND' });
    expect(JSON.stringify(err)).not.toContain('b-secret');
  });

  it('recovery.export (csv + xlsx) of A never contains a B claim or supplier', async () => {
    for (const format of ['csv', 'xlsx'] as const) {
      const out = await callerFor(A).recovery.export({ format });
      expect(out.count).toBe(1);
      const text = Buffer.from(out.base64, 'base64').toString(format === 'csv' ? 'utf8' : 'latin1');
      if (format === 'csv') {
        expect(text).toContain(aClaim);
        expect(text).not.toContain(bClaim);
        expect(text).not.toContain('ספק LB');
      }
    }
    const foreign = await callerFor(A).recovery.export({ format: 'csv', supplierId: B.supplierId });
    expect(foreign.count).toBe(0);
  });
});
