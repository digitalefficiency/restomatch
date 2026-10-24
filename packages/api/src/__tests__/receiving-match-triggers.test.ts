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
const enqueueMatchInvoice = vi.fn(async (_p: { restaurantId: string; invoiceId: string; rematch?: boolean; poId?: string }) => true);
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueMatchInvoice: (p: { restaurantId: string; invoiceId: string; rematch?: boolean; poId?: string }) => enqueueMatchInvoice(p),
}));

const { appRouter } = await import('../index');
const { startOfDayInTz } = await import('../lib/time');

/**
 * "This morning": up to 3 h before now, but on the SAME local day as now in the
 * restaurant's zone — the matcher compares local calendar days, and "now − 3 h"
 * is yesterday during the first hours after midnight in Israel.
 */
function earlierToday(): Date {
  const now = Date.now();
  const dayStart = startOfDayInTz(new Date(now), 'Asia/Jerusalem').getTime();
  return new Date(Math.max(now - 3 * 60 * 60 * 1000, dayStart + Math.min(60_000, (now - dayStart) / 2)));
}
const { invoicesWaitingOnReceipt, lockReceipt, readScanGrId, receiptStillOpen, scanOwnerReceipt, scanReceiptToStamp, withScanGrId } = await import(
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
  opts: {
    status?: 'ocr_pending' | 'parsed' | 'matched';
    duplicate?: boolean;
    supplierId?: string;
    /** The receipt the OCR job stamped (raw.scanGrId); unstamped = legacy / email row. */
    scanGrId?: string;
    /** raw.heldForReceipts, as the OCR job records a hold (wave-1 sweep). */
    heldFor?: string[];
    source?: 'photo' | 'email' | 'platform' | 'manual';
  } = {},
) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: s.restaurantId,
      supplierId: opts.supplierId ?? s.supplierId,
      status: opts.status ?? 'matched',
      source: opts.source ?? 'photo',
      ...(opts.duplicate ? { ocrPayload: { raw: { duplicateOf: { invoiceNumber: '1' } } } as never } : {}),
      ...(opts.scanGrId || opts.heldFor
        ? {
            ocrPayload: {
              raw: { ...(opts.scanGrId ? { scanGrId: opts.scanGrId } : {}), ...(opts.heldFor ? { heldForReceipts: opts.heldFor } : {}) },
            } as never,
          }
        : {}),
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
    expect(await db.transaction((tx) => receiptStillOpen(tx as never, s.restaurantId, s.grId))).toBe(true);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
    expect(await db.transaction((tx) => receiptStillOpen(tx as never, s.restaurantId, s.grId))).toBe(false);
  });

  it('an invoice of another supplier is not waiting on this receipt', async () => {
    const s = await seed();
    const [s2] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'No PO' }).returning();
    await invoice(s, { supplierId: s2!.id });
    expect(await invoicesWaitingOnReceipt(db, s.restaurantId, s.grId)).toEqual([]);
  });
});

describe('submitReceipt matches the invoices that were waiting on it', () => {
  it('F1: matches the waiting scan even when the wizard sends NO invoiceIds (reload / retake mid-count)', async () => {
    const s = await seed();
    const inv = await invoice(s);
    const receipt = await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(receipt.status).toBe('completed');
    expect(enqueueMatchInvoice).toHaveBeenCalledTimes(1);
    expect(enqueueMatchInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: s.restaurantId, invoiceId: inv, rematch: true, poId: expect.any(String) }),
    );
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
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const receipt = await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(receipt.status).toBe('completed');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
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
      check = other.transaction((t2) => receiptStillOpen(t2 as never, s.restaurantId, s.grId));
      check.then(() => (settledEarly = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(settledEarly).toBe(false); // blocked on the receipt lock
    });
    expect(await check!).toBe(false); // → the OCR job matches it itself
  });

  it('OCR that ran first (receipt open → waited) is picked up by the submit', async () => {
    const s = await seed();
    const inv = await invoice(s); // OCR committed `matched`, then saw the receipt open
    expect(await db.transaction((tx) => receiptStillOpen(tx as never, s.restaurantId, s.grId))).toBe(true);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(enqueueMatchInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv, rematch: true }));
  });
});

