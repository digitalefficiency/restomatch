import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  poLines,
  products,
  purchaseOrders,
  supplierCatalogItems,
  suppliers,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { estimateTotal } from '../orders/totals';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * S5 (ops-ui) regressions for the operations routers: stale PO totals after a
 * line edit, cancelling closed orders, user-fixable catalog file errors, the
 * English display names (0028) and the export period bounds.
 */
const db = createDb(testDbUrl());

let A: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('estimateTotal (agorot-exact)', () => {
  it('rounds each line half-up to the agora and sums integers', () => {
    // 3 × 0.335 = 1.005 → 1.01 (float math alone gives 1.00499…)
    expect(estimateTotal([{ qty: 3, unitPriceExpected: 0.335 }])).toBe('1.01');
    // 0.1 + 0.2 style drift never leaks into the total.
    expect(
      estimateTotal([
        { qty: 1, unitPriceExpected: 0.1 },
        { qty: 1, unitPriceExpected: 0.2 },
      ]),
    ).toBe('0.30');
  });

  it('skips unpriced lines and returns null when nothing is priced', () => {
    expect(estimateTotal([{ qty: 2, unitPriceExpected: null }])).toBeNull();
    expect(
      estimateTotal([
        { qty: '2.5', unitPriceExpected: '10.0000' },
        { qty: 4, unitPriceExpected: null },
      ]),
    ).toBe('25.00');
  });
});

