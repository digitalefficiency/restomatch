import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  auditLog,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  users,
} from '@restomatch/db';
import {
  adoptAutopilotDraft,
  autopilotOption,
  dismissAutopilotDraft,
  findSendRescues,
  listAutopilotDrafts,
  prepareBackorderDraft,
  prepareOrderDraft,
} from '../orders/autopilot';
import { openDraft } from '../orders/drafts';
import { SKIPPED_NO_PROVIDER } from '../notifications/delivery';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-09 / AU-11 · the order autopilot against a real DB: prepared draft,
 * adoption, dismiss, backorder (the billed-not-received guard) and the
 * failed-send rescue. Nothing here may ever write a supplier-bound outbox row.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let onion: string;
let invoiceSeq = 0;

const DAY = '2026-11-15';
const dayStart = new Date('2026-11-14T22:00:00Z');
const dayEnd = new Date('2026-11-15T22:00:00Z');
const now = new Date('2026-11-15T07:00:00Z');

async function enablePrepared(t: Tenant, on = true) {
  await db.update(restaurants).set({ settings: { automations: { preparedOrderDraft: on } } as never }).where(eq(restaurants.id, t.restaurantId));
}

/** A placed PO `daysAgo` before `now`. */
async function placed(t: Tenant, daysAgo: number, lines: Array<[string, number, string]>) {
  const at = new Date(now.getTime() - daysAgo * 86_400_000);
  const [row] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', source: 'manual', sentAt: at, createdAt: at })
    .returning({ id: purchaseOrders.id });
  await db
    .insert(poLines)
    .values(lines.map(([productId, q, price]) => ({ poId: row!.id, productId, qtyOrdered: String(q), unit: 'kg', unitPriceExpected: price })));
  return row!.id;
}

async function seedGuide(t: Tenant) {
  await db.delete(poLines).where(eq(poLines.poId, t.poId));
  await db.update(purchaseOrders).set({ createdAt: new Date('2026-10-01T08:00:00Z') }).where(eq(purchaseOrders.id, t.poId));
  for (const d of [9, 6, 3]) await placed(t, d, [[t.productId, 10, '8.5'], [onion, 2, '4']]);
}

const supplierOutbox = () => db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityType, 'supplier'));

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  const [o] = await db
    .insert(products)
    .values({ restaurantId: A.restaurantId, canonicalName: 'בצל', category: 'ירקות', defaultUnit: 'kg' })
    .returning({ id: products.id });
  onion = o!.id;
});
afterAll(async () => {
  await resetDb(db);
});

describe('options (inline defaults until the AU-01 rows land)', () => {
  it('prepared off by default; backorder and rescue on', () => {
    expect(autopilotOption(null, 'preparedOrderDraft')).toBe(false);
    expect(autopilotOption({}, 'backorderDraft')).toBe(true);
    expect(autopilotOption({ automations: { sendRescue: false } }, 'sendRescue')).toBe(false);
    expect(autopilotOption({ automations: { preparedOrderDraft: 'yes' } }, 'preparedOrderDraft')).toBe(false);
  });
});

