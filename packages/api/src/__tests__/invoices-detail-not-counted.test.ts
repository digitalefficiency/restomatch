import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, goodsReceipts, grLines, invoiceLines, poLines, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-04 follow-up Q3 (owner decision 11.11): a closed receipt's line nobody counted has
 * no quantity check (§5.2). invoices.detail says so per line (`notCounted`), with the
 * same closed/counted truth the engine reads; the cockpit shows a neutral "לא נספר".
 */
const db = createDb(testDbUrl());
let A: Tenant;
const detail = (t: Tenant) =>
  appRouter
    .createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } })
    .invoices.detail({ invoiceId: t.invoiceId });
const lineOf = async (t: Tenant) => (await detail(t)).lines.find((l) => l.id === t.invoiceLineId)!;

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'NC');
  await db.update(invoiceLines).set({ productId: A.productId }).where(eq(invoiceLines.id, A.invoiceLineId));
  await db.update(poLines).set({ productId: A.productId }).where(eq(poLines.id, A.poLineId));
});
afterAll(async () => {
  await resetDb(db);
});

const closeReceipt = (status: 'completed' | 'partial') =>
  db.update(goodsReceipts).set({ status }).where(eq(goodsReceipts.id, A.grId));
const setLine = (v: Partial<typeof grLines.$inferInsert>) => db.update(grLines).set(v).where(eq(grLines.id, A.grLineId));

describe('invoices.detail · notCounted (G-04 Q3)', () => {
  it('a closed receipt whose line nobody counted → notCounted', async () => {
    await closeReceipt('partial');
    await setLine({ qtyReceived: '0', qtyRejected: '0', rejectReason: null, conditionNotes: null });
    const l = await lineOf(A);
    expect(l.notCounted).toBe(true);
  });

  it('a counted line on a closed receipt is not flagged (a count of 5)', async () => {
    await closeReceipt('completed');
    const l = await lineOf(A);
    expect(l.qtyReceived).toBe(5);
    expect(l.notCounted).toBe(false);
  });

  it('"missing" is a count, not "not counted"', async () => {
    await closeReceipt('completed');
    await setLine({ qtyReceived: '0', qtyRejected: '0', rejectReason: 'missing' });
    expect((await lineOf(A)).notCounted).toBe(false);
  });

  it('a receipt still being counted is never labelled (it holds the invoice; nothing is closed yet)', async () => {
    await setLine({ qtyReceived: '0', qtyRejected: '0', rejectReason: null });
    expect((await lineOf(A)).notCounted).toBe(false);
  });

  it('a line with no receipt line for its product is not labelled', async () => {
    await closeReceipt('completed');
    await db.update(invoiceLines).set({ productId: null }).where(eq(invoiceLines.id, A.invoiceLineId));
    expect((await lineOf(A)).notCounted).toBe(false);
  });
});
