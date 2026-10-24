import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';

// Capture match enqueues (the queue itself is not under test).
const enqueueMatchInvoice = vi.fn(async (_p: { restaurantId: string; invoiceId: string }) => true);
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueMatchInvoice: (p: { restaurantId: string; invoiceId: string }) => enqueueMatchInvoice(p),
}));

const { appRouter } = await import('../index');
const { invoicesWaitingOnReceipt, lockReceipt, receiptStillOpenForInvoice } = await import(
  '../receiving/matchTriggers'
);

const db = createDb(testDbUrl());
const other = createDb(testDbUrl()); // a second connection, for the lock race

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

interface Seed {
  restaurantId: string;
  receiverId: string;
  supplierId: string;
  grId: string;
}

async function seed(): Promise<Seed> {
  const [r] = await db.insert(restaurants).values({ name: 'Trigger Bistro' }).returning();
  const [u] = await db.insert(users).values({ email: 'receiver@trigger.test', name: 'R' }).returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: r!.id, role: 'receiver' });
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'HaSharon' }).returning();
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: r!.id, supplierId: s!.id, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
    .returning();
  const [pl] = await db
    .insert(poLines)
    .values({ poId: po!.id, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
    .returning();
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId: r!.id, poId: po!.id, status: 'pending' }).returning();
  await db.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, qtyReceived: '10' });
  return { restaurantId: r!.id, receiverId: u!.id, supplierId: s!.id, grId: gr!.id };
}

/** An OCR'd invoice from the PO's supplier (status `matched` = OCR was confident). */
async function invoice(
  s: Seed,
  opts: { status?: 'ocr_pending' | 'parsed' | 'matched'; duplicate?: boolean; supplierId?: string } = {},
) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: s.restaurantId,
      supplierId: opts.supplierId ?? s.supplierId,
      status: opts.status ?? 'matched',
      source: 'photo',
      ...(opts.duplicate ? { ocrPayload: { raw: { duplicateOf: { invoiceNumber: '1' } } } as never } : {}),
    })
    .returning();
  await db.insert(invoiceLines).values({
    invoiceId: inv!.id,
    rawDescription: 'עגבניה',
    qtyBilled: '10',
    unit: 'kg',
    unitPriceBilled: '8',
    lineTotal: '80',
  });
  return inv!.id;
}

const callerFor = (s: Seed) =>
  appRouter.createCaller({ db, session: { userId: s.receiverId, restaurantId: s.restaurantId, role: 'receiver' } });

beforeEach(async () => {
  enqueueMatchInvoice.mockClear();
  enqueueMatchInvoice.mockImplementation(async () => true);
  await resetDb();
});
afterAll(resetDb);

describe('OCR auto-match waits while the invoice’s receipt is open', () => {
  it('open (pending) receipt → wait; once submitted → match now', async () => {
    const s = await seed();
    const inv = await invoice(s);
    expect(await db.transaction((tx) => receiptStillOpenForInvoice(tx as never, s.restaurantId, inv))).toBe(true);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
    expect(await db.transaction((tx) => receiptStillOpenForInvoice(tx as never, s.restaurantId, inv))).toBe(false);
  });

  it('an invoice with no receipt (email / upload, other supplier) still auto-matches', async () => {
    const s = await seed();
    const [s2] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'No PO' }).returning();
    const inv = await invoice(s, { supplierId: s2!.id });
    expect(await db.transaction((tx) => receiptStillOpenForInvoice(tx as never, s.restaurantId, inv))).toBe(false);
  });
});

describe('submitReceipt matches the invoices that were waiting on it', () => {
  it('enqueues match for the confidently-read invoice paired with this receipt', async () => {
    const s = await seed();
    const inv = await invoice(s);
    const receipt = await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(receipt.status).toBe('completed');
    expect(enqueueMatchInvoice).toHaveBeenCalledTimes(1);
    expect(enqueueMatchInvoice).toHaveBeenCalledWith({ restaurantId: s.restaurantId, invoiceId: inv });
  });

  it('skips invoices still in OCR, needing review, held duplicates, or already matched', async () => {
    const s = await seed();
    await invoice(s, { status: 'ocr_pending' }); // its OCR job matches it once it sees the receipt closed
    await invoice(s, { status: 'parsed' }); // waits for a human, like the OCR job
    await invoice(s, { duplicate: true }); // OCR never auto-matches a held duplicate
    const done = await invoice(s);
    await db.insert(matchRuns).values({ restaurantId: s.restaurantId, invoiceId: done, overallStatus: 'clean' });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(enqueueMatchInvoice).not.toHaveBeenCalled();
  });

  it('a queue failure never fails the submit', async () => {
    const s = await seed();
    await invoice(s);
    enqueueMatchInvoice.mockImplementation(async () => {
      throw new Error('queue.unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const receipt = await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(receipt.status).toBe('completed');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lists nothing for another restaurant’s receipt id', async () => {
    const s = await seed();
    await invoice(s);
    const [r2] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    expect(await invoicesWaitingOnReceipt(db, r2!.id, s.grId)).toEqual([]);
  });
});

describe('race: submit vs OCR finishing (receipt lock)', () => {
  it('OCR checking while a submit is in flight waits for its commit and sees the receipt closed', async () => {
    const s = await seed();
    const inv = await invoice(s);
    let check: Promise<boolean> | undefined;
    let settledEarly = false;
    await db.transaction(async (tx) => {
      await lockReceipt(tx as never, s.grId);
      await tx.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
      check = other.transaction((t2) => receiptStillOpenForInvoice(t2 as never, s.restaurantId, inv));
      check.then(() => (settledEarly = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(settledEarly).toBe(false); // blocked on the receipt lock
    });
    expect(await check!).toBe(false); // → the OCR job matches it itself
  });

  it('OCR that ran first (receipt open → waited) is picked up by the submit', async () => {
    const s = await seed();
    const inv = await invoice(s); // OCR committed `matched`, then saw the receipt open
    expect(await db.transaction((tx) => receiptStillOpenForInvoice(tx as never, s.restaurantId, inv))).toBe(true);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(enqueueMatchInvoice).toHaveBeenCalledWith({ restaurantId: s.restaurantId, invoiceId: inv });
  });
});
