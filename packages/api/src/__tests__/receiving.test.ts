import { createServer } from 'node:net';
import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  users,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';

const TEST_DB_URL =
  testDbUrl();

const db = createDb(TEST_DB_URL);

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

interface Scenario {
  restaurantId: string;
  ownerId: string;
  receiverId: string;
  supplierId: string;
  todayPoId: string;
  yesterdayPoId: string;
  poLineIds: string[];
}

async function seed(): Promise<Scenario> {
  const [restaurant] = await db.insert(restaurants).values({ name: 'Test Bistro' }).returning();
  if (!restaurant) throw new Error();
  const owner = await db
    .insert(users)
    .values({ email: 'owner@test.local', name: 'Owner' })
    .returning();
  const receiver = await db
    .insert(users)
    .values({ email: 'receiver@test.local', name: 'Receiver' })
    .returning();
  await db.insert(memberships).values([
    { userId: owner[0]!.id, restaurantId: restaurant.id, role: 'owner' },
    { userId: receiver[0]!.id, restaurantId: restaurant.id, role: 'receiver' },
  ]);

  const supplier = await db
    .insert(suppliers)
    .values({ restaurantId: restaurant.id, name: 'ירקני אבי' })
    .returning();

  const today = new Date();
  today.setHours(10, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayPo = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: restaurant.id,
      supplierId: supplier[0]!.id,
      expectedDeliveryAt: today,
      status: 'sent',
      source: 'manual',
    })
    .returning();
  const yesterdayPo = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: restaurant.id,
      supplierId: supplier[0]!.id,
      expectedDeliveryAt: yesterday,
      status: 'sent',
      source: 'manual',
    })
    .returning();

  const poLineRows = await db
    .insert(poLines)
    .values([
      {
        poId: todayPo[0]!.id,
        rawDescription: 'עגבניה שרי',
        qtyOrdered: '10',
        unit: 'ק״ג',
        unitPriceExpected: '8',
      },
      {
        poId: todayPo[0]!.id,
        rawDescription: 'מלפפון',
        qtyOrdered: '5',
        unit: 'ק״ג',
        unitPriceExpected: '6',
      },
    ])
    .returning();

  return {
    restaurantId: restaurant.id,
    ownerId: owner[0]!.id,
    receiverId: receiver[0]!.id,
    supplierId: supplier[0]!.id,
    todayPoId: todayPo[0]!.id,
    yesterdayPoId: yesterdayPo[0]!.id,
    poLineIds: poLineRows.map((l) => l.id),
  };
}

function callerFor(session: Session) {
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
});

describe('receiving.todayExpectations', () => {
  it('returns POs scheduled for today', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const list = await caller.receiving.todayExpectations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      poId: s.todayPoId,
      supplierName: 'ירקני אבי',
      lineCount: 2,
      status: 'sent',
      receiptId: null,
    });
  });

  it('does not return yesterday POs', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const list = await caller.receiving.todayExpectations();
    expect(list.find((e) => e.poId === s.yesterdayPoId)).toBeUndefined();
  });

  it('surfaces existing receipt status', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    await caller.receiving.startReceipt({ poId: s.todayPoId });
    const list = await caller.receiving.todayExpectations();
    expect(list[0]?.receiptStatus).toBe('pending');
  });
});

