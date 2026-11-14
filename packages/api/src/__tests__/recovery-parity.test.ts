/**
 * W2-10 — the shared parity (deep-fix class 5, acceptance 13), recovery side:
 * Σ letters = Σ open `claimed` claims, to the agora; no discrepancy appears in
 * two letters (or twice in one); only decided gaps. W2-03's
 * payrun-parity.test.ts asserts the pay-run credit side. Read-only on the data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns, recoveryClaims, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { buildClaimLetters } from '../recovery/letters';
import { materializeClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;
const decided: string[] = [];

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'P');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
  // A second supplier with its own paid invoice and two gaps (one undecided).
  const [s2] = await db.insert(suppliers).values({ restaurantId: T.restaurantId, name: 'ספק שני' }).returning();
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: T.restaurantId, supplierId: s2!.id, invoiceNumber: 'P-2', invoiceDate: new Date(), source: 'manual', status: 'paid', totalInclVat: '500.00' })
    .returning();
  const [run] = await db.insert(matchRuns).values({ restaurantId: T.restaurantId, invoiceId: inv!.id, overallStatus: 'minor' }).returning();
  const mk = (deltaAmount: string, resolutionStatus: 'accepted' | 'open', type: 'PRICE_HIGHER' | 'QTY_OVER' | 'MISSING_ON_INVOICE' = 'PRICE_HIGHER') =>
    db
      .insert(discrepancies)
      .values({ matchRunId: run!.id, restaurantId: T.restaurantId, type, severity: 'warn', deltaAmount, resolutionStatus, resolvedAt: resolutionStatus === 'open' ? null : new Date() })
      .returning();
  const [a] = await mk('33.33', 'accepted');
  const [b] = await mk('0.01', 'accepted', 'QTY_OVER');
  const [u] = await mk('99.99', 'open');
  const [m] = await mk('40.00', 'accepted', 'MISSING_ON_INVOICE');
  await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, T.discrepancyId));
  decided.push(T.discrepancyId, a!.id, b!.id);
  await materializeClaims(db, { restaurantId: T.restaurantId, discrepancyIds: [...decided, u!.id, m!.id], actorId: T.ownerUserId });
});

afterAll(async () => {
  await resetDb(db);
});

describe('recovery parity', () => {
  it('Σ letters = Σ claimed claims outstanding, to the agora', async () => {
    const letters = await buildClaimLetters(db, T.restaurantId);
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    const claimed = claims.filter((c) => c.status === 'claimed').reduce((a, c) => a + c.amountAgorot - c.creditedAgorot, 0);
    expect(letters.reduce((a, l) => a + l.totalAgorot, 0)).toBe(claimed);
    expect(claimed).toBe(10_000 + 3_333 + 1);
    expect(letters).toHaveLength(2);
  });

  it('no discrepancy appears in two letters, nor twice in one; only decided, claimable gaps', async () => {
    const letters = await buildClaimLetters(db, T.restaurantId);
    const ds = letters.flatMap((l) => [...l.beforePayment, ...l.forCredit].map((x) => x.discrepancyId));
    expect(new Set(ds).size).toBe(ds.length);
    expect([...ds].sort()).toEqual([...decided].sort());
  });

  it('the paid supplier is "for credit" only; the unpaid one "before payment" only (decision 19)', async () => {
    const letters = await buildClaimLetters(db, T.restaurantId);
    const second = letters.find((l) => l.supplierName === 'ספק שני')!;
    expect(second.beforePayment).toHaveLength(0);
    expect(second.forCreditAgorot).toBe(3_334);
    const first = letters.find((l) => l.supplierId === T.supplierId)!;
    expect(first.forCredit).toHaveLength(0);
    expect(first.beforePaymentAgorot).toBe(10_000);
  });
});