describe('prepareOrderDraft (A16a)', () => {
  const args = () => ({ restaurantId: A.restaurantId, supplierId: A.supplierId, orderDay: DAY, dayStart, dayEnd, now });

  it('option off → nothing', async () => {
    await seedGuide(A);
    expect(await prepareOrderDraft(db, args())).toEqual({ status: 'skipped', reason: 'option_off' });
  });

  it('one draft from the guide, recurring, unowned, priced by the guide; a second run returns it; no outbox', async () => {
    await enablePrepared(A);
    await seedGuide(A);
    const outboxBefore = (await db.select().from(notificationsOutbox)).length; // seedTenant's own rows
    const r = await prepareOrderDraft(db, args());
    expect(r).toMatchObject({ status: 'created', lineCount: 2 });
    const poId = (r as { poId: string }).poId;
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po).toMatchObject({ status: 'draft', source: 'recurring', sourceRef: `au:A16:${A.supplierId}:${DAY}`, createdBy: null });
    const lines = await db.select().from(poLines).where(eq(poLines.poId, poId));
    const tomato = lines.find((l) => l.productId === A.productId)!;
    expect(Number(tomato.qtyOrdered)).toBe(10);
    expect(Number(tomato.unitPriceExpected)).toBe(8.5); // the last sent price, never an invoice price (the fixture invoice says 10)
    expect(await prepareOrderDraft(db, args())).toEqual({ status: 'exists', poId, lineCount: 2 });
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.sourceRef, `au:A16:${A.supplierId}:${DAY}`))).toHaveLength(1);
    expect(await db.select().from(notificationsOutbox)).toHaveLength(outboxBefore);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'order.prepared_draft_created'))).toHaveLength(1);
  });

  it('skipped: an open human draft, a PO already today, a thin guide', async () => {
    await enablePrepared(A);
    await seedGuide(A);
    const [human] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'draft', source: 'manual', createdBy: A.ownerUserId, createdAt: new Date('2026-11-10T08:00:00Z') })
      .returning({ id: purchaseOrders.id });
    expect(await prepareOrderDraft(db, args())).toEqual({ status: 'skipped', reason: 'human_draft' });
    await db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, human!.id));
    await db.insert(purchaseOrders).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'sent', source: 'manual', createdAt: new Date('2026-11-15T05:00:00Z') });
    expect(await prepareOrderDraft(db, args())).toEqual({ status: 'skipped', reason: 'po_today' });
    expect(
      await prepareOrderDraft(db, { restaurantId: B.restaurantId, supplierId: B.supplierId, orderDay: DAY, dayStart, dayEnd, now, optionChecked: true }),
    ).toEqual({ status: 'skipped', reason: 'thin_guide' });
  });

  it("another restaurant's supplier id → skipped, nothing written for either", async () => {
    await enablePrepared(A);
    await seedGuide(A);
    expect(await prepareOrderDraft(db, { ...args(), supplierId: B.supplierId })).toEqual({ status: 'skipped', reason: 'inactive' });
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.status, 'draft'))).toEqual([]);
  });
});

describe('adoption, board and dismiss', () => {
  async function prepared() {
    await enablePrepared(A);
    await seedGuide(A);
    return ((await prepareOrderDraft(db, { restaurantId: A.restaurantId, supplierId: A.supplierId, orderDay: DAY, dayStart, dayEnd, now })) as { poId: string }).poId;
  }

  it('openDraft hands the prepared draft to the first opener, once; the second sees it as theirs only if it is', async () => {
    const poId = await prepared();
    const [chef] = await db.insert(users).values({ email: 'chef-a@attack.test', name: 'Chef A' }).returning({ id: users.id });
    await db.insert(memberships).values({ userId: chef!.id, restaurantId: A.restaurantId, role: 'chef' });

    const first = await openDraft(db, { restaurantId: A.restaurantId, userId: A.ownerUserId, supplierId: A.supplierId });
    expect(first?.draftId).toBe(poId);
    expect((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)))[0]!.createdBy).toBe(A.ownerUserId);
    // The owner re-opening gets it again (it is now "their" draft).
    expect((await openDraft(db, { restaurantId: A.restaurantId, userId: A.ownerUserId, supplierId: A.supplierId }))?.draftId).toBe(poId);
    // The chef does not take it over.
    expect(await openDraft(db, { restaurantId: A.restaurantId, userId: chef!.id, supplierId: A.supplierId })).toBeNull();
    expect(await adoptAutopilotDraft(db, { restaurantId: A.restaurantId, userId: chef!.id, supplierId: A.supplierId })).toBeNull();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'order.prepared_draft_opened'))).toHaveLength(1);

    const board = await listAutopilotDrafts(db, A.restaurantId);
    expect(board).toEqual([expect.objectContaining({ poId, kind: 'prepared', lineCount: 2, openedBy: 'Owner A' })]);
    expect(await listAutopilotDrafts(db, B.restaurantId)).toEqual([]);
  });

  it('dismiss cancels an unopened draft; opened, sent, foreign or a human draft → refused', async () => {
    const poId = await prepared();
    expect(await dismissAutopilotDraft(db, { restaurantId: B.restaurantId, poId, userId: B.ownerUserId })).toEqual({ status: 'not_found' });
    expect(await dismissAutopilotDraft(db, { restaurantId: A.restaurantId, poId: A.poId, userId: A.ownerUserId })).toEqual({
      status: 'conflict',
      reason: 'not_autopilot',
    });
    expect(await dismissAutopilotDraft(db, { restaurantId: A.restaurantId, poId, userId: A.ownerUserId })).toEqual({ status: 'cancelled' });
    expect(await dismissAutopilotDraft(db, { restaurantId: A.restaurantId, poId, userId: A.ownerUserId })).toEqual({ status: 'already_cancelled' });
    // A dismissed prepared draft is never announced or prepared again the same day.
    expect(await prepareOrderDraft(db, { restaurantId: A.restaurantId, supplierId: A.supplierId, orderDay: DAY, dayStart, dayEnd, now })).toEqual({
      status: 'skipped',
      reason: 'handled',
    });

    // A fresh one, opened by the owner → no longer dismissable.
    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, poId));
    const again = ((await prepareOrderDraft(db, { restaurantId: A.restaurantId, supplierId: A.supplierId, orderDay: DAY, dayStart, dayEnd, now })) as { poId: string }).poId;
    await openDraft(db, { restaurantId: A.restaurantId, userId: A.ownerUserId, supplierId: A.supplierId });
    expect(await dismissAutopilotDraft(db, { restaurantId: A.restaurantId, poId: again, userId: A.ownerUserId })).toEqual({ status: 'conflict', reason: 'opened' });
    await db.update(purchaseOrders).set({ status: 'sent', createdBy: null }).where(eq(purchaseOrders.id, again));
    expect(await dismissAutopilotDraft(db, { restaurantId: A.restaurantId, poId: again, userId: A.ownerUserId })).toEqual({ status: 'conflict', reason: 'not_draft' });
  });
});