describe('F4 attack: a receiver cannot re-match a paid invoice, or one bound to another receipt, via submitReceipt', () => {
  it('a paid invoice, or one matched against another receipt, is dropped; the real scan still goes', async () => {
    const s = await seed();
    const scan = await invoice(s, { scanGrId: s.grId }); // the wizard's scan (stamped by the OCR job)
    const paid = await invoice(s);
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, paid));
    const elsewhere = await invoice(s);
    const [otherPo] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: s.restaurantId, supplierId: s.supplierId, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
      .returning();
    const [otherGr] = await db.insert(goodsReceipts).values({ restaurantId: s.restaurantId, poId: otherPo!.id, status: 'completed' }).returning();
    await db.insert(matchRuns).values({ restaurantId: s.restaurantId, invoiceId: elsewhere, grId: otherGr!.id, overallStatus: 'clean' });
    await db.insert(matchRuns).values({ restaurantId: s.restaurantId, invoiceId: paid, grId: otherGr!.id, overallStatus: 'clean' });

    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [scan, paid, elsewhere] });
    const sent = enqueueMatchInvoice.mock.calls.map((c) => c[0].invoiceId);
    expect(sent).toEqual([scan]);
  });
});

describe('verifier MAJOR: a scan held on another (open) receipt cannot be named via this receipt', () => {
  it('HaKerem scan held on its pending receipt; closing a Galilee receipt with invoiceIds=[it] enqueues nothing', async () => {
    const s = await seed(); // HaSharon receipt — open, its scan held
    const held = await invoice(s);
    // A second supplier with its own counted receipt (the one being submitted).
    const [gal] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'Galilee' }).returning();
    const [galPo] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: s.restaurantId, supplierId: gal!.id, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
      .returning();
    const [galGr] = await db.insert(goodsReceipts).values({ restaurantId: s.restaurantId, poId: galPo!.id, status: 'pending' }).returning();

    await callerFor(s).receiving.submitReceipt({ grId: galGr!.id, invoiceIds: [held] });
    expect(enqueueMatchInvoice.mock.calls.map((c) => c[0].invoiceId)).not.toContain(held);
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, held))).toEqual([]);
  });
});

describe('verifier MINOR 2: a same-supplier sibling PO with a receipt does not hide the waiting scan', () => {
  it('PO1 counted earlier today + PO2 being counted now: the scan on PO2 is found (no invoiceIds) and pinned to PO2', async () => {
    const s = await seed(); // PO2 + its pending receipt (s.grId)
    const [gr2] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, s.grId));
    const morning = earlierToday();
    const [po1] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: s.restaurantId, supplierId: s.supplierId, expectedDeliveryAt: morning, status: 'sent', source: 'manual' })
      .returning();
    const [pl1] = await db
      .insert(poLines)
      .values({ poId: po1!.id, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
      .returning();
    const [gr1] = await db.insert(goodsReceipts).values({ restaurantId: s.restaurantId, poId: po1!.id, status: 'completed' }).returning();
    await db.insert(grLines).values({ grId: gr1!.id, poLineId: pl1!.id, qtyReceived: '10' });

    const scan = await invoice(s, { scanGrId: s.grId }); // the wizard's scan (stamped by the OCR job)
    expect(await invoicesWaitingOnReceipt(db, s.restaurantId, s.grId)).toEqual([scan]);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(enqueueMatchInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: scan, rematch: true, poId: gr2!.poId }),
    );
  });
});

/** Same supplier, a second order earlier today with its OWN receipt still open (Galilee PO1 07:00). */
async function openSiblingReceipt(
  s: Seed,
  opts: { qtyOrdered?: string; qtyReceived?: string; status?: 'pending' | 'completed' } = {},
) {
  const morning = earlierToday();
  const [po1] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: s.restaurantId, supplierId: s.supplierId, expectedDeliveryAt: morning, status: 'sent', source: 'manual' })
    .returning();
  const [pl1] = await db
    .insert(poLines)
    .values({ poId: po1!.id, rawDescription: 'עגבניה', qtyOrdered: opts.qtyOrdered ?? '20', unit: 'kg', unitPriceExpected: '8' })
    .returning();
  const [gr1] = await db
    .insert(goodsReceipts)
    .values({ restaurantId: s.restaurantId, poId: po1!.id, status: opts.status ?? 'pending' })
    .returning();
  await db.insert(grLines).values({ grId: gr1!.id, poLineId: pl1!.id, qtyReceived: opts.qtyReceived ?? '0' });
  return { po1: po1!.id, gr1: gr1!.id };
}

