import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  poLines,
  purchaseOrders,
  restaurants,
  supplierConfirmLinks,
  supplierResponses,
  suppliers,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { createSupplierLink } from '@restomatch/api';
import { supplierPortalView } from '../data';

/**
 * G-10 review #2.2 · what the portal page gets for an order that is no longer
 * open: cancelled/closed → CLOSED ("no answer needed"), not "the link expired";
 * an answer on record is still shown; any other non-open order → EXPIRED.
 */
const db = createDb(testDbUrl());
let rid: string;
let sid: string;
const tag = `pv-${Date.now()}`;

beforeAll(async () => {
  const [r] = await db
    .insert(restaurants)
    .values({ name: `Portal view ${tag}`, settings: { features: { supplierConfirm: true } } as RestaurantSettings })
    .returning();
  rid = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ספק' }).returning();
  sid = s!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, rid));
});

/** A sent 1-line order + a live link; then the order moves to `status`. */
async function orderWithLink(status: 'cancelled' | 'closed' | 'draft', answered = false) {
  const [po] = await db.insert(purchaseOrders).values({ restaurantId: rid, supplierId: sid, status: 'sent', source: 'manual' }).returning();
  await db.insert(poLines).values({ poId: po!.id, rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' });
  const link = (await createSupplierLink(db, rid, po!.id))!;
  if (answered) {
    const [l] = await db.select({ id: supplierConfirmLinks.id }).from(supplierConfirmLinks).where(eq(supplierConfirmLinks.poId, po!.id));
    await db
      .insert(supplierResponses)
      .values({ restaurantId: rid, poId: po!.id, linkId: l!.id, status: 'confirmed', lines: [], submittedAt: new Date() });
  }
  await db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, po!.id));
  return link.token;
}

describe('supplierPortalView for an order that is no longer open', () => {
  it('cancelled or closed with no answer → CLOSED', async () => {
    expect(await supplierPortalView(await orderWithLink('cancelled'))).toEqual({ ok: false, error: 'CLOSED' });
    expect(await supplierPortalView(await orderWithLink('closed'))).toEqual({ ok: false, error: 'CLOSED' });
  });

  it('cancelled with an answer on record → ok, the response is shown, confirmable: false', async () => {
    const res = await supplierPortalView(await orderWithLink('cancelled', true));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view).toMatchObject({ confirmable: false, closed: true, response: expect.objectContaining({ status: 'confirmed' }) });
  });

  it('back to draft with no answer → EXPIRED', async () => {
    expect(await supplierPortalView(await orderWithLink('draft'))).toEqual({ ok: false, error: 'EXPIRED' });
  });
});
