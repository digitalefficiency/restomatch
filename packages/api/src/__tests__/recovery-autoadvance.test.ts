/**
 * W2-10 — auto-advance (acceptance 9, chain-10): a fully credited claim whose
 * credit line sits on an invoice that becomes paid moves to `recovered` with
 * "קוזז בחשבונית X ששולמה dd.MM". Driven by a fixture until G-05's paid event
 * (W2-03 markPaid) ships.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditNotes, discrepancies, eq, invoiceLines, invoices, recoveryClaims, recoveryEvents, restaurants, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { autoAdvanceOnPaid, materializeClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;
let creditInvoiceId: string;
let creditLineId: string;

const caller = () => appRouter.createCaller({ db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' } } as AppContext);

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'AA');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
  // A later invoice of the same supplier carrying a credit line (−₪100.00).
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, invoiceNumber: 'INV-77', invoiceDate: new Date(Date.now() + 86_400_000), source: 'manual', status: 'approved', totalInclVat: '20.00' })
    .returning();
  creditInvoiceId = inv!.id;
  const [line] = await db
    .insert(invoiceLines)
    .values({ invoiceId: inv!.id, rawDescription: 'זיכוי', qtyBilled: '1', unit: 'יח׳', unitPriceBilled: '-100.00', lineTotal: '-100.00' })
    .returning();
  creditLineId = line!.id;
});

beforeEach(async () => {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.delete(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
  await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, creditInvoiceId));
  await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, T.discrepancyId));
  await materializeClaims(db, { restaurantId: T.restaurantId, discrepancyIds: [T.discrepancyId], actorId: T.ownerUserId });
});

afterAll(async () => {
  await resetDb(db);
});

describe('autoAdvanceOnPaid', () => {
  it('credited in full on a credit line → recovered when that invoice is paid, with the offset note, as a system step', async () => {
    const [claim] = await caller().recovery.list();
    await caller().recovery.recordCreditNote({ claimIds: [claim!.id], invoiceLineId: creditLineId });
    expect((await caller().recovery.list())[0]!.status).toBe('credited');
    // Not paid yet: nothing moves.
    expect(await db.transaction((tx) => autoAdvanceOnPaid(tx as never, T.restaurantId, creditInvoiceId))).toEqual([]);
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, creditInvoiceId));
    const at = new Date('2026-11-12T10:00:00Z');
    const moved = await db.transaction((tx) => autoAdvanceOnPaid(tx as never, T.restaurantId, creditInvoiceId, at));
    expect(moved).toEqual([claim!.id]);
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claim!.id));
    expect(c).toMatchObject({ status: 'recovered', note: 'קוזז בחשבונית INV-77 ששולמה 12.11' });
    const ev = (await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, claim!.id))).at(-1)!;
    expect(ev).toMatchObject({ fromStatus: 'credited', toStatus: 'recovered', actorId: null });
    // Idempotent.
    expect(await db.transaction((tx) => autoAdvanceOnPaid(tx as never, T.restaurantId, creditInvoiceId, at))).toEqual([]);
  });

  it('a partly credited claim stays credited (the shortfall is a person’s call)', async () => {
    const [claim] = await caller().recovery.list();
    await db.update(invoiceLines).set({ lineTotal: '-40.00', unitPriceBilled: '-40.00' }).where(eq(invoiceLines.id, creditLineId));
    try {
      await caller().recovery.recordCreditNote({ claimIds: [claim!.id], invoiceLineId: creditLineId });
      await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, creditInvoiceId));
      expect(await db.transaction((tx) => autoAdvanceOnPaid(tx as never, T.restaurantId, creditInvoiceId))).toEqual([]);
      expect((await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claim!.id)))[0]!.status).toBe('credited');
    } finally {
      await db.update(invoiceLines).set({ lineTotal: '-100.00', unitPriceBilled: '-100.00' }).where(eq(invoiceLines.id, creditLineId));
    }
  });

  it('a manual credit note (no invoice) never auto-advances', async () => {
    const [claim] = await caller().recovery.list();
    await caller().recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, amountAgorot: 10_000, issuedOn: '2026-10-20' });
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, creditInvoiceId));
    expect(await db.transaction((tx) => autoAdvanceOnPaid(tx as never, T.restaurantId, creditInvoiceId))).toEqual([]);
  });
});