describe('verifier follow-up (a): two orders of one supplier on the same day, both receipts open', () => {
  it('closing GR2 does not claim X1, the scan held on the sibling’s still-open GR1', async () => {
    const s = await seed(); // PO2 + GR2 (s.grId), counted
    await openSiblingReceipt(s);
    const x1 = await invoice(s); // registered on GR1 — held
    const x2 = await invoice(s); // registered on GR2
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [x2] });
    const sent = enqueueMatchInvoice.mock.calls.map((c) => c[0].invoiceId);
    expect(sent).not.toContain(x1);
  });
});

describe('verifier follow-up (b): re-submitting an already-closed receipt claims nothing', () => {
  it('a sibling’s held scan, named or not, is not claimed by a re-submit of the closed GR2', async () => {
    const s = await seed();
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
    await openSiblingReceipt(s);
    const x1 = await invoice(s);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [x1] });
    expect(enqueueMatchInvoice.mock.calls.map((c) => c[0].invoiceId)).not.toContain(x1);
  });

  it('rule 2 on its own: a closed receipt’s re-submit derives no waiting list (no open sibling involved)', async () => {
    const s = await seed();
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
    const stray = await invoice(s); // pairs only with GR2, no run
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [stray] });
    expect(enqueueMatchInvoice).not.toHaveBeenCalled();
  });
});

const sentIds = () => enqueueMatchInvoice.mock.calls.map((c) => c[0].invoiceId);
/** What the match job would record for a claimed scan: a run on that receipt. */
async function ranOn(s: Seed, invoiceId: string, grId: string) {
  await db.insert(matchRuns).values({ restaurantId: s.restaurantId, invoiceId, grId, overallStatus: 'clean' });
}

describe('scanGrId stamp: a scan belongs to exactly the receipt it was taken on', () => {
  it('(a) GR2 first, then GR1: each receipt claims only its own stamped scan, named or derived', async () => {
    const s = await seed(); // PO2 + GR2 (s.grId), counted
    const { gr1 } = await openSiblingReceipt(s);
    const x1 = await invoice(s, { scanGrId: gr1 });
    const x2 = await invoice(s, { scanGrId: s.grId });

    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [x2, x1] });
    expect(sentIds()).toEqual([x2]);
    await ranOn(s, x2, s.grId);

    enqueueMatchInvoice.mockClear();
    await callerFor(s).receiving.submitReceipt({ grId: gr1, invoiceIds: [x1, x2] });
    expect(sentIds()).toEqual([x1]); // X2 is GR2's — never moved onto GR1's count
  });

  it('(a) reverse — GR1 first, then GR2: GR1 does not claim X2 although PO1 wins the pinned tie', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s);
    const x1 = await invoice(s, { scanGrId: gr1 });
    const x2 = await invoice(s, { scanGrId: s.grId });

    await callerFor(s).receiving.submitReceipt({ grId: gr1 }); // no ids: derived
    expect(sentIds()).toEqual([x1]);
    await ranOn(s, x1, gr1);

    enqueueMatchInvoice.mockClear();
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sentIds()).toEqual([x2]);
  });

  it('(b) a re-submit of the closed GR2 does not claim GR1’s stamped held scan, named or not', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s);
    const x1 = await invoice(s, { scanGrId: gr1 });
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [x1] });
    expect(sentIds()).toEqual([]);
  });

  it('a scan stamped to another (already closed) receipt is not claimed by this one', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, gr1));
    const x1 = await invoice(s, { scanGrId: gr1 }); // GR1 closed: its OCR job matches it itself
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [x1] });
    expect(sentIds()).toEqual([]);
  });

  it('unstamped legacy rows fall back to rule 1: ambiguous with an open sibling → skipped; a stamped one still goes', async () => {
    const s = await seed();
    await openSiblingReceipt(s);
    const legacy = await invoice(s); // no scanGrId: pairs with GR2 AND with open GR1
    const stamped = await invoice(s, { scanGrId: s.grId });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [legacy] });
    expect(sentIds()).toEqual([stamped]);
  });

  it('an unstamped row with no open sibling is still matched (F1 unchanged)', async () => {
    const s = await seed();
    const legacy = await invoice(s);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sentIds()).toEqual([legacy]);
  });
});

