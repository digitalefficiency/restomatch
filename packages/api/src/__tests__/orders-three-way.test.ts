import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoiceLines } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-06 §5.5 — ordered · received · billed · gap ₪ per PO line; receiver gets no ₪; tenant-isolated. */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const callerFor = (t: Tenant, role: Session['role'] = 'manager') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

describe('orders.threeWay', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    // Pair the fixture discrepancy with the PO line and the invoice line.
    const [il] = await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, A.invoiceId));
    await db
      .update(discrepancies)
      .set({ poLineId: A.poLineId, invoiceLineId: il!.id })
      .where(eq(discrepancies.id, A.discrepancyId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('per line: ordered 10, received 5 (the GR), billed 10 at ₪10, gap ₪100', async () => {
    const r = await callerFor(A).orders.threeWay({ poId: A.poId });
    expect(r).toMatchObject({ hasReceipt: true, hasInvoice: true, gapTotalIls: 100 });
    expect(r.lines).toEqual([
      expect.objectContaining({
        poLineId: A.poLineId,
        ordered: 10,
        received: 5,
        billed: 10,
        unitPriceExpected: 8.5,
        unitPriceBilled: 10,
        gapIls: 100,
      }),
    ]);
  });

  it('the receiver gets the quantities and no ₪ key', async () => {
    const r = await callerFor(A, 'receiver').orders.threeWay({ poId: A.poId });
    expect(r.lines[0]).toMatchObject({ ordered: 10, received: 5, billed: 10 });
    expect(JSON.stringify(r)).not.toMatch(/"(unitPrice\w*|\w*Ils|total\w*)"/);
  });

  it("B's PO → NOT_FOUND", async () => {
    await expect(callerFor(A).orders.threeWay({ poId: B.poId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
