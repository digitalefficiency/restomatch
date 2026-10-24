import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  invoices,
  matchRuns,
  memberships,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  users,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb } from './fixtures';

type Payload = { restaurantId: string; invoiceId: string; rematch?: boolean; poId?: string };
const enqueueMatchInvoice = vi.fn(async (_payload: Payload) => true);
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueMatchInvoice: (p: Payload) => enqueueMatchInvoice(p),
}));

/**
 * receiving.submitReceipt: the count is in, so the receipt's invoices are
 * (re-)matched — the ones the wizard scanned on it (this tenant's only) and any
 * already matched against it before the count. A queue failure never fails the
 * submit.
 */
const db = createDb(testDbUrl());

async function tenant(name: string) {
  const [r] = await db.insert(restaurants).values({ name }).returning();
  const [u] = await db.insert(users).values({ email: `${name}@t.test`, name }).returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: r!.id, role: 'receiver' });
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: `${name}-sup` }).returning();
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: r!.id, supplierId: s!.id, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning();
  await db
    .insert(poLines)
    .values({ poId: po!.id, rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '5' });
  const invoice = async () =>
    (
      await db
        .insert(invoices)
        .values({ restaurantId: r!.id, supplierId: s!.id, status: 'matched', source: 'photo', rawImageUrl: `https://x/${Math.random()}.jpg` })
        .returning()
    )[0]!.id;
  const caller = appRouter.createCaller({
    db,
    session: { userId: u!.id, restaurantId: r!.id, role: 'receiver' },
  } as AppContext);
  return { restaurantId: r!.id, poId: po!.id, invoice, caller };
}

beforeEach(async () => {
  await resetDb(db);
  enqueueMatchInvoice.mockClear();
  enqueueMatchInvoice.mockImplementation(async () => true);
});
afterAll(() => resetDb(db));

describe('receiving.submitReceipt re-matches against the count', () => {
  it('enqueues a rematch for the scanned invoice + any run on this receipt; never a foreign invoice', async () => {
    const A = await tenant('a');
    const B = await tenant('b');
    const { receiptId } = await A.caller.receiving.startReceipt({ poId: A.poId });
    const scanned = await A.invoice();
    const earlier = await A.invoice();
    await db.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: earlier, grId: receiptId, overallStatus: 'major' });
    const foreign = await B.invoice();

    const submitted = await A.caller.receiving.submitReceipt({ grId: receiptId, invoiceIds: [scanned, foreign] });
    expect(['completed', 'partial']).toContain(submitted.status);

    const calls = enqueueMatchInvoice.mock.calls.map(([p]) => p);
    expect(calls.map((c) => c.invoiceId).sort()).toEqual([scanned, earlier].sort());
    expect(calls.every((c) => c.rematch === true && c.restaurantId === A.restaurantId)).toBe(true);
    // Matched against the receipt's own order, not a discovered one.
    expect(calls.every((c) => c.poId === A.poId)).toBe(true);
  });

  it('a queue failure does not fail the submit', async () => {
    const A = await tenant('c');
    const { receiptId } = await A.caller.receiving.startReceipt({ poId: A.poId });
    const scanned = await A.invoice();
    enqueueMatchInvoice.mockImplementation(async () => {
      throw new Error('queue down');
    });
    const submitted = await A.caller.receiving.submitReceipt({ grId: receiptId, invoiceIds: [scanned] });
    expect(['completed', 'partial']).toContain(submitted.status);
    expect(enqueueMatchInvoice).toHaveBeenCalledTimes(1);
  });
});