describe('scanGrId stamp: what the OCR job writes', () => {
  it('stamps only a receipt of the invoice’s own restaurant AND supplier (forged / foreign / wrong-supplier grId stamps nothing)', async () => {
    const s = await seed();
    const [r2] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    const [gal] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'Galilee' }).returning();
    expect(await scanReceiptToStamp(db, s.restaurantId, s.grId, s.supplierId)).toBe(s.grId);
    expect(await scanReceiptToStamp(db, r2!.id, s.grId, s.supplierId)).toBeUndefined();
    expect(await scanReceiptToStamp(db, s.restaurantId, s.grId, gal!.id)).toBeUndefined(); // HaSharon's receipt, Galilee invoice
    expect(await scanReceiptToStamp(db, s.restaurantId, s.grId, null)).toBeUndefined();
    expect(await scanReceiptToStamp(db, s.restaurantId, '00000000-0000-0000-0000-000000000000', s.supplierId)).toBeUndefined();
    expect(await scanReceiptToStamp(db, s.restaurantId, undefined, s.supplierId)).toBeUndefined();
  });

  it('adds only the key (no stamp → the OCR result unchanged), and reads it back defensively', () => {
    const result = { lines: 4, confidence: 0.9 };
    expect(withScanGrId(result, undefined)).toBe(result);
    expect(withScanGrId(result, 'g1')).toEqual({ lines: 4, confidence: 0.9, scanGrId: 'g1' });
    expect(readScanGrId({ raw: { scanGrId: 'g1' } })).toBe('g1');
    for (const p of [null, undefined, {}, { raw: null }, { raw: { scanGrId: 7 } }, { raw: { scanGrId: '' } }]) {
      expect(readScanGrId(p)).toBeNull();
    }
  });
});

/**
 * The verifier's scenarios. One supplier: PO1 due this morning (0.5x), PO2 due
 * now; on PO2 the receiver started GR2 and registered X (OCR'd, held, stamped
 * GR2). Every scan must end on its own receipt: the enqueued re-match carries
 * that receipt's PO (the match job's binding PO), and nothing else is enqueued.
 */
describe('verifier scenarios C/D/E/F', () => {
  async function poOf(grId: string) {
    const [g] = await db.select({ poId: goodsReceipts.poId }).from(goodsReceipts).where(eq(goodsReceipts.id, grId));
    return g!.poId;
  }
  const sent = () => enqueueMatchInvoice.mock.calls.map((c) => ({ invoiceId: c[0].invoiceId, poId: c[0].poId }));

  for (const [name, ids] of [
    ['C (attack): re-submitting the closed GR1 naming X', true],
    ['E: re-submitting the closed GR1 with no invoiceIds (derived list)', false],
  ] as const) {
    it(`${name} claims nothing; GR2’s submit then takes X onto PO2/GR2`, async () => {
      const s = await seed(); // PO2 + GR2 (s.grId), being counted
      const { gr1 } = await openSiblingReceipt(s, { qtyOrdered: '5', qtyReceived: '5', status: 'completed' });
      const x = await invoice(s, { scanGrId: s.grId });

      await callerFor(s).receiving.submitReceipt(ids ? { grId: gr1, invoiceIds: [x] } : { grId: gr1 });
      expect(sent()).toEqual([]);

      await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [x] });
      expect(sent()).toEqual([{ invoiceId: x, poId: await poOf(s.grId) }]);
    });
  }

  it('D (normal flow): GR1 submitted only after X is held on GR2 does not claim X; GR2 does', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s, { qtyOrdered: '5', qtyReceived: '5' }); // counted, still open
    const x = await invoice(s, { scanGrId: s.grId });

    await callerFor(s).receiving.submitReceipt({ grId: gr1 });
    expect(sent()).toEqual([]);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sent()).toEqual([{ invoiceId: x, poId: await poOf(s.grId) }]);
  });

  it('D, unstamped X (legacy): GR1’s submit skips it as ambiguous (GR2 still open) — never guessed onto GR1', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s, { qtyOrdered: '5', qtyReceived: '5' });
    const x = await invoice(s);
    await callerFor(s).receiving.submitReceipt({ grId: gr1 });
    expect(sent().map((c) => c.invoiceId)).not.toContain(x);
  });

  for (const withX2 of [true, false]) {
    it(`F (= a): PO1 2x + X1 held on GR1; GR2 submitted ${withX2 ? 'with X2 named' : 'with no X2 / no invoiceIds'} → X1 untouched; GR1 later takes X1 onto PO1/GR1`, async () => {
      const s = await seed(); // PO2 1x
      const { gr1 } = await openSiblingReceipt(s, { qtyOrdered: '20' }); // PO1 2x, GR1 open
      const x1 = await invoice(s, { scanGrId: gr1 });
      const x2 = withX2 ? await invoice(s, { scanGrId: s.grId }) : undefined;

      await callerFor(s).receiving.submitReceipt(x2 ? { grId: s.grId, invoiceIds: [x2] } : { grId: s.grId });
      expect(sent()).toEqual(x2 ? [{ invoiceId: x2, poId: await poOf(s.grId) }] : []);
      if (x2) await ranOn(s, x2, s.grId);

      enqueueMatchInvoice.mockClear();
      await db.update(grLines).set({ qtyReceived: '20' }).where(eq(grLines.grId, gr1));
      await callerFor(s).receiving.submitReceipt({ grId: gr1, invoiceIds: [x1] });
      expect(sent()).toEqual([{ invoiceId: x1, poId: await poOf(gr1) }]);
    });
  }

  it('still holds (A/B normal sibling flow): the stamped scan on GR2 → exactly one re-match, on PO2', async () => {
    const s = await seed();
    await openSiblingReceipt(s, { qtyOrdered: '5', qtyReceived: '5', status: 'completed' }); // PO1 counted this morning
    const x = await invoice(s, { scanGrId: s.grId });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sent()).toEqual([{ invoiceId: x, poId: await poOf(s.grId) }]);
  });
});

