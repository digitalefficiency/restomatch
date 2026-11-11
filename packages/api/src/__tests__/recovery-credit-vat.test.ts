/**
 * W2-10 — a credit note is entered the way it is printed (chain-09, acceptance 8):
 * the server converts incl. → excl. VAT in agorot, half-up, at
 * `suppliers.vat_rate ?? restaurants.vat_rate` (never the engine's 0.17).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditNotes, discrepancies, eq, recoveryClaims, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { creditVatRateBp, exclVatAgorot, materializeClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;
let O: Tenant;

const caller = () => appRouter.createCaller({ db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' } } as AppContext);

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'V');
  O = await seedTenant(db, 'VO');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
});

beforeEach(async () => {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.delete(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
  await db.update(suppliers).set({ vatRate: null }).where(eq(suppliers.id, T.supplierId));
  await db.update(restaurants).set({ vatRate: '0.1800' }).where(eq(restaurants.id, T.restaurantId));
  await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, T.discrepancyId));
  await materializeClaims(db, { restaurantId: T.restaurantId, discrepancyIds: [T.discrepancyId], actorId: T.ownerUserId });
});

afterAll(async () => {
  await resetDb(db);
});

describe('exclVatAgorot (pure)', () => {
  it('₪118.00 incl. at 0.18 → ₪100.00; excl. passes through', () => {
    expect(exclVatAgorot(11_800, 'incl', 1800)).toBe(10_000);
    expect(exclVatAgorot(11_800, 'excl', 1800)).toBe(11_800);
    expect(exclVatAgorot(117_00, 'incl', 1700)).toBe(100_00);
  });

  it('rounds half-up at .005 agora', () => {
    // 1.18 × 0.5 = 0.59 → 59 agorot incl. is exactly 50.0 excl.; 1 agora incl. = 0.847… → 1.
    expect(exclVatAgorot(59, 'incl', 1800)).toBe(50);
    expect(exclVatAgorot(1, 'incl', 1800)).toBe(1);
    // 5.9 agorot excl. exactly half: 6.962 incl. → pick the half-up boundary at rate 0 (identity) and 100%.
    expect(exclVatAgorot(3, 'incl', 10_000)).toBe(2); // 1.5 → 2 (half-up, not banker's)
    expect(exclVatAgorot(5, 'incl', 10_000)).toBe(3); // 2.5 → 3
    expect(exclVatAgorot(1, 'incl', 10_000)).toBe(1); // 0.5 → 1
  });

  it('refuses a non-positive or fractional amount and an out-of-range rate', () => {
    expect(() => exclVatAgorot(0, 'incl', 1800)).toThrow();
    expect(() => exclVatAgorot(10.5, 'incl', 1800)).toThrow();
    expect(() => exclVatAgorot(100, 'incl', -1)).toThrow();
  });
});

describe('creditVatRateBp', () => {
  it('uses the restaurant rate when the supplier has none, and the supplier rate when set', async () => {
    expect(await creditVatRateBp(db, T.restaurantId, T.supplierId)).toBe(1800);
    await db.update(suppliers).set({ vatRate: '0.0000' }).where(eq(suppliers.id, T.supplierId));
    expect(await creditVatRateBp(db, T.restaurantId, T.supplierId)).toBe(0);
  });

  it('a foreign supplier is NOT_FOUND', async () => {
    await expect(creditVatRateBp(db, T.restaurantId, O.supplierId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('recovery.recordCreditNote with printedAgorot + vat', () => {
  async function record(printedAgorot: number, vat: 'incl' | 'excl') {
    const [claim] = await caller().recovery.list();
    return caller().recovery.recordCreditNote({
      claimIds: [claim!.id],
      supplierId: T.supplierId,
      printedAgorot,
      vat,
      issuedOn: '2026-10-20',
    });
  }

  it('₪118.00 printed incl. VAT credits ₪100.00 (the claim, fully)', async () => {
    const res = await record(11_800, 'incl');
    expect(res).toMatchObject({ allocatedAgorot: 10_000, unallocatedAgorot: 0 });
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
    expect(note!.amountAgorot).toBe(10_000);
  });

  it('the supplier rate wins over the restaurant rate (0% supplier: incl. = excl.)', async () => {
    await db.update(suppliers).set({ vatRate: '0.0000' }).where(eq(suppliers.id, T.supplierId));
    const res = await record(6_000, 'incl');
    expect(res.allocatedAgorot).toBe(6_000);
  });

  it('excl. is taken as typed', async () => {
    const res = await record(4_000, 'excl');
    expect(res.allocatedAgorot).toBe(4_000);
  });

  it('a printed amount without its VAT mode is refused (no default)', async () => {
    const [claim] = await caller().recovery.list();
    await expect(
      caller().recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, printedAgorot: 11_800, issuedOn: '2026-10-20' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller().recovery.recordCreditNote({
        claimIds: [claim!.id],
        supplierId: T.supplierId,
        printedAgorot: 11_800,
        amountAgorot: 10_000,
        vat: 'incl',
        issuedOn: '2026-10-20',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a foreign supplier with a printed amount is NOT_FOUND', async () => {
    const [claim] = await caller().recovery.list();
    await expect(
      caller().recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: O.supplierId, printedAgorot: 11_800, vat: 'incl', issuedOn: '2026-10-20' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