describe('receiving.startReceipt', () => {
  it('creates a goods receipt + mirrors PO lines', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId, alreadyExisted } = await caller.receiving.startReceipt({
      poId: s.todayPoId,
    });
    expect(alreadyExisted).toBe(false);

    const lines = await caller.receiving.todayExpectations();
    expect(lines[0]?.receiptId).toBe(receiptId);
  });

  it('is idempotent — second call returns same receipt', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const first = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const second = await caller.receiving.startReceipt({ poId: s.todayPoId });
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.alreadyExisted).toBe(true);
  });

  it('rejects unauthorized role (chef)', async () => {
    const s = await seed();
    const caller = callerFor({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'chef' });
    await expect(
      caller.receiving.startReceipt({ poId: s.todayPoId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows owner role (broader privileges)', async () => {
    const s = await seed();
    const caller = callerFor({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    const r = await caller.receiving.startReceipt({ poId: s.todayPoId });
    expect(r.receiptId).toBeTruthy();
  });
});

describe('receiving.markGrLine and submitReceipt', () => {
  it('full happy flow — mark lines and complete receipt', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });

    const grLineRows = await db.select().from(grLines);
    expect(grLineRows.length).toBeGreaterThanOrEqual(2);
    const myLines = grLineRows.filter((l) => l.grId === receiptId);

    await caller.receiving.markGrLine({
      grLineId: myLines[0]!.id,
      qtyReceived: 10,
    });
    await caller.receiving.markGrLine({
      grLineId: myLines[1]!.id,
      qtyReceived: 5,
    });

    const receipt = await caller.receiving.submitReceipt({ grId: receiptId });
    expect(receipt.status).toBe('completed');
  });

  it('partial receipt when a line is short', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });

    const myLines = await db.select().from(grLines);
    const lines = myLines.filter((l) => l.grId === receiptId);

    await caller.receiving.markGrLine({
      grLineId: lines[0]!.id,
      qtyReceived: 10,
    });
    await caller.receiving.markGrLine({
      grLineId: lines[1]!.id,
      qtyReceived: 3, // ordered 5, got 3
    });

    const receipt = await caller.receiving.submitReceipt({ grId: receiptId });
    expect(receipt.status).toBe('partial');
  });

  it('records reject reason and condition notes', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const allLines = await db.select().from(grLines);
    const myLine = allLines.find((l) => l.grId === receiptId)!;
    expect(myLine).toBeDefined();

    const updated = await caller.receiving.markGrLine({
      grLineId: myLine.id,
      qtyReceived: 8,
      qtyRejected: 2,
      rejectReason: 'damaged on arrival',
      condition: 'damaged',
      conditionNotes: '2 boxes crushed',
    });
    expect(updated.qtyRejected).toBe('2.000');
    expect(updated.rejectReason).toBe('damaged on arrival');
    expect(updated.conditionNotes).toContain('damaged');
  });
});

