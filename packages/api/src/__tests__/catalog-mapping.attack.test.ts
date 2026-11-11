import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  invoiceLines,
  poLines,
  productAliases,
  products,
  supplierCatalogItems,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-08 · mapping.unmapped now also lists price-list rows the link policy sent to
 * review (saved unlinked, SKU-keyed). Cross-tenant: B's review rows never list
 * for A, and confirming with B's supplier is NOT_FOUND with nothing written.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function reviewRow(t: Tenant, sku: string, name: string) {
  const [r] = await db
    .insert(supplierCatalogItems)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, productId: null, supplierSku: sku, supplierNameRaw: name })
    .returning({ id: supplierCatalogItems.id });
  return r!.id;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => resetDb(db));

describe('G-08 mapping.unmapped — catalog review rows', () => {
  it('lists an unlinked SKU-keyed price-list row for its own tenant', async () => {
    await reviewRow(A, 'G08-A', 'פלפל אדום חריף');
    const rows = await callerFor(A).mapping.unmapped();
    expect(rows).toContainEqual(
      expect.objectContaining({ supplierId: A.supplierId, supplierSku: 'G08-A', sampleDescription: 'פלפל אדום חריף' }),
    );
  });

  it("tenant B's review rows never list for A", async () => {
    await reviewRow(B, 'G08-B', 'שורה של B');
    const rows = await callerFor(A).mapping.unmapped();
    expect(rows.some((r) => r.supplierSku === 'G08-B' || r.supplierId === B.supplierId)).toBe(false);
    const filtered = await callerFor(A).mapping.unmapped({ supplierId: B.supplierId });
    expect(filtered).toEqual([]);
  });

  it("confirm with B's supplierId → NOT_FOUND, and nothing is written", async () => {
    const itemB = await reviewRow(B, 'G08-B', 'שורה של B');
    const aliasesBefore = await db.select({ id: productAliases.id }).from(productAliases);
    await expect(
      callerFor(A).mapping.confirm({
        supplierId: B.supplierId,
        supplierSku: 'G08-B',
        rawName: 'שורה של B',
        productId: A.productId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [item] = await db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, itemB));
    expect(item?.productId).toBeNull();
    expect(await db.select({ id: productAliases.id }).from(productAliases)).toEqual(aliasesBefore);
  });

  it('confirm links the review row with a 1.000 (human) alias', async () => {
    const itemA = await reviewRow(A, 'G08-A', 'פלפל אדום חריף');
    await callerFor(A, 'manager').mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: 'G08-A',
      rawName: 'פלפל אדום חריף',
      productId: A.productId,
    });
    const [item] = await db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, itemA));
    expect(item?.productId).toBe(A.productId);
    const [alias] = await db
      .select({ confidence: productAliases.confidence })
      .from(productAliases)
      .where(eq(productAliases.supplierNameRaw, 'פלפל אדום חריף'));
    expect(alias?.confidence).toBe('1.000');
    expect((await callerFor(A).mapping.unmapped()).some((r) => r.supplierSku === 'G08-A')).toBe(false);
  });
});

/** An OCR'd invoice line with NO SKU that the policy left unlinked (review). */
async function unlinkedInvoiceLine(t: Tenant, raw: string) {
  const [l] = await db
    .insert(invoiceLines)
    .values({
      invoiceId: t.invoiceId,
      productId: null,
      supplierSku: null,
      rawDescription: raw,
      qtyBilled: '2',
      unit: 'kg',
      unitPriceBilled: '11.00',
      lineTotal: '22.00',
    })
    .returning({ id: invoiceLines.id });
  return l!.id;
}

async function supplierProduct(t: Tenant, name: string) {
  const [p] = await db
    .insert(products)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, canonicalName: name, defaultUnit: 'kg' })
    .returning({ id: products.id });
  // The supplier already sells it, so the policy may suggest it.
  await db.insert(supplierCatalogItems).values({
    restaurantId: t.restaurantId,
    supplierId: t.supplierId,
    productId: p!.id,
    supplierNameRaw: name,
  });
  return p!.id;
}

