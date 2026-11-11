import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, goodsReceipts, invoices, matchRuns, restaurants } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { ledgerMonths } from '../ledger';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Supplier ledger (flag `supplierLedger`): delivery notes vs invoices per
 * calendar month. The fixture tenant has one PO → one goods receipt (5 kg ×
 * ₪8.50 = ₪42.50) → one invoice (₪100.00 excl. VAT), linked by a match run.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function flagOn(t: Tenant) {
  await db.update(restaurants).set({ settings: { features: { supplierLedger: true } } } as never).where(eq(restaurants.id, t.restaurantId));
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, t.grId));
});
afterAll(async () => {
  await resetDb(db);
});

describe('suppliers.ledger', () => {
  it('is refused while the flag is off', async () => {
    await expect(callerFor(A).suppliers.ledger({ supplierId: A.supplierId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'FEATURE_DISABLED' },
    });
    await expect(callerFor(A).suppliers.ledgerGrid()).rejects.toMatchObject({ cause: { appCode: 'FEATURE_DISABLED' } });
  });

  it('buckets the delivery note and the invoice into the current month, in agorot', async () => {
    await flagOn(A);
    const l = await callerFor(A).suppliers.ledger({ supplierId: A.supplierId, months: 6 });
    expect(l.months).toHaveLength(6);
    const m = l.months[0]!;
    expect(m.current).toBe(true);
    expect(m.month).toBe(ledgerMonths(new Date(), 'Asia/Jerusalem', 1)[0]!.key);
    expect(m.notes).toEqual({ count: 1, agorot: 4250 });
    expect(m.invoices.regular).toMatchObject({ count: 1, exclVatAgorot: 10000 });
    expect(m.invoices.consolidated.count).toBe(0);
    expect(m.uninvoicedNotes.count).toBe(0);
    expect(m.invoicesWithoutNote.count).toBe(0);
    // Billed ₪100 for ₪42.50 delivered: whatever the engine's leak doesn't explain is a T2 gap.
    const unexplained = 10000 - 4250 - m.leakAgorot;
    expect(m.status).toEqual(unexplained > 100 ? { kind: 'diff', diffAgorot: unexplained } : { kind: 'matched' });
    expect(m.openBalanceAgorot).toBe(m.invoices.regular.inclVatAgorot - m.paidAgorot);
    const d = l.detail[m.month]!;
    expect(d.notes[0]).toMatchObject({ grId: A.grId, state: 'covered', invoiceId: A.invoiceId });
    expect(d.invoices[0]).toMatchObject({ invoiceId: A.invoiceId, deliveryNotes: 1, consolidated: false });
  });

  it('an unbilled delivery note in the current month is calm "open", not a discrepancy', async () => {
    await flagOn(A);
    await db.delete(matchRuns).where(eq(matchRuns.id, A.matchRunId));
    // Move the invoice well out of the note's period so nothing can hold the note.
    await db.update(invoices).set({ invoiceDate: new Date(Date.now() - 70 * 86_400_000) }).where(eq(invoices.id, A.invoiceId));
    const l = await callerFor(A).suppliers.ledger({ supplierId: A.supplierId });
    const m = l.months[0]!;
    expect(m.uninvoicedNotes).toEqual({ count: 1, agorot: 4250 });
    expect(m.status).toEqual({ kind: 'open', uninvoicedNotes: 1 });
    expect(l.detail[m.month]!.notes[0]).toMatchObject({ state: 'not_invoiced', invoiceId: null });
  });

  it('an ordinary invoice waiting for a PO link does not cover a note', async () => {
    await flagOn(A);
    await db.delete(matchRuns).where(eq(matchRuns.id, A.matchRunId));
    await db.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, A.invoiceId));
    const l = await callerFor(A).suppliers.ledger({ supplierId: A.supplierId });
    const m = l.months[0]!;
    expect(l.detail[m.month]!.notes[0]).toMatchObject({ state: 'not_invoiced', invoiceId: null });
    expect(m.uninvoicedNotes.count).toBe(1);
  });

  it('a pending consolidated invoice of the same period holds the note as a proposal', async () => {
    await flagOn(A);
    await db.delete(matchRuns).where(eq(matchRuns.id, A.matchRunId));
    await db
      .update(invoices)
      .set({ status: 'parsed', ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated' } } })
      .where(eq(invoices.id, A.invoiceId));
    const l = await callerFor(A).suppliers.ledger({ supplierId: A.supplierId });
    const m = l.months[0]!;
    expect(l.detail[m.month]!.notes[0]).toMatchObject({ state: 'in_consolidated', invoiceId: A.invoiceId });
    expect(m.uninvoicedNotes.count).toBe(0);
    expect(m.invoicesWithoutNote.count).toBe(0);
    // Awaiting the consolidated cross-match: calm T4 unless the ₪ says otherwise.
    expect(['pending', 'diff']).toContain(m.status.kind);
  });

  it('rejects a foreign supplier and the chef', async () => {
    await flagOn(A);
    await expect(callerFor(A).suppliers.ledger({ supplierId: B.supplierId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A, 'chef').suppliers.ledger({ supplierId: A.supplierId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A, 'chef').suppliers.ledgerGrid()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const role of ['manager', 'receiver', 'bookkeeper'] as const) {
      await expect(callerFor(A, role).suppliers.ledger({ supplierId: A.supplierId })).resolves.toBeTruthy();
    }
  });

  it('the grid lists only this restaurant’s suppliers', async () => {
    await flagOn(A);
    await flagOn(B);
    const g = await callerFor(A).suppliers.ledgerGrid({ months: 3 });
    expect(g.months).toHaveLength(3);
    expect(g.suppliers.map((s) => s.supplierId)).toEqual([A.supplierId]);
    expect(g.suppliers[0]!.cells[0]).toMatchObject({ notesAgorot: 4250, invoicedExclVatAgorot: 10000 });
  });
});