describe('orders: totals follow line edits; cancel guard', () => {
  beforeAll(async () => {
    await resetDb(db);
  });
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  async function draftWithTwoLines() {
    const { poId } = await callerFor(A).orders.createDraft({
      supplierId: A.supplierId,
      lines: [
        { rawDescription: 'עגבניות', qty: 2, unit: 'ק״ג', unitPriceExpected: 10 },
        { rawDescription: 'מלפפונים', qty: 3, unit: 'ק״ג', unitPriceExpected: 5 },
      ],
    });
    const lines = await db.select().from(poLines).where(eq(poLines.poId, poId));
    return { poId, lines };
  }

  async function totalOf(poId: string) {
    const [po] = await db
      .select({ total: purchaseOrders.totalEstimated })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId));
    return po?.total ?? null;
  }

  it('createDraft stores the agorot-exact estimate', async () => {
    const { poId } = await draftWithTwoLines();
    expect(await totalOf(poId)).toBe('35.00');
  });

  it('updateOrderLine recomputes total_estimated (was left stale)', async () => {
    const { poId, lines } = await draftWithTwoLines();
    const first = lines.find((l) => l.rawDescription === 'עגבניות')!;
    const res = await callerFor(A).orders.updateOrderLine({
      lineId: first.id,
      patch: { qtyOrdered: 5 },
    });
    expect(res.totalEstimated).toBe('65.00');
    expect(await totalOf(poId)).toBe('65.00');
  });

  it('deleteOrderLine recomputes total_estimated', async () => {
    const { poId, lines } = await draftWithTwoLines();
    const second = lines.find((l) => l.rawDescription === 'מלפפונים')!;
    await callerFor(A).orders.deleteOrderLine({ lineId: second.id });
    expect(await totalOf(poId)).toBe('20.00');
  });

  it('clearing a line price drops it from the estimate', async () => {
    const { poId, lines } = await draftWithTwoLines();
    const first = lines.find((l) => l.rawDescription === 'עגבניות')!;
    await callerFor(A).orders.updateOrderLine({ lineId: first.id, patch: { unitPriceExpected: null } });
    expect(await totalOf(poId)).toBe('15.00');
  });

  it('cancelOrder refuses a closed or already-cancelled order', async () => {
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, A.poId));
    await expect(callerFor(A).orders.cancelOrder({ poId: A.poId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const { poId } = await draftWithTwoLines();
    await callerFor(A).orders.cancelOrder({ poId });
    await expect(callerFor(A).orders.cancelOrder({ poId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('placeOrder refuses a draft whose lines were all deleted', async () => {
    const { poId, lines } = await draftWithTwoLines();
    for (const l of lines) await callerFor(A).orders.deleteOrderLine({ lineId: l.id });
    expect(await totalOf(poId)).toBeNull();
    await expect(callerFor(A).orders.placeOrder({ poId, channel: 'none' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('orders.get exposes English product + supplier names', async () => {
    await db.update(products).set({ nameEn: 'Tomatoes' }).where(eq(products.id, A.productId));
    await db.update(suppliers).set({ nameEn: 'Supplier A' }).where(eq(suppliers.id, A.supplierId));
    await db.update(poLines).set({ productId: A.productId }).where(eq(poLines.id, A.poLineId));
    const out = await callerFor(A).orders.get({ poId: A.poId });
    expect(out.supplierNameEn).toBe('Supplier A');
    const linked = out.lines.find((l) => l.productId === A.productId);
    expect(linked?.productNameEn).toBe('Tomatoes');
    const list = await callerFor(A).orders.list();
    expect(list.find((o) => o.id === A.poId)?.supplierNameEn).toBe('Supplier A');
  });
});

describe('English display names (0028)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('products.update sets and clears name_en; productDetail returns it', async () => {
    const caller = callerFor(A);
    await caller.products.update({ productId: A.productId, patch: { nameEn: '  Tomatoes  ' } });
    let detail = await caller.catalog.productDetail({ productId: A.productId });
    expect(detail?.product.nameEn).toBe('Tomatoes');
    await caller.products.update({ productId: A.productId, patch: { nameEn: '' } });
    detail = await caller.catalog.productDetail({ productId: A.productId });
    expect(detail?.product.nameEn).toBeNull();
  });

  it('products.update nameEn is manager-only', async () => {
    await expect(
      callerFor(A, 'receiver').products.update({ productId: A.productId, patch: { nameEn: 'X' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('suppliers.create / update carry name_en', async () => {
    const caller = callerFor(A);
    const created = await caller.suppliers.create({ name: 'ירקות השרון', nameEn: 'Sharon Produce' });
    expect(created.nameEn).toBe('Sharon Produce');
    const updated = await caller.suppliers.update({
      supplierId: created.id,
      patch: { nameEn: null },
    });
    expect(updated.nameEn).toBeNull();
    const untouched = await caller.suppliers.update({
      supplierId: created.id,
      patch: { paymentTerms: 'שוטף + 30' },
    });
    expect(untouched.name).toBe('ירקות השרון');
  });

  it('catalog.items returns + searches the English product name', async () => {
    await db.update(products).set({ nameEn: 'Cherry tomatoes' }).where(eq(products.id, A.productId));
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierNameRaw: 'עגבניות שרי ארוז',
      supplierSku: 'SKU-1',
      listPrice: '12.50',
    });
    const hits = await callerFor(A).catalog.items({ search: 'cherry' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.productNameEn).toBe('Cherry tomatoes');
  });

  it('search.global matches + returns English names', async () => {
    await db.update(products).set({ nameEn: 'Tomato' }).where(eq(products.id, A.productId));
    await db.update(suppliers).set({ nameEn: 'Green Fields' }).where(eq(suppliers.id, A.supplierId));
    const p = await callerFor(A).search.global({ q: 'tomato' });
    expect(p.products.map((x) => x.nameEn)).toContain('Tomato');
    const s = await callerFor(A).search.global({ q: 'green' });
    expect(s.suppliers.map((x) => x.id)).toContain(A.supplierId);
  });
});

describe('catalog import: user-fixable file errors are BAD_REQUEST with a stable code', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  const b64 = (bytes: number[] | string) =>
    Buffer.from(typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)).toString('base64');

  it('legacy .xls → CATALOG_FILE_LEGACY_XLS', async () => {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0];
    await expect(
      callerFor(A).catalog.parsePreview({
        supplierId: A.supplierId,
        file: { filename: 'prices.xls', base64: b64(ole) },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_FILE_LEGACY_XLS/) });
  });

  it('a non-workbook renamed .xlsx → CATALOG_FILE_UNREADABLE', async () => {
    await expect(
      callerFor(A).catalog.parsePreview({
        supplierId: A.supplierId,
        file: { filename: 'prices.xlsx', base64: b64('not a spreadsheet at all') },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_FILE_UNREADABLE/) });
  });

  it('a corrupt zip → CATALOG_FILE_UNREADABLE (not a 500)', async () => {
    await expect(
      callerFor(A).catalog.parsePreview({
        supplierId: A.supplierId,
        file: { filename: 'prices.xlsx', base64: b64([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]) },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_FILE_UNREADABLE/) });
  });

  it('an empty CSV → CATALOG_FILE_EMPTY', async () => {
    await expect(
      callerFor(A).catalog.parsePreview({
        supplierId: A.supplierId,
        file: { filename: 'empty.csv', text: '\n\n' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_FILE_EMPTY/) });
  });

  it('commitImport without a name mapping, or with no named rows, is rejected', async () => {
    const file = { filename: 'p.csv', text: 'תיאור,מחיר\n,5\n' };
    await expect(
      callerFor(A).catalog.commitImport({ supplierId: A.supplierId, file, mapping: { price: 'מחיר' } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_MAPPING_NAME/) });
    await expect(
      callerFor(A).catalog.commitImport({
        supplierId: A.supplierId,
        file,
        mapping: { name: 'תיאור', price: 'מחיר' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_FILE_NO_ROWS/) });
  });

  it('a valid Hebrew CSV still previews + commits', async () => {
    const text = '﻿מק"ט,תיאור,יחידה,מחיר\nT-1,עגבניה שרי,ק"ג,"1,234.50"\nT-2,מלפפון,ק"ג,₪6.90\n';
    const preview = await callerFor(A).catalog.parsePreview({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text },
    });
    expect(preview.rowCount).toBe(2);
    expect(preview.mapping).toMatchObject({ sku: 'מק"ט', name: 'תיאור', unit: 'יחידה', price: 'מחיר' });
    const res = await callerFor(A).catalog.commitImport({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text },
      mapping: preview.mapping,
    });
    expect(res).toMatchObject({ queued: false, rowCount: 2, created: 2 });
    const items = await callerFor(A).catalog.items({ supplierId: A.supplierId, search: 'T-1' });
    expect(items[0]?.listPrice).toBe('1234.5000');
  });
});

describe('exports: Israel-time calendar days + every checked invoice', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  async function setInvoice(status: 'approved' | 'disputed' | 'parsed', at: string) {
    await db
      .update(invoices)
      .set({ status, invoiceDate: new Date(at) })
      .where(eq(invoices.id, A.invoiceId));
  }

  it('includes an invoice late on the last day (22:30 Israel time)', async () => {
    await setInvoice('approved', '2026-10-31T20:30:00.000Z'); // 31 Oct 22:30 IST (UTC+2)
    const out = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(out.rowCount).toBe(1);
  });

  it('an invoice at 00:30 Israel time on the 1st belongs to that month (was: previous month in UTC)', async () => {
    await setInvoice('approved', '2026-09-30T21:30:00.000Z'); // 1 Oct 00:30 IDT (UTC+3)
    const oct = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    const sep = await callerFor(A).exports.invoicesCsv({ from: '2026-09-01', to: '2026-09-30' });
    expect(oct.rowCount).toBe(1);
    expect(sep.rowCount).toBe(0);
    // The printed date is the Israel calendar day too.
    expect(oct.content).toContain('2026-10-01');
    expect(oct.content).not.toContain('2026-09-30');
  });

  it('includes disputed invoices (real purchases) but not unverified ones', async () => {
    await setInvoice('disputed', '2026-10-10T08:00:00.000Z');
    const out = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(out.rowCount).toBe(1);
    expect(out.content).toContain('disputed');
    const u = await callerFor(A).exports.uniform1000({ from: '2026-10-01', to: '2026-10-31' });
    expect(u.rowCount).toBe(1);

    await setInvoice('parsed', '2026-10-10T08:00:00.000Z');
    const none = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(none.rowCount).toBe(0);
  });

  /** A disputed invoice whose match run carries one discrepancy of `type`. */
  async function disputedWith(
    invoiceNumber: string,
    type: 'DUPLICATE_INVOICE' | 'PRICE_HIGHER',
    resolutionStatus: 'open' | 'accepted' | 'rejected' = 'open',
    invoiceDate: Date | null = new Date('2026-10-12T08:00:00.000Z'),
  ) {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber,
        invoiceDate,
        createdAt: new Date('2026-10-12T08:00:00.000Z'),
        totalExclVat: '100.00',
        vatAmount: '18.00',
        totalInclVat: '118.00',
        status: 'disputed',
        source: 'photo',
        createdBy: A.ownerUserId,
      })
      .returning({ id: invoices.id });
    const [mr] = await db
      .insert(matchRuns)
      .values({
        restaurantId: A.restaurantId,
        invoiceId: inv!.id,
        overallStatus: 'major',
        totalDiscrepancyAmount: '118.00',
      })
      .returning({ id: matchRuns.id });
    await db.insert(discrepancies).values({
      restaurantId: A.restaurantId,
      matchRunId: mr!.id,
      type,
      severity: 'block',
      deltaAmount: '118.00',
      requiresRole: 'owner',
      resolutionStatus,
    });
    return inv!.id;
  }

  it('EXP-DUP-1: a flagged duplicate is not booked twice; other disputes still export', async () => {
    await setInvoice('approved', '2026-10-12T08:00:00.000Z'); // the original
    await disputedWith('DUP-OPEN', 'DUPLICATE_INVOICE', 'open');
    // Approvals "Approve" = accepted = "yes, a duplicate — claim it".
    await disputedWith('DUP-CLAIMED', 'DUPLICATE_INVOICE', 'accepted');
    await disputedWith('PRICE-DISPUTE', 'PRICE_HIGHER', 'open');
    // Approvals "Reject" = rejected = waived: "not a duplicate", a real purchase.
    await disputedWith('DUP-WAIVED', 'DUPLICATE_INVOICE', 'rejected');

    const csv = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(csv.rowCount).toBe(3);
    expect(csv.content).toContain('PRICE-DISPUTE');
    expect(csv.content).toContain('DUP-WAIVED');
    expect(csv.content).not.toContain('DUP-OPEN');
    expect(csv.content).not.toContain('DUP-CLAIMED');

    const u = await callerFor(A).exports.uniform1000({ from: '2026-10-01', to: '2026-10-31' });
    expect(u.rowCount).toBe(3);
    expect(u.content).not.toContain('DUP-OPEN');
  });

  it('only the latest match run counts: a re-match that clears the duplicate flag exports it', async () => {
    const id = await disputedWith('DUP-FIXED', 'DUPLICATE_INVOICE', 'open');
    const before = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(before.content).not.toContain('DUP-FIXED');
    // Manager fixed the misread number and re-ran the match: clean run, later.
    await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, id));
    await db.insert(matchRuns).values({
      restaurantId: A.restaurantId,
      invoiceId: id,
      overallStatus: 'clean',
      runAt: new Date(Date.now() + 60_000),
    });
    const after = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(after.content).toContain('DUP-FIXED');
  });

  it('counts checked invoices with no invoice date so the UI can warn', async () => {
    await disputedWith('NO-DATE', 'PRICE_HIGHER', 'open', null);
    await disputedWith('NO-DATE-DUP', 'DUPLICATE_INVOICE', 'open', null);
    const csv = await callerFor(A).exports.invoicesCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(csv.content).not.toContain('NO-DATE');
    expect(csv.undatedCount).toBe(1); // the duplicate copy isn't counted either
    const sep = await callerFor(A).exports.invoicesCsv({ from: '2026-09-01', to: '2026-09-30' });
    expect(sep.undatedCount).toBe(0);
  });
});

describe('bulk English names + import history (follow-up)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  async function addProduct(name: string, nameEn: string | null = null) {
    const [p] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, canonicalName: name, nameEn })
      .returning({ id: products.id });
    return p!.id;
  }

  it('products.list filters missing English names and searches both languages', async () => {
    await addProduct('מלפפון', 'Cucumber');
    await addProduct('בצל', '  ');
    const all = await callerFor(A).products.list();
    expect(all.total).toBe(3);
    const missing = await callerFor(A).products.list({ missingOnly: true });
    expect(missing.rows.map((r) => r.canonicalName).sort()).toEqual(['בצל', 'עגבניה A'].sort());
    expect(missing.total).toBe(2);
    const en = await callerFor(A).products.list({ search: 'cucu' });
    expect(en.rows.map((r) => r.canonicalName)).toEqual(['מלפפון']);
  });

  it('products.setNamesEn saves a batch, trims, and clears blanks', async () => {
    const cucumber = await addProduct('מלפפון', 'Old');
    const res = await callerFor(A).products.setNamesEn({
      items: [
        { productId: A.productId, nameEn: '  Tomato ' },
        { productId: cucumber, nameEn: '' },
      ],
    });
    expect(res.updated).toBe(2);
    const rows = await db
      .select({ id: products.id, nameEn: products.nameEn })
      .from(products)
      .where(eq(products.restaurantId, A.restaurantId));
    const byId = new Map(rows.map((r) => [r.id, r.nameEn]));
    expect(byId.get(A.productId)).toBe('Tomato');
    expect(byId.get(cucumber)).toBeNull();
  });

  it('products.setNamesEn is manager-only and rejects duplicate ids', async () => {
    await expect(
      callerFor(A, 'receiver').products.setNamesEn({ items: [{ productId: A.productId, nameEn: 'x' }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callerFor(A).products.setNamesEn({
        items: [
          { productId: A.productId, nameEn: 'x' },
          { productId: A.productId, nameEn: 'y' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('catalog.imports lists a supplier’s imports newest first, incl. failures', async () => {
    const caller = callerFor(A);
    await caller.catalog.commitImport({
      supplierId: A.supplierId,
      file: { filename: 'first.csv', text: 'תיאור,מחיר\nעגבניה,5\n' },
      mapping: { name: 'תיאור', price: 'מחיר' },
    });
    await caller.catalog.commitImport({
      supplierId: A.supplierId,
      file: { filename: 'second.csv', text: 'תיאור,מחיר\nמלפפון,4\nבצל,3\n' },
      mapping: { name: 'תיאור', price: 'מחיר' },
    });
    const list = await caller.catalog.imports({ supplierId: A.supplierId });
    expect(list.map((i) => i.filename)).toEqual(['second.csv', 'first.csv']);
    expect(list[0]).toMatchObject({ status: 'committed', rowCount: 2, createdItems: 2 });
  });
});