describe('G-08 name-keyed questions ("זה אותו מוצר?")', () => {
  it('unmapped lists a no-SKU line keyed by (supplier, normalized name), with 1–3 suggestions and the count', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    await unlinkedInvoiceLine(A, '  פלפל   אדום חריף ');
    const rows = await callerFor(A).mapping.unmapped();
    const q = rows.find((r) => r.kind === 'name' && r.nameKey === 'פלפל אדום חריף');
    expect(q).toMatchObject({ supplierId: A.supplierId, supplierSku: null, occurrences: 2 });
    expect(q!.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(q!.suggestions.length).toBeLessThanOrEqual(3);
    expect(q!.suggestions[0]).toMatchObject({ productId: pepper, canonicalName: 'פלפל אדום' });
    // No ₪ anywhere in a question.
    expect(JSON.stringify(q)).not.toMatch(/price|lineTotal|unitPrice|₪/i);
    expect((await callerFor(A).mapping.questionCount()).count).toBeGreaterThanOrEqual(1);
  });

  it('confirm by name key links that supplier\'s same-name lines in place and learns a 0.999 alias', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    const l1 = await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    const l2 = await unlinkedInvoiceLine(A, 'פלפל  אדום חריף');
    const other = await unlinkedInvoiceLine(A, 'בצל לבן');
    const [po] = await db
      .insert(poLines)
      .values({ poId: A.poId, rawDescription: 'פלפל אדום חריף', qtyOrdered: '1', unit: 'kg' })
      .returning({ id: poLines.id });
    const before = (await callerFor(A).mapping.questionCount()).count;

    const r = await callerFor(A, 'manager').mapping.confirm({
      supplierId: A.supplierId,
      rawName: 'פלפל אדום חריף',
      productId: pepper,
    });
    expect(r.invoiceLinesUpdated).toBe(2);
    expect(r.poLinesUpdated).toBe(1);
    const linked = await db.select({ id: invoiceLines.id, productId: invoiceLines.productId }).from(invoiceLines);
    const byId = new Map(linked.map((x) => [x.id, x.productId]));
    expect(byId.get(l1)).toBe(pepper);
    expect(byId.get(l2)).toBe(pepper);
    expect(byId.get(other)).toBeNull();
    const [p] = await db.select({ productId: poLines.productId }).from(poLines).where(eq(poLines.id, po!.id));
    expect(p?.productId).toBe(pepper);
    const [alias] = await db
      .select({ confidence: productAliases.confidence, supplierSku: productAliases.supplierSku })
      .from(productAliases)
      .where(eq(productAliases.supplierNameRaw, 'פלפל אדום חריף'));
    expect(alias).toEqual({ confidence: '0.999', supplierSku: null });
    expect((await callerFor(A).mapping.questionCount()).count).toBe(before - 1);

    // Undo puts exactly those lines back.
    await callerFor(A, 'manager').mapping.confirm({
      supplierId: A.supplierId,
      rawName: 'פלפל אדום חריף',
      revert: r.undo!,
    });
    const [back] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, l1));
    expect(back?.productId).toBeNull();
  });

  it("B's name questions never list or count for A", async () => {
    await unlinkedInvoiceLine(B, 'שורה סודית של B');
    const rows = await callerFor(A).mapping.unmapped();
    expect(rows.some((r) => r.supplierId === B.supplierId || r.sampleDescription.includes('B'))).toBe(false);
    expect(await callerFor(A).mapping.unmapped({ supplierId: B.supplierId })).toEqual([]);
    const a = (await callerFor(A).mapping.questionCount()).count;
    await unlinkedInvoiceLine(B, 'עוד שורה של B');
    expect((await callerFor(A).mapping.questionCount()).count).toBe(a);
  });

  it("confirm by name key with B's supplierId → NOT_FOUND, and B's lines stay unlinked", async () => {
    const lineB = await unlinkedInvoiceLine(B, 'שורה של B');
    await expect(
      callerFor(A, 'manager').mapping.confirm({ supplierId: B.supplierId, rawName: 'שורה של B', productId: A.productId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, lineB));
    expect(l?.productId).toBeNull();
  });

  it("confirm by name key with B's productId → NOT_FOUND, nothing linked", async () => {
    const lineA = await unlinkedInvoiceLine(A, 'שורה של A');
    await expect(
      callerFor(A, 'manager').mapping.confirm({ supplierId: A.supplierId, rawName: 'שורה של A', productId: B.productId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, lineA));
    expect(l?.productId).toBeNull();
  });
});