describe('a closed receipt is read-only (receiving board: "התקבל ✓")', () => {
  async function closed(status: 'completed' | 'partial') {
    const s = await seed();
    const caller = callerFor({ userId: s.receiverId, restaurantId: s.restaurantId, role: 'receiver' });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const lines = (await db.select().from(grLines)).filter((l) => l.grId === receiptId);
    await caller.receiving.markGrLine({ grLineId: lines[0]!.id, qtyReceived: 10 });
    await caller.receiving.markGrLine({ grLineId: lines[1]!.id, qtyReceived: status === 'completed' ? 5 : 3 });
    const receipt = await caller.receiving.submitReceipt({
      grId: receiptId,
      signatureUrl: 'https://example.com/signature-1.png',
    });
    expect(receipt.status).toBe(status);
    return { s, caller, receiptId, lines, receipt };
  }

  it.each(['completed', 'partial'] as const)('markGrLine on a %s receipt is rejected and the count is untouched', async (status) => {
    const { caller, lines } = await closed(status);
    await expect(caller.receiving.markGrLine({ grLineId: lines[0]!.id, qtyReceived: 99 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const [row] = (await db.select().from(grLines)).filter((l) => l.id === lines[0]!.id);
    expect(Number(row!.qtyReceived)).toBe(10);
  });

  it('a re-submit of a closed receipt changes nothing: status, signature and close time stay', async () => {
    const { s, caller, receiptId, lines, receipt } = await closed('partial');
    // Even if the line were raised behind the API's back, a re-close never flips partial → completed.
    await db.execute(sql`update gr_lines set qty_received = 5 where id = ${lines[1]!.id}`);
    const again = await caller.receiving.submitReceipt({
      grId: receiptId,
      signatureUrl: 'https://example.com/signature-2.png',
    });
    expect(again.status).toBe('partial');
    expect(again.signatureUrl).toBe('https://example.com/signature-1.png');
    expect(new Date(again.updatedAt).getTime()).toBe(new Date(receipt.updatedAt).getTime());
    const list = await caller.receiving.todayExpectations();
    expect(list.find((e) => e.poId === s.todayPoId)).toMatchObject({ receiptStatus: 'partial' });
  });

  it('an open receipt still takes counts (the guard is about closed receipts only)', async () => {
    const s = await seed();
    const caller = callerFor({ userId: s.receiverId, restaurantId: s.restaurantId, role: 'receiver' });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const [line] = (await db.select().from(grLines)).filter((l) => l.grId === receiptId);
    const updated = await caller.receiving.markGrLine({ grLineId: line!.id, qtyReceived: 4 });
    expect(Number(updated.qtyReceived)).toBe(4);
  });

  it('a line of another restaurant stays NOT_FOUND, open or closed (no status oracle)', async () => {
    const { lines } = await closed('completed');
    const [other] = await db.insert(restaurants).values({ name: 'Other Bistro' }).returning();
    const stranger = callerFor({ userId: (await db.select().from(users))[0]!.id, restaurantId: other!.id, role: 'owner' });
    await expect(stranger.receiving.markGrLine({ grLineId: lines[0]!.id, qtyReceived: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('receiving.registerInvoice', () => {
  it('creates an invoice row in ocr_pending state', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const { invoiceId } = await caller.receiving.registerInvoice({
      grId: receiptId,
      imageUrl: 'https://example.com/invoice.jpg',
      supplierId: s.supplierId,
    });
    const [invoice] = await db.select().from(invoices);
    expect(invoice).toBeDefined();
    expect(invoiceId).toBe(invoice!.id);
    expect(invoice!.status).toBe('ocr_pending');
    expect(invoice!.source).toBe('photo');
  });

  it('shows up in pendingInvoices', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    await caller.receiving.registerInvoice({
      grId: receiptId,
      imageUrl: 'https://example.com/invoice.jpg',
      supplierId: s.supplierId,
    });
    const pending = await caller.receiving.pendingInvoices();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('ocr_pending');
  });

  // EN-7 / F7: an unreachable queue used to hang registerInvoice until the
  // serverless function timed out. The queue is Postgres now (0061 job_queue);
  // the producer still fails fast, the invoice is kept, and the client is told
  // OCR was not queued.
  it.each([
    ['a queue database that refuses connections', 'postgres://u:p@127.0.0.1:1/db', 4_500],
    ['a black-holed queue database (never answers)', 'SILENT', 4_500],
  ])('with %s: answers fast with ocrQueued=false and keeps the invoice', async (_label, url, budgetMs) => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const silent = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
    const saved = process.env.QUEUE_DATABASE_URL;
    process.env.QUEUE_DATABASE_URL =
      url === 'SILENT' ? `postgres://u:p@127.0.0.1:${(silent.address() as { port: number }).port}/db` : url;
    try {
      const t0 = Date.now();
      const res = await caller.receiving.registerInvoice({
        grId: receiptId,
        imageUrl: 'https://example.com/queue-down.jpg',
        supplierId: s.supplierId,
      });
      expect(Date.now() - t0).toBeLessThan(budgetMs);
      expect(res).toMatchObject({ alreadyExisted: false, ocrQueued: false });
      const [row] = await db.select().from(invoices);
      expect(row?.id).toBe(res.invoiceId);
      expect(row?.status).toBe('ocr_pending');
    } finally {
      if (saved === undefined) delete process.env.QUEUE_DATABASE_URL;
      else process.env.QUEUE_DATABASE_URL = saved;
      silent.close();
    }
  }, 10_000);

  it('reports ocrQueued=false when no queue database is configured', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const saved = { q: process.env.QUEUE_DATABASE_URL, d: process.env.DATABASE_URL };
    delete process.env.QUEUE_DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const res = await caller.receiving.registerInvoice({
        grId: receiptId,
        imageUrl: 'https://example.com/ok.jpg',
        supplierId: s.supplierId,
      });
      expect(res).toMatchObject({ ocrQueued: false, alreadyExisted: false });
    } finally {
      if (saved.q !== undefined) process.env.QUEUE_DATABASE_URL = saved.q;
      if (saved.d !== undefined) process.env.DATABASE_URL = saved.d;
    }
  });

  it('enqueues the OCR job into job_queue (ocrQueued=true) with the tenant + invoice', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const saved = process.env.QUEUE_DATABASE_URL;
    process.env.QUEUE_DATABASE_URL = TEST_DB_URL;
    try {
      const res = await caller.receiving.registerInvoice({
        grId: receiptId,
        imageUrl: 'https://example.com/queued.jpg',
        supplierId: s.supplierId,
      });
      expect(res).toMatchObject({ ocrQueued: true, alreadyExisted: false });
      const rows = (await db.execute(sql`
        SELECT queue, status, restaurant_id, payload FROM job_queue
         WHERE payload->>'invoiceId' = ${res.invoiceId}`)) as unknown as Array<{
        queue: string;
        status: string;
        restaurant_id: string;
        payload: { imageUrl: string; supplierId: string };
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        queue: 'ocr-invoice',
        status: 'queued',
        restaurant_id: s.restaurantId,
        payload: { imageUrl: 'https://example.com/queued.jpg', supplierId: s.supplierId },
      });
    } finally {
      if (saved === undefined) delete process.env.QUEUE_DATABASE_URL;
      else process.env.QUEUE_DATABASE_URL = saved;
    }
  });
});

describe('receiving.registerInvoice — idempotency (M8) and scan-URL pinning (S4)', () => {
  it('re-registering the same image URL returns the existing invoice and creates no second row', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const first = await caller.receiving.registerInvoice({
      grId: receiptId,
      imageUrl: 'https://example.com/double-tap.jpg',
      supplierId: s.supplierId,
    });
    const second = await caller.receiving.registerInvoice({
      grId: receiptId,
      imageUrl: 'https://example.com/double-tap.jpg',
      supplierId: s.supplierId,
    });
    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.invoiceId).toBe(first.invoiceId);
    const rows = await db.select().from(invoices);
    expect(rows).toHaveLength(1);
  });

  it('rejects an image URL outside the signed invoice-scans prefix when storage is configured', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const { receiptId } = await caller.receiving.startReceipt({ poId: s.todayPoId });
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    try {
      await expect(
        caller.receiving.registerInvoice({
          grId: receiptId,
          imageUrl: 'http://169.254.169.254/latest/meta-data',
          supplierId: s.supplierId,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const ok = await caller.receiving.registerInvoice({
        grId: receiptId,
        imageUrl: 'https://abc.supabase.co/storage/v1/object/sign/invoice-scans/r1/scan.pdf?token=t',
        supplierId: s.supplierId,
      });
      expect(ok.invoiceId).toBeTruthy();
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
    const rows = await db.select().from(invoices);
    expect(rows).toHaveLength(1);
  });
});

describe('receiving.getPo', () => {
  it('returns PO with lines', async () => {
    const s = await seed();
    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const po = await caller.receiving.getPo({ poId: s.todayPoId });
    expect(po.id).toBe(s.todayPoId);
    expect(po.lines).toHaveLength(2);
    expect(po.supplierName).toBe('ירקני אבי');
  });

  it('rejects cross-tenant access', async () => {
    const a = await seed();
    const [otherRest] = await db
      .insert(restaurants)
      .values({ name: 'Other Bistro' })
      .returning();
    const [otherUser] = await db
      .insert(users)
      .values({ email: 'other@test.local' })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: otherUser!.id, restaurantId: otherRest!.id, role: 'receiver' });
    const caller = callerFor({
      userId: otherUser!.id,
      restaurantId: otherRest!.id,
      role: 'receiver',
    });
    await expect(caller.receiving.getPo({ poId: a.todayPoId })).rejects.toThrow();
  });
});

describe('receiving — multi-tenant isolation', () => {
  it('todayExpectations only returns POs for the active restaurant', async () => {
    const s = await seed();
    const [otherRest] = await db
      .insert(restaurants)
      .values({ name: 'Cross Tenant' })
      .returning();
    const [otherUser] = await db
      .insert(users)
      .values({ email: 'cross@test.local' })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: otherUser!.id, restaurantId: otherRest!.id, role: 'receiver' });
    const [otherSup] = await db
      .insert(suppliers)
      .values({ restaurantId: otherRest!.id, name: 'Other Supplier' })
      .returning();
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    await db.insert(purchaseOrders).values({
      restaurantId: otherRest!.id,
      supplierId: otherSup!.id,
      expectedDeliveryAt: today,
      status: 'sent',
      source: 'manual',
    });

    const caller = callerFor({
      userId: s.receiverId,
      restaurantId: s.restaurantId,
      role: 'receiver',
    });
    const list = await caller.receiving.todayExpectations();
    expect(list).toHaveLength(1);
    expect(list[0]?.poId).toBe(s.todayPoId);
  });
});
