import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, createDb, discrepancies, eq, invoiceLines, productAliases, products, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · products.mergePreview is read-only and restaurant-scoped: A can
 * preview only its own two products, B's products are NOT_FOUND, nothing is
 * written, and only owner / manager may ask.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function secondProduct(t: Tenant, name: string) {
  const [p] = await db
    .insert(products)
    .values({ restaurantId: t.restaurantId, canonicalName: name, defaultUnit: 'kg' })
    .returning({ id: products.id });
  return p!.id;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => resetDb(db));

describe('W3-10 products.mergePreview', () => {
  it("previews A's merge: aliases, catalog rows, money evidence (counts); nothing is written", async () => {
    const into = await secondProduct(A, 'עגבניה');
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierSku: 'MP-1',
      supplierNameRaw: 'עגבניה שרי',
    });
    const before = {
      aliases: await db.select({ id: productAliases.id, p: productAliases.productId }).from(productAliases),
      lines: await db.select({ id: invoiceLines.id, p: invoiceLines.productId }).from(invoiceLines),
    };
    const res = await callerFor(A).products.mergePreview({ fromId: A.productId, intoId: into });
    expect(res.from.id).toBe(A.productId);
    expect(res.into.id).toBe(into);
    expect(res.preview.catalogItemsMoved).toBeGreaterThanOrEqual(1);
    expect(res.preview.aliasesAdded.length).toBeGreaterThanOrEqual(1);
    expect(res.evidence.invoiceLines).toBeGreaterThanOrEqual(1); // the seeded invoice line
    const own = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .where(and(eq(discrepancies.restaurantId, A.restaurantId), eq(discrepancies.productId, A.productId)));
    expect(res.evidence.findings).toBe(own.length);
    expect(await db.select({ id: productAliases.id, p: productAliases.productId }).from(productAliases)).toEqual(before.aliases);
    expect(await db.select({ id: invoiceLines.id, p: invoiceLines.productId }).from(invoiceLines)).toEqual(before.lines);
    const [still] = await db.select({ id: products.id }).from(products).where(eq(products.id, A.productId));
    expect(still).toBeDefined();
  });

  it("either product of B → NOT_FOUND for A", async () => {
    const intoA = await secondProduct(A, 'עגבניה');
    await expect(callerFor(A).products.mergePreview({ fromId: B.productId, intoId: intoA })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).products.mergePreview({ fromId: A.productId, intoId: B.productId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the same product twice → BAD_REQUEST', async () => {
    await expect(callerFor(A).products.mergePreview({ fromId: A.productId, intoId: A.productId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each(['chef', 'receiver', 'bookkeeper'] as const)('%s → FORBIDDEN', async (role) => {
    const into = await secondProduct(A, 'עגבניה');
    await expect(callerFor(A, role).products.mergePreview({ fromId: A.productId, intoId: into })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
