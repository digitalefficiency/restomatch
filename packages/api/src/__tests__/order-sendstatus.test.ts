import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, createDb, eq, notificationsOutbox, purchaseOrders, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { sendStateOf } from '../routers/orders';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Pilot W1-11: orders.sendStatus — what really happened to a placed order's message.
 * Never "sent" on faith: the success screen and the PO page read this.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function draft(tenant: Tenant) {
  const r = await callerFor(tenant).orders.createDraft({
    supplierId: tenant.supplierId,
    lines: [{ rawDescription: 'עגבניות', qty: 4, unit: 'ק״ג', unitPriceExpected: 6.5 }],
  });
  return r.poId;
}

async function setOutbox(poId: string, patch: Partial<typeof notificationsOutbox.$inferInsert>) {
  await db
    .update(notificationsOutbox)
    .set(patch)
    .where(and(eq(notificationsOutbox.relatedEntityType, 'purchase_order'), eq(notificationsOutbox.relatedEntityId, poId)));
}

describe('sendStateOf (pure)', () => {
  it('maps the PO + latest outbox row to one state', () => {
    expect(sendStateOf('draft', null)).toBe('none');
    expect(sendStateOf('sent', null)).toBe('none');
    expect(sendStateOf('sent', { status: 'queued', lastError: null })).toBe('queued');
    expect(sendStateOf('sent', { status: 'sending', lastError: null })).toBe('queued');
    expect(sendStateOf('sent', { status: 'sent', lastError: null })).toBe('sent');
    expect(sendStateOf('sent', { status: 'failed', lastError: 'boom' })).toBe('failed');
    expect(sendStateOf('sent', { status: 'cancelled', lastError: null })).toBe('failed');
    expect(sendStateOf('sent', { status: 'failed', lastError: 'skipped_no_provider' })).toBe('skipped');
    expect(sendStateOf('sent', { status: 'queued', lastError: 'skipped_no_provider' })).toBe('skipped');
  });
});