/**
 * Deploy skew (orchestrator verify): the worker runs separately, so scans OCR'd
 * by a worker from before the stamp — or held across its restart — carry none.
 * An UNSTAMPED scan that pairs with more than one same-supplier receipt in the
 * window, open OR closed, is never auto-claimed: it waits for a manager's
 * match.runForInvoice.
 */
describe('hardened rule 1: an unstamped scan with a same-supplier sibling receipt (open or closed) is never auto-claimed', () => {
  it('MINOR 2 setup, unstamped: PO1 counted this morning (closed GR1) → the scan on PO2 is skipped, not guessed', async () => {
    const s = await seed();
    await openSiblingReceipt(s, { qtyOrdered: '10', qtyReceived: '10', status: 'completed' });
    const scan = await invoice(s);
    expect(await invoicesWaitingOnReceipt(db, s.restaurantId, s.grId)).toEqual([]);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId, invoiceIds: [scan] });
    expect(sentIds()).toEqual([]);
  });

  it('F with stamps stripped: after GR2 closed with X2 matched, GR1’s later submit does not claim the unstamped X2', async () => {
    const s = await seed(); // PO2 1x, GR2
    const { gr1 } = await openSiblingReceipt(s, { qtyOrdered: '20' }); // PO1 2x, GR1 open
    const x2 = await invoice(s);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, s.grId));
    await db.update(grLines).set({ qtyReceived: '20' }).where(eq(grLines.grId, gr1));
    await callerFor(s).receiving.submitReceipt({ grId: gr1, invoiceIds: [x2] });
    expect(sentIds()).toEqual([]);
  });

  it('a sibling of the same supplier far outside the matcher window does not make a scan ambiguous', async () => {
    const s = await seed();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const [po0] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: s.restaurantId, supplierId: s.supplierId, expectedDeliveryAt: old, status: 'sent', source: 'manual' })
      .returning();
    await db.insert(goodsReceipts).values({ restaurantId: s.restaurantId, poId: po0!.id, status: 'completed' });
    const scan = await invoice(s);
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sentIds()).toEqual([scan]);
  });
});

describe('registerInvoice refuses an invoice of another supplier on this receipt (would be orphaned)', () => {
  it('Galilee supplierId on HaSharon’s receipt → BAD_REQUEST, no invoice row', async () => {
    const s = await seed();
    const [gal] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'Galilee' }).returning();
    await expect(
      callerFor(s).receiving.registerInvoice({
        grId: s.grId,
        supplierId: gal!.id,
        imageUrl: 'https://example.invalid/scan.jpg', // no storage configured in tests: the URL pin is off
      }),
    ).rejects.toThrow("supplierId must be the receipt's order supplier");
    expect(await db.select().from(invoices).where(eq(invoices.restaurantId, s.restaurantId))).toEqual([]);
  });
});

