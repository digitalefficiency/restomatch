import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  notificationsOutbox,
  poLines,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
  suppliers,
} from '@restomatch/db';
import { StubOrderTextParser } from '@restomatch/ocr';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { captureOrderDraft, captureSourceRef } from '../orders/captureOrder';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** orderCapture: an owner's WhatsApp order message → a draft PO → one-tap confirm. */
const db = createDb(testDbUrl());
let A: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}
const parser = new StubOrderTextParser();
const capture = (text: string, extra: Partial<Parameters<typeof captureOrderDraft>[1]> = {}) =>
  captureOrderDraft(db, { restaurantId: A.restaurantId, text, parser, source: 'manual', ...extra });

describe('order capture', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db
      .update(restaurants)
      .set({ settings: { features: { orderCapture: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('a message naming the supplier → a draft PO with catalog-matched lines and stated prices', async () => {
    const r = await capture(`הזמנה ל${A.supplierName} למחר:\n10 ק"ג tomato-A\n3 ארגזים חסה 45 ₪\nתודה`);
    expect(r).toMatchObject({ status: 'draft', created: true, matchedBy: 'name', lineCount: 2, mappedCount: 1 });
    if (r.status !== 'draft') return;
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, r.poId));
    expect(po).toMatchObject({ status: 'draft', source: 'manual', supplierId: A.supplierId, totalEstimated: '135.00' });
    const lines = await db.select().from(poLines).where(eq(poLines.poId, r.poId));
    expect(lines.map((l) => [l.rawDescription, l.qtyOrdered, l.unit, l.productId, l.unitPriceExpected]).sort()).toEqual(
      [
        ['tomato-A', '10.000', 'ק״ג', A.productId, null],
        ['חסה', '3.000', 'ארגז', null, '45.0000'],
      ].sort(),
    );
  });

  it('matches the supplier by the WhatsApp sender phone (E.164-normalised)', async () => {
    await db.update(suppliers).set({ contactWhatsapp: '052-555-1234' }).where(eq(suppliers.id, A.supplierId));
    const r = await capture('5 ק״ג מלפפונים', { senderPhone: '972525551234', source: 'whatsapp' });
    expect(r).toMatchObject({ status: 'draft', matchedBy: 'phone', supplier: { id: A.supplierId } });
    if (r.status === 'draft') {
      const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, r.poId));
      expect(po?.source).toBe('whatsapp');
    }
  });

  it('an unknown supplier is never guessed or created: needs_supplier, then the owner picks', async () => {
    await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'דגי הים' });
    const text = '4 ק״ג סלמון\n2 ק״ג דניס';
    const ask = await capture(text);
    expect(ask).toMatchObject({ status: 'needs_supplier', supplierName: null });
    if (ask.status !== 'needs_supplier') return;
    expect(ask.lines).toHaveLength(2);
    expect(ask.candidates).toHaveLength(2);
    const before = await db.select().from(suppliers).where(eq(suppliers.restaurantId, A.restaurantId));
    expect(before).toHaveLength(2);
    const picked = await capture(text, { supplierId: ask.candidates.find((c) => c.name === 'דגי הים')!.id });
    expect(picked).toMatchObject({ status: 'draft', matchedBy: 'picked', supplier: { name: 'דגי הים' } });
  });

  it('two suppliers named in the text → ask (no guess)', async () => {
    await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ירקות השרון' });
    const r = await capture(`${A.supplierName} או ירקות השרון\n10 ק״ג בצל`);
    expect(r.status).toBe('needs_supplier');
    if (r.status === 'needs_supplier') expect(r.candidates).toHaveLength(2);
  });

  it('is idempotent per message: a re-forward / double tap returns the same draft', async () => {
    const text = `ספק: ${A.supplierName}\n10 ק״ג tomato-A`;
    const first = await capture(text);
    const again = await capture(`  ${text.replaceAll('\n', '\n\n')}  `);
    expect(first.status === 'draft' && again.status === 'draft' && again.poId === first.poId).toBe(true);
    expect(again).toMatchObject({ created: false, lineCount: 1, mappedCount: 1 });
    expect(captureSourceRef('A  b\nC')).toBe(captureSourceRef('a b c'));
  });

  it('fills a missing price from the supplier catalog list price', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierSku: 'T-1',
      supplierNameRaw: 'עגבניה',
      unit: 'ק״ג',
      listPrice: '7.50',
    });
    const r = await capture(`ספק: ${A.supplierName}\n4 ק״ג tomato-A`);
    expect(r.status).toBe('draft');
    if (r.status !== 'draft') return;
    const [line] = await db.select().from(poLines).where(eq(poLines.poId, r.poId));
    expect(line?.unitPriceExpected).toBe('7.5000');
  });

  it('a message with no order lines writes nothing', async () => {
    expect(await capture('שלום, מה שלומך? תודה')).toEqual({ status: 'no_lines' });
    const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.restaurantId, A.restaurantId));
    expect(pos).toHaveLength(1); // the seeded PO only
  });

  it('router: flag gate, writers only, and one-tap confirm sends nothing to the supplier', async () => {
    const text = `ספק: ${A.supplierName}\n10 ק״ג tomato-A`;
    // Owner decision 31.10 (pilot): the chef orders freely (orders-chef.test.ts); receiver and bookkeeper never write.
    for (const role of ['receiver', 'bookkeeper'] as const) {
      await expect(callerFor(A, role).orders.captureFromText({ text })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const r = await callerFor(A).orders.captureFromText({ text });
    expect(r.status).toBe('draft');
    if (r.status !== 'draft') return;
    // Confirm = placeOrder with channel 'none': draft → sent, no outbox row.
    await callerFor(A).orders.placeOrder({ poId: r.poId, channel: 'none' });
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, r.poId));
    expect(po).toMatchObject({ status: 'sent', sentChannel: null });
    expect(await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, r.poId))).toEqual([]);

    await db.update(restaurants).set({ settings: {} as never }).where(eq(restaurants.id, A.restaurantId));
    await expect(callerFor(A).orders.captureFromText({ text: '1 ק״ג גזר' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'FEATURE_DISABLED' },
    });
  });
});