describe('orders.sendStatus', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    await db.update(suppliers).set({ contactEmail: 'orders@supplier-a.test' }).where(eq(suppliers.id, A.supplierId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('a draft: none, final, never placed', async () => {
    const poId = await draft(A);
    const s = await callerFor(A).orders.sendStatus({ poId });
    expect(s).toMatchObject({ state: 'none', channel: null, poStatus: 'draft', placedAt: null, sentAt: null, final: true });
  });

  it('record-only ("ללא שליחה"): none — placed, but no message and no channel', async () => {
    const poId = await draft(A);
    await callerFor(A).orders.placeOrder({ poId, channel: 'none' });
    const s = await callerFor(A).orders.sendStatus({ poId });
    expect(s).toMatchObject({ state: 'none', channel: null, poStatus: 'sent', sentAt: null, final: true });
    expect(s.placedAt).not.toBeNull();
  });

  it('email just placed: queued (not final) → sent with the provider time', async () => {
    const poId = await draft(A);
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    expect(await callerFor(A).orders.sendStatus({ poId })).toMatchObject({ state: 'queued', channel: 'email', final: false, sentAt: null });

    const at = new Date('2026-11-08T07:15:00.000Z');
    await setOutbox(poId, { status: 'sent', sentAt: at });
    expect(await callerFor(A).orders.sendStatus({ poId })).toMatchObject({
      state: 'sent',
      channel: 'email',
      sentAt: at.toISOString(),
      final: true,
    });
  });

  it('a failed message: failed, final', async () => {
    const poId = await draft(A);
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    await setOutbox(poId, { status: 'failed', lastError: 'Resend 500' });
    expect(await callerFor(A).orders.sendStatus({ poId })).toMatchObject({ state: 'failed', channel: 'email', sentAt: null, final: true });
  });

  it('no provider configured: skipped, final', async () => {
    const poId = await draft(A);
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    await setOutbox(poId, { status: 'failed', lastError: 'skipped_no_provider' });
    expect(await callerFor(A).orders.sendStatus({ poId })).toMatchObject({ state: 'skipped', final: true });
  });

  it('every member role may read it (read-only)', async () => {
    const poId = await draft(A);
    for (const role of ['owner', 'manager', 'chef', 'receiver', 'bookkeeper'] as const) {
      await expect(callerFor(A, role).orders.sendStatus({ poId })).resolves.toMatchObject({ state: 'none' });
    }
  });

  it("another restaurant's PO is not found (no B state leaks)", async () => {
    const poId = await draft(B);
    await callerFor(B).orders.placeOrder({ poId, channel: 'none' });
    await expect(callerFor(A).orders.sendStatus({ poId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).orders.sendStatus({ poId: B.poId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * Train-A review (MEDIUM): the supplier-delays job (apps/worker/src/jobs/supplierDelays.ts)
 * writes late-chase mail to the owner/manager with the SAME relatedEntityType/Id as the
 * order message (dedupeKey `po:<id>:late:d<n>:<email>`). The order screens must read the
 * order message only (`po:<id>:placed`), never the latest row about the PO.
 */
describe('orders.sendStatus / orders.get ignore the late-chase mail about the same PO', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db.update(suppliers).set({ contactEmail: 'orders@supplier-a.test' }).where(eq(suppliers.id, A.supplierId));
  });

  /** A late-chase row exactly as supplierDelays enqueues it, written after the order. */
  async function lateChase(poId: string, patch: Partial<typeof notificationsOutbox.$inferInsert>) {
    await db.insert(notificationsOutbox).values({
      restaurantId: A.restaurantId,
      channel: 'email',
      target: 'owner@restaurant-a.test',
      subject: 'הזמנה באיחור',
      body: 'ההזמנה עוד לא הגיעה',
      status: 'queued',
      relatedEntityType: 'purchase_order',
      relatedEntityId: poId,
      dedupeKey: `po:${poId}:late:d1:owner@restaurant-a.test`,
      createdAt: new Date(Date.now() + 60_000),
      ...patch,
    });
  }

  it('(a) a record-only order a day late stays recorded (none) after the chase email is dispatched — never "sent"', async () => {
    const poId = await draft(A);
    await callerFor(A).orders.placeOrder({ poId, channel: 'none' });
    await lateChase(poId, { status: 'sent', sentAt: new Date() });
    const s = await callerFor(A).orders.sendStatus({ poId });
    expect(s).toMatchObject({ state: 'none', channel: null, sentAt: null, final: true });
    expect((await callerFor(A).orders.get({ poId })).supplierMessage).toBeNull();
  });

  it('(b) a WhatsApp order with no email provider: the skipped chase row does not turn it "unsent"', async () => {
    const poId = await draft(A);
    // The order message as placeOrder writes it for WhatsApp (entitlement-gated, so seeded here).
    const sentAt = new Date('2026-11-08T07:15:00.000Z');
    await db.insert(notificationsOutbox).values({
      restaurantId: A.restaurantId,
      channel: 'whatsapp',
      target: '+972525551234',
      body: 'הזמנה חדשה',
      status: 'sent',
      sentAt,
      relatedEntityType: 'purchase_order',
      relatedEntityId: poId,
      dedupeKey: `po:${poId}:placed`,
    });
    await callerFor(A).orders.placeOrder({ poId, channel: 'none' }); // draft → sent
    await db.update(purchaseOrders).set({ sentChannel: 'whatsapp' }).where(eq(purchaseOrders.id, poId));
    await lateChase(poId, { status: 'failed', lastError: 'skipped_no_provider' });
    const s = await callerFor(A).orders.sendStatus({ poId });
    expect(s.state).not.toBe('skipped');
    expect(s).toMatchObject({ state: 'sent', channel: 'whatsapp', sentAt: sentAt.toISOString() });
    expect((await callerFor(A).orders.get({ poId })).supplierMessage).toBe('sent');
  });

  it('an emailed order still reads its own message (queued), whatever the chase row says', async () => {
    const poId = await draft(A);
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    await lateChase(poId, { status: 'sent', sentAt: new Date() });
    expect(await callerFor(A).orders.sendStatus({ poId })).toMatchObject({ state: 'queued', channel: 'email', final: false });
  });
});