describe('prepareBackorderDraft (A16b): never re-order units the supplier billed', () => {
  /** A fresh order with two lines and a partial receipt; no invoice linked. */
  async function shortDelivery(t: Tenant, rec: [number, number]) {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', source: 'manual', sentAt: now })
      .returning({ id: purchaseOrders.id });
    const [l1, l2] = await db
      .insert(poLines)
      .values([
        { poId: po!.id, productId: t.productId, rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' },
        { poId: po!.id, productId: onion, rawDescription: 'בצל', qtyOrdered: '4', unit: 'kg', unitPriceExpected: '4' },
      ])
      .returning({ id: poLines.id });
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId: t.restaurantId, poId: po!.id, receivedBy: t.ownerUserId, status: 'partial' })
      .returning({ id: goodsReceipts.id });
    const [g1, g2] = await db
      .insert(grLines)
      .values([
        { grId: gr!.id, poLineId: l1!.id, qtyReceived: String(rec[0]), qtyRejected: '0' },
        { grId: gr!.id, poLineId: l2!.id, qtyReceived: String(rec[1]), qtyRejected: '0' },
      ])
      .returning({ id: grLines.id });
    return { poId: po!.id, grId: gr!.id, l1: l1!.id, l2: l2!.id, g1: g1!.id, g2: g2!.id };
  }

  /** A fresh invoice matched against the receipt; `over` = [order line, its product, qty billed] raising a QTY_OVER. */
  async function matched(t: Tenant, s: Awaited<ReturnType<typeof shortDelivery>>, over: Array<[string, string, number]>) {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: t.restaurantId,
        supplierId: t.supplierId,
        invoiceNumber: `INV-BO-${s.grId.slice(0, 6)}-${++invoiceSeq}`,
        invoiceDate: now,
        totalExclVat: '1.00',
        vatAmount: '0.17',
        totalInclVat: '1.17',
        status: 'matched',
        source: 'photo',
        createdBy: t.ownerUserId,
      })
      .returning({ id: invoices.id });
    const [run] = await db
      .insert(matchRuns)
      .values({ restaurantId: t.restaurantId, poId: s.poId, grId: s.grId, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning({ id: matchRuns.id });
    for (const [poLineId, productId, billed] of over) {
      const [il] = await db
        .insert(invoiceLines)
        .values({ invoiceId: inv!.id, productId, rawDescription: 'x', qtyBilled: String(billed), unit: 'kg', unitPriceBilled: '8.5', lineTotal: '1' })
        .returning({ id: invoiceLines.id });
      await db.insert(discrepancies).values({
        matchRunId: run!.id,
        restaurantId: t.restaurantId,
        type: 'QTY_OVER',
        severity: 'block',
        deltaAmount: '1.00',
        requiresRole: 'manager',
        resolutionStatus: 'open',
        poLineId,
        invoiceLineId: il!.id,
        expectedValue: '0',
        actualValue: String(billed), // the engine stores the billed qty here, in the order's unit
      });
    }
  }

  const draftLines = async (poId: string) =>
    Object.fromEntries((await db.select().from(poLines).where(eq(poLines.poId, poId))).map((l) => [l.rawDescription, Number(l.qtyOrdered)]));

  it('no invoice yet: ordered − received, flagged "החשבונית עוד לא הותאמה"; replay → the same draft', async () => {
    const s = await shortDelivery(A, [8, 0]);
    const r = await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now });
    expect(r).toMatchObject({ status: 'created', lineCount: 2 });
    const poId = (r as { poId: string }).poId;
    expect(await draftLines(poId)).toEqual({ עגבניות: 2, בצל: 4 });
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po).toMatchObject({ status: 'draft', source: 'manual', sourceRef: `au:A16b:${s.grId}`, createdBy: null });
    expect(po!.notes).toContain('החשבונית עוד לא הותאמה');
    expect(po!.notes).not.toMatch(/דריש|תביע|מחלוק/);
    expect(await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now })).toEqual({ status: 'exists', poId, lineCount: 2 });
    expect(await supplierOutbox()).toEqual([]);
  });

  it('missing units billed in full (QTY_OVER) → excluded and noted as a credit request', async () => {
    const s = await shortDelivery(A, [8, 2]);
    await matched(A, s, [[s.l1, A.productId, 10]]); // tomatoes: 8 arrived, 10 billed
    const r = await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now });
    const poId = (r as { poId: string }).poId;
    expect(await draftLines(poId)).toEqual({ בצל: 2 }); // onion billed only what arrived → re-ordered
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po!.notes).toContain('עגבניות: לא נוסף');
    expect(po!.notes).toContain('בקשת זיכוי');
    expect(po!.notes).not.toContain('החשבונית עוד לא הותאמה');
  });

  it('half the missing units billed → re-order ordered − billed', async () => {
    const s = await shortDelivery(A, [6, 4]);
    await matched(A, s, [[s.l1, A.productId, 8]]);
    const r = await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now });
    expect(await draftLines((r as { poId: string }).poId)).toEqual({ עגבניות: 2 });
  });

  it('two invoices bill the same line: the bills add up (10 ordered, 2 arrived, 3 + 3 billed → re-order 4)', async () => {
    const s = await shortDelivery(A, [2, 4]);
    await matched(A, s, [[s.l1, A.productId, 3]]);
    await matched(A, s, [[s.l1, A.productId, 3]]);
    const r = await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now });
    expect(await draftLines((r as { poId: string }).poId)).toEqual({ עגבניות: 4 });
  });

  it('a QTY_OVER already escalated (credit request in progress) still counts as billed', async () => {
    const s = await shortDelivery(A, [8, 4]);
    await matched(A, s, [[s.l1, A.productId, 10]]);
    await db.update(discrepancies).set({ resolutionStatus: 'escalated' }).where(eq(discrepancies.type, 'QTY_OVER'));
    expect(await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now })).toEqual({
      status: 'skipped',
      reason: 'nothing_to_reorder',
    });
  });

  it('the invoice bills the product in another unit (a case) → never re-ordered, noted', async () => {
    const s = await shortDelivery(A, [0, 4]);
    await matched(A, s, []);
    const [run] = await db.select({ invoiceId: matchRuns.invoiceId }).from(matchRuns).where(eq(matchRuns.grId, s.grId));
    await db.insert(invoiceLines).values({ invoiceId: run!.invoiceId!, productId: A.productId, rawDescription: 'ארגז עגבניות', qtyBilled: '1', unit: 'case', unitPriceBilled: '85', lineTotal: '85' });
    expect(await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now })).toEqual({
      status: 'skipped',
      reason: 'nothing_to_reorder',
    });
  });

  it('everything billed → no draft; completed receipt, foreign receipt or option off → nothing', async () => {
    const s = await shortDelivery(A, [8, 4]);
    await matched(A, s, [[s.l1, A.productId, 10]]);
    expect(await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: s.grId, now })).toEqual({
      status: 'skipped',
      reason: 'nothing_to_reorder',
    });
    const t = await shortDelivery(A, [8, 4]);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, t.grId));
    expect(await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: t.grId, now })).toEqual({ status: 'skipped', reason: 'not_partial' });
    const u = await shortDelivery(A, [1, 1]);
    expect(await prepareBackorderDraft(db, { restaurantId: B.restaurantId, goodsReceiptId: u.grId, now })).toEqual({ status: 'skipped', reason: 'not_found' });
    await db.update(restaurants).set({ settings: { automations: { backorderDraft: false } } as never }).where(eq(restaurants.id, A.restaurantId));
    expect(await prepareBackorderDraft(db, { restaurantId: A.restaurantId, goodsReceiptId: u.grId, now })).toEqual({ status: 'skipped', reason: 'option_off' });
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.status, 'draft'))).toEqual([]);
  });
});