describe('rule 1 by source: emailed / platform / manual invoices are unstamped by design', () => {
  it('an emailed invoice for a PO whose receipt was open, with a closed same-supplier receipt 3 days earlier, is claimed by its receipt’s submit', async () => {
    const s = await seed(); // PO2 now + GR2 open
    const earlier = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const [po0] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: s.restaurantId, supplierId: s.supplierId, expectedDeliveryAt: earlier, status: 'sent', source: 'manual' })
      .returning();
    const [pl0] = await db
      .insert(poLines)
      .values({ poId: po0!.id, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
      .returning();
    const [gr0] = await db.insert(goodsReceipts).values({ restaurantId: s.restaurantId, poId: po0!.id, status: 'completed' }).returning();
    await db.insert(grLines).values({ grId: gr0!.id, poLineId: pl0!.id, qtyReceived: '10' });

    const emailed = await invoice(s, { source: 'email' });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sentIds()).toEqual([emailed]);
  });

  for (const source of ['email', 'platform', 'manual'] as const) {
    it(`a ${source} invoice is still skipped when it is ambiguous with an OPEN same-supplier sibling`, async () => {
      const s = await seed();
      await openSiblingReceipt(s);
      const inv = await invoice(s, { source });
      await callerFor(s).receiving.submitReceipt({ grId: s.grId });
      expect(sentIds()).not.toContain(inv);
    });
  }

  // A same-day closed sibling wins the pinned tie (unlike one 3 days earlier, where
  // the nearer day wins), so this is where the source decides.
  for (const [source, claimed] of [
    ['email', true],
    ['platform', true],
    ['manual', true],
    ['photo', false],
  ] as const) {
    it(`same-day CLOSED sibling, ${source}: ${claimed ? 'claimed by its open receipt' : 'skipped (unstamped photo = deploy skew)'}`, async () => {
      const s = await seed();
      await openSiblingReceipt(s, { qtyOrdered: '10', qtyReceived: '10', status: 'completed' });
      const inv = await invoice(s, { source });
      await callerFor(s).receiving.submitReceipt({ grId: s.grId });
      expect(sentIds()).toEqual(claimed ? [inv] : []);
    });
  }
});

/**
 * One source of truth with the wave-1 OCR sweep: a photo whose job lost its
 * receipt is held by the OCR for the receipts being counted
 * (raw.heldForReceipts). A hold on exactly one receipt is that scan's owner —
 * the same as a stamp; a hold on several is a guess, and rule 1 decides.
 */
describe('scan owner: stamp, else the OCR’s single recorded hold', () => {
  it('a lost-receipt photo held for GR2 alone is claimed by GR2 — despite a same-day closed sibling — and never by the sibling', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s, { qtyOrdered: '10', qtyReceived: '10', status: 'completed' });
    const x = await invoice(s, { heldFor: [s.grId] });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sentIds()).toEqual([x]);
    enqueueMatchInvoice.mockClear();
    expect(await invoicesWaitingOnReceipt(db, s.restaurantId, gr1)).toEqual([]);
  });

  it('a hold on two receipts is a guess: neither claims it while the other pairs (left for a manager)', async () => {
    const s = await seed();
    const { gr1 } = await openSiblingReceipt(s);
    const x = await invoice(s, { heldFor: [gr1, s.grId] });
    await callerFor(s).receiving.submitReceipt({ grId: s.grId });
    expect(sentIds()).not.toContain(x);
  });

  it('the stamp wins over a recorded hold; a hold counts only for a wizard photo', () => {
    expect(scanOwnerReceipt({ raw: { scanGrId: 'g2', heldForReceipts: ['g1'] } }, 'photo')).toBe('g2');
    expect(scanOwnerReceipt({ raw: { heldForReceipts: ['g1'] } }, 'photo')).toBe('g1');
    expect(scanOwnerReceipt({ raw: { heldForReceipts: ['g1'] } }, 'email')).toBeNull();
    expect(scanOwnerReceipt({ raw: { heldForReceipts: ['g1', 'g2'] } }, 'photo')).toBeNull();
    expect(scanOwnerReceipt({ raw: { heldForReceipts: [] } }, 'photo')).toBeNull();
    expect(scanOwnerReceipt({ raw: { heldForReceipts: 'g1' } }, 'photo')).toBeNull();
    expect(scanOwnerReceipt(null, 'photo')).toBeNull();
  });
});
