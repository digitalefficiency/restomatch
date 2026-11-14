import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, goodsReceipts, notificationsOutbox, poLines, purchaseOrders, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { supplierAddress } from '../orders/manualSend';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-06 §5.3 / §5.9 — send from my WhatsApp; placeOrder's GR refusal and typed address. */
const db = createDb(testDbUrl());
let A: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'manager') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

async function draft(): Promise<string> {
  const { poId } = await callerFor(A).orders.createDraft({
    supplierId: A.supplierId,
    lines: [{ productId: A.productId, rawDescription: 'עגבניות', qty: 2, unit: 'kg', unitPriceExpected: 8 }],
  });
  return poId;
}
const outboxFor = (poId: string) =>
  db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, poId));

describe('orders.markSentManually', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db.update(suppliers).set({ contactWhatsapp: '052-555-1234', contactEmail: 'orders@supplier.test' }).where(eq(suppliers.id, A.supplierId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('draft → sent, sentChannel whatsapp, 0 outbox rows; a second call is a no-op', async () => {
    const poId = await draft();
    const c = callerFor(A);
    const r = await c.orders.markSentManually({ poId, clientMutationId: 'manual-0001' });
    expect(r).toMatchObject({ ok: true, status: 'sent', sentChannel: 'whatsapp', replayed: false });
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po).toMatchObject({ status: 'sent', sentChannel: 'whatsapp' });
    expect(await outboxFor(poId)).toHaveLength(0);
    const again = await c.orders.markSentManually({ poId, clientMutationId: 'manual-0001' });
    expect(again).toMatchObject({ replayed: true, sentAt: r.sentAt });
    expect(await outboxFor(poId)).toHaveLength(0);
    const list = await c.orders.list();
    expect(list.find((p) => p.id === poId)).toMatchObject({ sentManually: true });
  });

  it('prepareManualSend: the exact text before the tap, the supplier E.164, nothing queued or changed', async () => {
    const poId = await draft();
    const p = await callerFor(A).orders.prepareManualSend({ poId });
    expect(p).toMatchObject({ poId, status: 'draft', whatsappTo: '972525551234' });
    expect(p.text).toContain('עגבניות');
    expect(await outboxFor(poId)).toHaveLength(0);
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po!.status).toBe('draft');
  });

  it('refuses an empty draft and a PO with a goods receipt', async () => {
    const poId = await draft();
    await db.delete(poLines).where(eq(poLines.poId, poId));
    await expect(callerFor(A).orders.markSentManually({ poId, clientMutationId: 'manual-0002' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const p2 = await draft();
    await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, poId: p2, receivedBy: A.ownerUserId, status: 'pending' });
    await expect(callerFor(A).orders.markSentManually({ poId: p2, clientMutationId: 'manual-0003' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a platform-sent order is not "sent manually"', async () => {
    const poId = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    await expect(callerFor(A).orders.markSentManually({ poId, clientMutationId: 'manual-0004' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await callerFor(A).orders.list()).find((p) => p.id === poId)).toMatchObject({ sentManually: false });
  });
});

describe('placeOrder (§5.9)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db.update(suppliers).set({ contactWhatsapp: '052-555-1234', contactEmail: ' orders@supplier.test ' }).where(eq(suppliers.id, A.supplierId));
  });

  it('refuses a draft that already has a goods receipt (CONFLICT), nothing queued', async () => {
    const poId = await draft();
    await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, poId, receivedBy: A.ownerUserId, status: 'pending' });
    await expect(callerFor(A).orders.placeOrder({ poId, channel: 'email' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await outboxFor(poId)).toHaveLength(0);
  });

  it('builds the target through a typed address and keeps dedupe po:<id>:placed', async () => {
    const poId = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    const [row] = await outboxFor(poId);
    expect(row).toMatchObject({ target: 'orders@supplier.test', dedupeKey: `po:${poId}:placed` });
  });

  it('supplierAddress: E.164 WhatsApp, a real e-mail, never a role or junk', () => {
    expect(supplierAddress({ email: null, whatsapp: '+972 52-555-1234' }, 'whatsapp')).toEqual({ channel: 'whatsapp', to: '972525551234' });
    expect(supplierAddress({ email: 'role:manager', whatsapp: null }, 'email')).toBeNull();
    expect(supplierAddress({ email: null, whatsapp: 'role:owner' }, 'whatsapp')).toBeNull();
    expect(supplierAddress(null, 'email')).toBeNull();
  });
});
