import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, createDb, eq, poLines, productAliases, purchaseOrders } from '@restomatch/db';
import type { NormalizedPurchaseOrder } from '@restomatch/types';
import { importPurchaseOrder } from '../orders/importPo';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

let t: Tenant;
beforeEach(async () => {
  await resetDb(db);
  t = await seedTenant(db, 'impo');
});
afterAll(async () => {
  await resetDb(db);
});

/** A Zestt-shaped normalized PO addressed to the seeded supplier (by name). */
function makeNormalized(over: Partial<NormalizedPurchaseOrder> = {}): NormalizedPurchaseOrder {
  return {
    externalId: '7158745',
    platform: 'zestt',
    supplierExternalId: t.supplierName,
    supplierName: t.supplierName,
    expectedDeliveryAt: '2026-06-20T00:00:00.000Z',
    status: 'sent',
    currency: 'ILS',
    lines: [
      { sku: '300099', rawDescription: 'טיבון עגלה אנגוס טרי', qty: 12, unit: 'יח׳', unitPrice: 84, lineTotal: 1008 },
      { sku: '100026', rawDescription: 'עצמות עוף טרי', qty: 10, unit: 'ק״ג', unitPrice: 3, lineTotal: 30 },
    ],
    totalEstimated: 1038,
    metadata: {
      vatRate: 0.18,
      totalInclVat: Math.round(1038 * 1.18 * 100) / 100,
      customerOrderRef: '80234-2239',
      buyerName: 'מיטבר הרצליה',
    },
    ...over,
  };
}

describe('importPurchaseOrder', () => {
  it('imports a clean PO as sent, resolves the supplier by name, and writes lines + header', async () => {
    const res = await importPurchaseOrder(db, {
      restaurantId: t.restaurantId,
      normalized: makeNormalized(),
      createdBy: t.ownerUserId,
    });

    expect(res.created).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.supplierId).toBe(t.supplierId); // resolved existing supplier by name
    expect(res.lineCount).toBe(2);
    expect(res.checksum.linesSumOk).toBe(true);
    expect(res.checksum.vatOk).toBe(true);

    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, res.poId));
    expect(po?.sourcePlatform).toBe('zestt');
    expect(po?.sourceRef).toBe('7158745');
    expect(po?.customerRef).toBe('80234-2239');
    expect(po?.buyerName).toBe('מיטבר הרצליה');
    expect(po?.vatRate).toBe('0.1800');
    expect(po?.status).toBe('sent');

    const lines = await db.select().from(poLines).where(eq(poLines.poId, res.poId));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.supplierSku).sort()).toEqual(['100026', '300099']);
    // Hebrew units preserved verbatim.
    expect(lines.find((l) => l.supplierSku === '300099')?.unit).toBe('יח׳');
  });

  it('is idempotent: re-importing the same order updates in place, never duplicates', async () => {
    const first = await importPurchaseOrder(db, {
      restaurantId: t.restaurantId,
      normalized: makeNormalized(),
      createdBy: t.ownerUserId,
    });
    const second = await importPurchaseOrder(db, {
      restaurantId: t.restaurantId,
      normalized: makeNormalized({ totalEstimated: 1038 }),
      createdBy: t.ownerUserId,
    });

    expect(second.created).toBe(false);
    expect(second.poId).toBe(first.poId);

    const rows = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, t.restaurantId),
          eq(purchaseOrders.sourcePlatform, 'zestt'),
          eq(purchaseOrders.sourceRef, '7158745'),
        ),
      );
    expect(rows).toHaveLength(1);
    const lines = await db.select().from(poLines).where(eq(poLines.poId, first.poId));
    expect(lines).toHaveLength(2); // replaced, not appended
  });

  it('resolves a line to a product when a SKU alias already exists', async () => {
    await db.insert(productAliases).values({
      productId: t.productId,
      supplierId: t.supplierId,
      supplierSku: '300099',
      supplierNameRaw: 'טיבון',
      confidence: '1.000',
    });

    const res = await importPurchaseOrder(db, {
      restaurantId: t.restaurantId,
      normalized: makeNormalized(),
      createdBy: t.ownerUserId,
    });

    expect(res.mappedCount).toBe(1);
    expect(res.unmappedCount).toBe(1);
    const mapped = await db
      .select()
      .from(poLines)
      .where(and(eq(poLines.poId, res.poId), eq(poLines.supplierSku, '300099')));
    expect(mapped[0]?.productId).toBe(t.productId);
  });

  it('holds a PO as draft when the totals checksum fails', async () => {
    // Lines sum to 1038 but the printed ex-VAT total claims 9999 → checksum fail.
    const res = await importPurchaseOrder(db, {
      restaurantId: t.restaurantId,
      normalized: makeNormalized({ totalEstimated: 9999 }),
      createdBy: t.ownerUserId,
    });
    expect(res.status).toBe('draft');
    expect(res.checksum.linesSumOk).toBe(false);
  });
});
