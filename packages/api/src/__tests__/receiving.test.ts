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
  suppliers,
  users,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';

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