describe('G-08 mapping.answerLink — the chef may answer "זה אותו מוצר?" (least privilege)', () => {
  it('chef links a question to one of its suggestions: lines backfilled, 0.999 alias, no ₪ in the response; undo works', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    const l1 = await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    const rows = await callerFor(A, 'chef').mapping.unmapped();
    expect(rows.every((r) => r.kind === 'name')).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/price|lineTotal|unitPrice|amount|₪/i);
    const q = rows.find((r) => r.nameKey === 'פלפל אדום חריף')!;
    expect(q.suggestions.map((x) => x.productId)).toContain(pepper);

    const r = await callerFor(A, 'chef').mapping.answerLink({
      supplierId: A.supplierId,
      rawName: q.sampleDescription,
      productId: pepper,
    });
    expect(r.invoiceLinesUpdated).toBe(1);
    expect(r.createdProduct).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/price|lineTotal|unitPrice|amount|₪/i);
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, l1));
    expect(l?.productId).toBe(pepper);
    const [alias] = await db
      .select({ confidence: productAliases.confidence })
      .from(productAliases)
      .where(eq(productAliases.supplierNameRaw, 'פלפל אדום חריף'));
    expect(alias?.confidence).toBe('0.999');

    await callerFor(A, 'chef').mapping.answerLink({
      supplierId: A.supplierId,
      rawName: q.sampleDescription,
      productId: pepper,
      revert: r.undoToken!,
    });
    const [back] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, l1));
    expect(back?.productId).toBeNull();
  });

  it('a product that is NOT among the suggestions is refused (FORBIDDEN), nothing linked', async () => {
    await supplierProduct(A, 'פלפל אדום');
    const unrelated = await supplierProduct(A, 'קמח לבן');
    const l1 = await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    await expect(
      callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: unrelated }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, l1));
    expect(l?.productId).toBeNull();
  });

  it('no open question for that name → NOT_FOUND (no alias for arbitrary names)', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    await expect(
      callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.select().from(productAliases).where(eq(productAliases.supplierNameRaw, 'פלפל אדום חריף'))).toEqual([]);
  });

  it("B's supplier or B's product → NOT_FOUND; B's lines untouched", async () => {
    const lineB = await unlinkedInvoiceLine(B, 'שורה של B');
    await expect(
      callerFor(A, 'chef').mapping.answerLink({ supplierId: B.supplierId, rawName: 'שורה של B', productId: A.productId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await unlinkedInvoiceLine(A, 'שורה של A');
    await expect(
      callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'שורה של A', productId: B.productId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, lineB));
    expect(l?.productId).toBeNull();
  });

  it('receiver and bookkeeper → FORBIDDEN', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    for (const role of ['receiver', 'bookkeeper'] as const) {
      await expect(
        callerFor(A, role).mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('HIGH-1: the undo is a signed token — a forged / tampered / other user\'s token is refused, rows stay linked', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    const l1 = await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    const r = await callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper });
    expect(r.undo).toBeNull();
    expect(typeof r.undoToken).toBe('string');
    const [body, sig] = r.undoToken!.split('.');
    // Tamper: add a foreign id to the change set, keep the signature.
    const payload = JSON.parse(Buffer.from(body!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    payload.ch.catalogItemIds.push('00000000-0000-4000-8000-000000000000');
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
    const otherUser = appRouter.createCaller({
      db,
      session: { userId: '11111111-1111-4111-8111-111111111111', restaurantId: A.restaurantId, role: 'chef' },
    } as AppContext);
    for (const attempt of [
      () => callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper, revert: forged }),
      () => callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper, revert: 'garbage' }),
      () => otherUser.mapping.answerLink({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper, revert: r.undoToken! }),
      () => callerFor(A, 'chef').mapping.answerLink({ supplierId: A.supplierId, rawName: 'שם אחר', productId: pepper, revert: r.undoToken! }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, l1));
    expect(l?.productId).toBe(pepper);
  });

  it('HIGH-1: a name-key revert never unlinks a SKU price-list row or a foreign PO line (key filter on every statement)', async () => {
    const pepper = await supplierProduct(A, 'פלפל אדום');
    await unlinkedInvoiceLine(A, 'פלפל אדום חריף');
    const [skuRow] = await db
      .insert(supplierCatalogItems)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, productId: pepper, supplierSku: 'SKU-1', supplierNameRaw: 'פלפל אדום חריף' })
      .returning({ id: supplierCatalogItems.id });
    const [otherPo] = await db
      .insert(poLines)
      .values({ poId: A.poId, productId: pepper, rawDescription: 'מוצר אחר', qtyOrdered: '1', unit: 'kg' })
      .returning({ id: poLines.id });
    const r = await callerFor(A, 'manager').mapping.confirm({ supplierId: A.supplierId, rawName: 'פלפל אדום חריף', productId: pepper });
    await callerFor(A, 'manager').mapping.confirm({
      supplierId: A.supplierId,
      rawName: 'פלפל אדום חריף',
      revert: { ...r.undo!, catalogItemIds: [...r.undo!.catalogItemIds, skuRow!.id], poLineIds: [...r.undo!.poLineIds, otherPo!.id] },
    });
    const [item] = await db.select({ productId: supplierCatalogItems.productId }).from(supplierCatalogItems).where(eq(supplierCatalogItems.id, skuRow!.id));
    expect(item?.productId).toBe(pepper);
    const [po] = await db.select({ productId: poLines.productId }).from(poLines).where(eq(poLines.id, otherPo!.id));
    expect(po?.productId).toBe(pepper);
  });

  it('chef is still FORBIDDEN on mapping.confirm (the immutable rule holds)', async () => {
    await expect(
      callerFor(A, 'chef').mapping.confirm({ supplierId: A.supplierId, rawName: 'x', newProductName: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