describe('findSendRescues (A16c): reads the send state only', () => {
  async function placedWith(t: Tenant, msg: { status: 'failed' | 'sent' | 'queued'; lastError?: string | null }, hoursAgo = 3) {
    const at = new Date(now.getTime() - hoursAgo * 3600_000);
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', source: 'manual', sentAt: at, createdBy: t.ownerUserId })
      .returning({ id: purchaseOrders.id });
    await db.insert(notificationsOutbox).values({
      restaurantId: t.restaurantId,
      channel: 'email',
      target: 'supplier@example.test',
      body: 'order',
      status: msg.status,
      lastError: msg.lastError ?? null,
      relatedEntityType: 'purchase_order',
      relatedEntityId: po!.id,
      dedupeKey: `po:${po!.id}:placed`,
    });
    return po!.id;
  }

  it('no provider or failed → rescue; sent, old, received or another restaurant → none', async () => {
    const skipped = await placedWith(A, { status: 'failed', lastError: SKIPPED_NO_PROVIDER });
    const failed = await placedWith(A, { status: 'failed', lastError: 'smtp 550' });
    await placedWith(A, { status: 'sent' });
    await placedWith(A, { status: 'failed', lastError: 'x' }, 60);
    const received = await placedWith(A, { status: 'failed', lastError: 'x' });
    await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, poId: received, receivedBy: A.ownerUserId, status: 'pending' });
    await placedWith(B, { status: 'failed', lastError: SKIPPED_NO_PROVIDER });

    const rows = await findSendRescues(db, A.restaurantId, now);
    expect(rows.map((r) => r.poId).sort()).toEqual([skipped, failed].sort());
    expect(rows.every((r) => r.createdBy === A.ownerUserId)).toBe(true);
    // Read-only: no outbox row changed.
    expect(
      (await db.select().from(notificationsOutbox).where(and(eq(notificationsOutbox.restaurantId, A.restaurantId), eq(notificationsOutbox.status, 'failed'))))
        .filter((r) => r.dedupeKey?.startsWith('po:')).length,
    ).toBe(4);
  });
});

describe('receiving.submitReceipt → backorder hook', () => {
  it('a short receipt leaves at most one backorder draft, never for units the invoice billed, and never fails the receipt', async () => {
    const { appRouter } = await import('../index');
    const caller = appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } } as never);
    // Fixture: 10 ordered, 5 received; the invoice billed 10 (so the 5 missing units are billed: a credit request, not a re-order).
    const closed = await caller.receiving.submitReceipt({ grId: A.grId });
    expect(closed.status).toBe('partial');
    const drafts = await db.select().from(purchaseOrders).where(eq(purchaseOrders.sourceRef, `au:A16b:${A.grId}`));
    const over = await db.select().from(discrepancies).where(and(eq(discrepancies.restaurantId, A.restaurantId), eq(discrepancies.type, 'QTY_OVER')));
    // The invoice billed all 10: the 5 missing units are a credit request — no backorder.
    expect(drafts).toEqual([]);
    void over;
    expect(await supplierOutbox()).toEqual([]);
  });
});
