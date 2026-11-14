import { createDb, poLines, products, purchaseOrders, testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../index';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * receiving-12 (interim, until H-03's `line_no`): the PO, receipt and invoice
 * views list lines in ONE stable order — category, then name — never in random
 * UUID order, so the receiver's list never reshuffles between screens or reloads.
 */
const db = createDb(testDbUrl());

let t: Tenant;
const caller = () => appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } });

beforeEach(async () => {
  await resetDb(db);
  t = await seedTenant(db, 'order');
});
afterAll(async () => {
  await resetDb(db);
});

async function poWith(lines: Array<{ name: string; category: string | null }>): Promise<string> {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning();
  for (const l of lines) {
    const [p] = await db
      .insert(products)
      .values({ restaurantId: t.restaurantId, canonicalName: l.name, category: l.category })
      .returning();
    await db.insert(poLines).values({ poId: po!.id, productId: p!.id, rawDescription: l.name, qtyOrdered: '1', unit: 'יח׳', unitPriceExpected: '1' });
  }
  return po!.id;
}

describe('receiving line order (interim: category, then name)', () => {
  it('getPo and the receipt list lines by category, then name, whatever the insert order', async () => {
    const poId = await poWith([
      { name: 'עגבניה', category: 'ירקות' },
      { name: 'אנטריקוט', category: 'בשר' },
      { name: 'בצל', category: 'ירקות' },
      { name: 'מלח', category: null },
      { name: 'אסאדו', category: 'בשר' },
    ]);
    const expected = ['אנטריקוט', 'אסאדו', 'בצל', 'עגבניה', 'מלח'];
    const po = await caller().receiving.getPo({ poId });
    expect(po.lines.map((l) => l.rawDescription)).toEqual(expected);

    const r = await caller().receiving.startReceipt({ poId });
    const receipt = await caller().receiving.getReceipt({ grId: r.receiptId });
    expect(receipt.lines.map((l) => l.productName)).toEqual(expected);
  });
});
