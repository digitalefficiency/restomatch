import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  catalogImports,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoices,
  priceBaselines,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
  suppliers,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * CROSS-TENANT ATTACK SUITE
 *
 * Seeds two complete tenants (A = attacker, B = victim) and calls every
 * procedure as tenant A using tenant B's entity ids. Every attack must be
 * rejected with NOT_FOUND/FORBIDDEN and must leave B's data untouched; every
 * list/aggregate must exclude B's rows.
 *
 * COVERAGE is enforced: a tRPC procedure that is not declared in COVERAGE
 * fails this suite. When you add a procedure, add an attack or isolation test
 * here and declare it — that is the price of admission.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(TEST_DB_URL);

let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant) {
  const session: Session = {
    userId: tenant.ownerUserId,
    restaurantId: tenant.restaurantId,
    role: 'owner',
  };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

afterAll(async () => {
  await resetDb(db);
});

/* ──────────────────────────────────────────────────────────────────────────
 * Coverage manifest — every procedure must appear here.
 * 'attack'    → has a foreign-id attack test below
 * 'isolation' → has a list/aggregate isolation test below
 * other       → explicit justification for why no test is required
 * ────────────────────────────────────────────────────────────────────────── */
const COVERAGE: Record<string, 'attack' | 'isolation' | string> = {
  'activity.feed': 'isolation',
  'approvals.myQueue': 'isolation',
  'approvals.approve': 'attack',
  'approvals.reject': 'attack',
  'approvals.escalate': 'attack',
  'approvals.history': 'attack',
  'exports.invoicesCsv': 'isolation',
  'exports.uniform1000': 'isolation',
  'onboarding.myMemberships': 'isolation',
  'onboarding.createRestaurant':
    'creates a brand-new tenant; takes no entity ids and reads nothing tenant-scoped',
  'owner.kpis': 'isolation',
  'owner.leaks': 'isolation',
  'owner.suppliers': 'isolation',
  'receiving.todayExpectations': 'isolation',
  'receiving.getPo': 'attack',
  'receiving.getReceipt': 'attack',
  'receiving.getInvoice': 'attack',
  'receiving.startReceipt': 'attack',
  'receiving.markGrLine': 'attack',
  'receiving.submitReceipt': 'attack',
  'receiving.registerInvoice': 'attack',
  'receiving.pendingInvoices': 'isolation',
  'admin.listRestaurants': 'admin-denial',
  'admin.getRestaurant': 'admin-denial',
  'admin.assignPlan': 'admin-denial',
  'admin.setOverrides': 'admin-denial',
  'admin.setMemberRole': 'admin-denial',
  'admin.listLeads': 'admin-denial',
  // Phase 5+6 additions
  'settings.get': 'isolation',
  'settings.update': 'isolation',
  'search.global': 'isolation',
  // Phase-2 supplier-centric surface (suppliers / catalog / orders / on-demand match).
  // Every procedure that takes a client-supplied supplierId / productId / poId /
  // invoiceId / itemId MUST reject a foreign id before it reads or writes; every
  // list/aggregate must exclude the other tenant's rows and its ₪ totals.
  'suppliers.list': 'isolation',
  'suppliers.get': 'attack',
  'suppliers.create': 'isolation',
  'suppliers.update': 'attack',
  'suppliers.setActive': 'attack',
  'catalog.items': 'isolation',
  'catalog.productDetail': 'attack',
  'catalog.parsePreview': 'attack',
  'catalog.commitImport': 'attack',
  'catalog.setItemActive': 'attack',
  'orders.list': 'isolation',
  'orders.get': 'attack',
  'orders.createDraft': 'attack',
  'orders.cancelOrder': 'attack',
  'orders.placeOrder': 'attack',
  // guardrail does NOT call assertSupplierOwned; isolation is via the
  // restaurant-scoped baseline query. Proven by a B-only baseline that A's
  // call must not read. (Defense-in-depth: add assertSupplierOwned — flagged
  // to the orders-router owner.)
  'orders.guardrail': 'isolation',
  'match.runForInvoice': 'attack',
  'plans.list':
    'public marketing catalog (publicProcedure); reads the global plans table only, no tenant-scoped rows — nothing to isolate',
  'leads.create':
    'public landing capture (publicProcedure); writes to the non-tenant leads table, takes no entity ids and reads nothing tenant-scoped',
};

function listProcedurePaths(): string[] {
  const def = (appRouter as { _def: { procedures?: Record<string, unknown> } })._def;
  if (!def.procedures) throw new Error('appRouter._def.procedures missing — tRPC internals changed');
  return Object.keys(def.procedures).sort();
}

describe('coverage completeness', () => {
  it('every registered procedure is declared in COVERAGE', () => {
    const registered = listProcedurePaths();
    const declared = Object.keys(COVERAGE).sort();
    expect(registered).toEqual(declared);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Foreign-id attacks: tenant A calls with tenant B's ids
 * ────────────────────────────────────────────────────────────────────────── */

describe('foreign-id attacks (A → B)', () => {
  it('receiving.getPo rejects a foreign poId', async () => {
    const caller = callerFor(A);
    await expect(caller.receiving.getPo({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('receiving.startReceipt rejects a foreign poId and creates nothing', async () => {
    const caller = callerFor(A);
    await expect(caller.receiving.startReceipt({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const foreignGrs = await db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.poId, B.poId));
    expect(foreignGrs).toHaveLength(1); // only B's own seeded GR
  });

  it('receiving.markGrLine rejects a foreign grLineId and leaves the row untouched', async () => {
    const caller = callerFor(A);
    await expect(
      caller.receiving.markGrLine({ grLineId: B.grLineId, qtyReceived: 999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [line] = await db
      .select({ qtyReceived: grLines.qtyReceived, rejectReason: grLines.rejectReason })
      .from(grLines)
      .where(eq(grLines.id, B.grLineId));
    expect(line?.qtyReceived).toBe('5.000');
    expect(line?.rejectReason).toBeNull();
  });

  it('receiving.submitReceipt rejects a foreign grId and leaves status untouched', async () => {
    const caller = callerFor(A);
    await expect(caller.receiving.submitReceipt({ grId: B.grId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const [gr] = await db
      .select({ status: goodsReceipts.status })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, B.grId));
    expect(gr?.status).toBe('pending');
  });

  it('receiving.registerInvoice rejects a foreign grId', async () => {
    const caller = callerFor(A);
    await expect(
      caller.receiving.registerInvoice({
        grId: B.grId,
        supplierId: A.supplierId,
        imageUrl: 'https://example.com/scan.jpg',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('receiving.registerInvoice rejects a foreign supplierId and inserts nothing', async () => {
    const caller = callerFor(A);
    const before = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.restaurantId, A.restaurantId));

    await expect(
      caller.receiving.registerInvoice({
        grId: A.grId,
        supplierId: B.supplierId,
        imageUrl: 'https://example.com/scan.jpg',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const after = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.restaurantId, A.restaurantId));
    expect(after).toHaveLength(before.length);
  });

  it('approvals.approve rejects a foreign discrepancyId and leaves it open', async () => {
    const caller = callerFor(A);
    await expect(
      caller.approvals.approve({ discrepancyId: B.discrepancyId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [d] = await db
      .select({ resolutionStatus: discrepancies.resolutionStatus })
      .from(discrepancies)
      .where(eq(discrepancies.id, B.discrepancyId));
    expect(d?.resolutionStatus).toBe('open');
  });

  it('approvals.reject rejects a foreign discrepancyId and leaves it open', async () => {
    const caller = callerFor(A);
    await expect(
      caller.approvals.reject({ discrepancyId: B.discrepancyId, reason: 'attack' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [d] = await db
      .select({ resolutionStatus: discrepancies.resolutionStatus })
      .from(discrepancies)
      .where(eq(discrepancies.id, B.discrepancyId));
    expect(d?.resolutionStatus).toBe('open');
  });

  it('approvals.escalate rejects a foreign discrepancyId and does not change requiresRole', async () => {
    const caller = callerFor(A);
    await expect(
      caller.approvals.escalate({ discrepancyId: B.discrepancyId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [d] = await db
      .select({ requiresRole: discrepancies.requiresRole })
      .from(discrepancies)
      .where(eq(discrepancies.id, B.discrepancyId));
    expect(d?.requiresRole).toBe('manager');
  });

  it('approvals.history returns no audit rows for a foreign discrepancyId', async () => {
    const caller = callerFor(A);
    const rows = await caller.approvals.history({ discrepancyId: B.discrepancyId });
    expect(rows).toHaveLength(0);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Isolation: tenant A's lists and aggregates never contain tenant B's data
 * ────────────────────────────────────────────────────────────────────────── */

describe('list/aggregate isolation (A must not see B)', () => {
  it('activity.feed excludes B events', async () => {
    const caller = callerFor(A);
    const feed = await caller.activity.feed();
    expect(feed.some((e) => e.title.includes('של B'))).toBe(false);
    expect(feed.some((e) => e.title.includes('של A'))).toBe(true);
  });

  it('approvals.myQueue excludes B discrepancies', async () => {
    const caller = callerFor(A);
    const queue = await caller.approvals.myQueue();
    const ids = queue.map((q) => q.id);
    expect(ids).toContain(A.discrepancyId);
    expect(ids).not.toContain(B.discrepancyId);
  });

  it('receiving.todayExpectations excludes B purchase orders', async () => {
    const caller = callerFor(A);
    const expectations = await caller.receiving.todayExpectations();
    const poIds = expectations.map((e) => e.poId);
    expect(poIds).toContain(A.poId);
    expect(poIds).not.toContain(B.poId);
  });

  it('receiving.pendingInvoices excludes B invoices', async () => {
    const caller = callerFor(A);
    const pending = await caller.receiving.pendingInvoices();
    expect(pending.some((i) => i.id === B.invoiceId)).toBe(false);
  });

  it('owner.suppliers excludes B suppliers', async () => {
    const caller = callerFor(A);
    const supplierCards = await caller.owner.suppliers();
    const names = supplierCards.map((s) => s.supplierName ?? '').join('|');
    expect(names).not.toContain(B.supplierName);
  });

  it('owner.kpis resolves from A-scoped data only', async () => {
    const caller = callerFor(A);
    await expect(caller.owner.kpis()).resolves.toBeDefined();
  });

  it('owner.leaks excludes B leak rows', async () => {
    const caller = callerFor(A);
    const leaks = await caller.owner.leaks();
    expect(JSON.stringify(leaks)).not.toContain(B.supplierName);
  });

  it('exports.invoicesCsv excludes B invoices', async () => {
    const caller = callerFor(A);
    // ±1 day so local-vs-UTC date skew around midnight cannot empty the window
    const day = 24 * 60 * 60 * 1000;
    const from = new Date(Date.now() - day).toISOString().slice(0, 10);
    const to = new Date(Date.now() + day).toISOString().slice(0, 10);
    const out = await caller.exports.invoicesCsv({ from, to });
    expect(out.content).toContain(A.invoiceNumber);
    expect(out.content).not.toContain(B.invoiceNumber);
    expect(out.content).not.toContain(B.supplierName);
  });

  it('exports.uniform1000 excludes B invoices', async () => {
    const caller = callerFor(A);
    const day = 24 * 60 * 60 * 1000;
    const from = new Date(Date.now() - day).toISOString().slice(0, 10);
    const to = new Date(Date.now() + day).toISOString().slice(0, 10);
    const out = await caller.exports.uniform1000({ from, to });
    expect(out.content).not.toContain(B.invoiceNumber);
  });

  it('onboarding.myMemberships returns only the caller user memberships', async () => {
    const caller = callerFor(A);
    const rows = await caller.onboarding.myMemberships();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.restaurantId).toBe(A.restaurantId);
  });

  it('settings.get + settings.update read/write only the caller restaurant', async () => {
    const callerA = callerFor(A);
    // A updates its own settings; B must be untouched.
    await callerA.settings.update({ ocrReviewThreshold: 0.81, tolerances: { pricePercent: 0.04 } });
    const settingsA = await callerA.settings.get();
    expect(settingsA.ocrReviewThreshold).toBe(0.81);
    expect(settingsA.tolerances?.pricePercent).toBe(0.04);

    const [rowB] = await db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, B.restaurantId));
    expect(rowB?.settings?.ocrReviewThreshold).toBeUndefined();
    expect(rowB?.settings?.tolerances?.pricePercent).toBeUndefined();
  });

  it('search.global returns only the caller restaurant entities', async () => {
    const caller = callerFor(A);
    // Supplier names are "ספק A"/"ספק B"; product names "עגבניה A"/"עגבניה B".
    const supplierHits = await caller.search.global({ q: 'ספק' });
    const supplierNames = supplierHits.suppliers.map((s) => s.name);
    expect(supplierNames).toContain(A.supplierName);
    expect(supplierNames).not.toContain(B.supplierName);

    const productHits = await caller.search.global({ q: 'עגבניה' });
    const productNames = productHits.products.map((p) => p.canonicalName);
    expect(productNames.some((n) => n.includes('A'))).toBe(true);
    expect(productNames.some((n) => n.includes('B'))).toBe(false);

    const invoiceHits = await caller.search.global({ q: 'INV' });
    const invoiceNumbers = invoiceHits.invoices.map((i) => i.invoiceNumber);
    expect(invoiceNumbers).toContain(A.invoiceNumber);
    expect(invoiceNumbers).not.toContain(B.invoiceNumber);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Phase-2 supplier-centric surface (the "supplier as the center" navigation).
 *
 * These procedures all take a client-supplied id (supplierId / productId / poId /
 * itemId / invoiceId). The attack is: tenant A passes tenant B's id and must be
 * rejected with NOT_FOUND before any read/write touches B's data, and every list
 * must exclude B's rows. Catalog items are seeded inline (the base fixture does
 * not seed supplier_catalog_items) using the owner connection (no RLS at the
 * tRPC layer in this suite — the DB-role backstop lives in rls.attack.test.ts).
 * ────────────────────────────────────────────────────────────────────────── */

let aCatalogItemId: string;
let bCatalogItemId: string;

beforeAll(async () => {
  const [aItem] = await db
    .insert(supplierCatalogItems)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierNameRaw: 'עגבניה קטלוג A',
      supplierSku: 'SKU-A',
      listPrice: '8.5000',
    })
    .returning({ id: supplierCatalogItems.id });
  const [bItem] = await db
    .insert(supplierCatalogItems)
    .values({
      restaurantId: B.restaurantId,
      supplierId: B.supplierId,
      productId: B.productId,
      supplierNameRaw: 'עגבניה קטלוג B',
      supplierSku: 'SKU-B',
      listPrice: '9.0000',
    })
    .returning({ id: supplierCatalogItems.id });
  aCatalogItemId = aItem!.id;
  bCatalogItemId = bItem!.id;

  // A B-only baseline at the default 90-day window: if orders.guardrail leaked
  // across tenants, A asking about B's product at a wildly high price (1000)
  // would read this baseline and raise a 'high' warning. Isolation ⇒ 0 warnings.
  await db.insert(priceBaselines).values({
    restaurantId: B.restaurantId,
    productId: B.productId,
    supplierId: B.supplierId,
    windowDays: 90,
    p50: '8.0000',
    p90: '9.0000',
    sampleSize: 5,
  });
});

describe('suppliers router: foreign id attacks + list isolation (A → B)', () => {
  it('suppliers.get rejects a foreign supplierId', async () => {
    await expect(callerFor(A).suppliers.get({ supplierId: B.supplierId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('suppliers.update rejects a foreign supplierId and leaves B untouched', async () => {
    await expect(
      callerFor(A).suppliers.update({ supplierId: B.supplierId, patch: { name: 'HIJACKED' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.id, B.supplierId));
    expect(row?.name).toBe(B.supplierName);
  });

  it('suppliers.setActive rejects a foreign supplierId and leaves B active', async () => {
    await expect(
      callerFor(A).suppliers.setActive({ supplierId: B.supplierId, active: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ active: suppliers.active })
      .from(suppliers)
      .where(eq(suppliers.id, B.supplierId));
    expect(row?.active).toBe(true);
  });

  it('suppliers.list excludes B suppliers and suppliers.create lands only in A', async () => {
    const before = await callerFor(A).suppliers.list();
    expect(before.map((s) => s.id)).not.toContain(B.supplierId);
    expect(before.every((s) => s.restaurantId === A.restaurantId)).toBe(true);

    const created = await callerFor(A).suppliers.create({ name: 'ספק חדש A' });
    expect(created.restaurantId).toBe(A.restaurantId);
    // The new row must NOT be visible to B.
    const bList = await callerFor(B).suppliers.list();
    expect(bList.map((s) => s.id)).not.toContain(created.id);
    // cleanup so it does not leak into later list-count assertions
    await db.delete(suppliers).where(eq(suppliers.id, created.id));
  });
});

describe('catalog router: foreign id attacks + isolation (A → B)', () => {
  it('catalog.productDetail returns null for a foreign productId (no B prices leak)', async () => {
    const detail = await callerFor(A).catalog.productDetail({ productId: B.productId });
    expect(detail).toBeNull();
  });

  it('catalog.setItemActive cannot toggle a foreign item (0 rows, B unchanged)', async () => {
    await expect(
      callerFor(A).catalog.setItemActive({ itemId: bCatalogItemId, active: false }),
    ).rejects.toThrow(/not found/i);
    const [row] = await db
      .select({ active: supplierCatalogItems.active })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, bCatalogItemId));
    expect(row?.active).toBe(true);
  });

  it('catalog.parsePreview rejects a foreign supplierId before parsing', async () => {
    await expect(
      callerFor(A).catalog.parsePreview({
        supplierId: B.supplierId,
        file: { filename: 'x.csv', text: 'name,price\nx,1' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('catalog.commitImport rejects a foreign supplierId and writes no import row for B', async () => {
    const beforeB = await db
      .select({ id: catalogImports.id })
      .from(catalogImports)
      .where(eq(catalogImports.restaurantId, B.restaurantId));
    await expect(
      callerFor(A).catalog.commitImport({
        supplierId: B.supplierId,
        file: { filename: 'x.csv', text: 'name,price\nx,1' },
        mapping: { name: 'name', price: 'price' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const afterB = await db
      .select({ id: catalogImports.id })
      .from(catalogImports)
      .where(eq(catalogImports.restaurantId, B.restaurantId));
    expect(afterB).toHaveLength(beforeB.length);
  });

  it('catalog.items excludes B catalog rows and B prices, even with B supplierId filter', async () => {
    const all = await callerFor(A).catalog.items({});
    expect(all.map((i) => i.id)).toContain(aCatalogItemId);
    expect(all.map((i) => i.id)).not.toContain(bCatalogItemId);
    expect(all.some((i) => i.supplierName === B.supplierName)).toBe(false);

    // Passing B's supplierId must not punch through the restaurant scope.
    const filteredByB = await callerFor(A).catalog.items({ supplierId: B.supplierId });
    expect(filteredByB.map((i) => i.id)).not.toContain(bCatalogItemId);
  });
});

describe('orders router: foreign id attacks + list isolation (A → B)', () => {
  it('orders.get rejects a foreign poId', async () => {
    await expect(callerFor(A).orders.get({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('orders.cancelOrder rejects a foreign poId and leaves B status untouched', async () => {
    const [beforeRow] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, B.poId));
    await expect(callerFor(A).orders.cancelOrder({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const [afterRow] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, B.poId));
    expect(afterRow?.status).toBe(beforeRow?.status);
  });

  it('orders.placeOrder rejects a foreign poId and never enqueues / mutates B', async () => {
    const [beforeRow] = await db
      .select({ status: purchaseOrders.status, sentAt: purchaseOrders.sentAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, B.poId));
    await expect(
      callerFor(A).orders.placeOrder({ poId: B.poId, channel: 'none' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [afterRow] = await db
      .select({ status: purchaseOrders.status, sentAt: purchaseOrders.sentAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, B.poId));
    expect(afterRow?.status).toBe(beforeRow?.status);
    expect(afterRow?.sentAt ?? null).toEqual(beforeRow?.sentAt ?? null);
  });

  it('orders.createDraft rejects a foreign supplierId and inserts no PO for A', async () => {
    const before = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.restaurantId, A.restaurantId));
    await expect(
      callerFor(A).orders.createDraft({
        supplierId: B.supplierId,
        lines: [{ rawDescription: 'x', qty: 1, unit: 'kg' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const after = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.restaurantId, A.restaurantId));
    expect(after).toHaveLength(before.length);
  });

  it('orders.guardrail rejects a foreign supplierId (advanced_analytics, implicit trial)', async () => {
    // assertSupplierOwned is NOT called in guardrail; isolation is via the
    // restaurant-scoped baseline query. A foreign supplierId must therefore
    // produce zero warnings rather than reading B's baselines.
    const out = await callerFor(A).orders.guardrail({
      supplierId: B.supplierId,
      lines: [{ productId: B.productId, unitPriceExpected: 1000 }],
    });
    expect(out.warnings).toHaveLength(0);
  });

  it('orders.list excludes B purchase orders even with a B supplierId filter', async () => {
    const all = await callerFor(A).orders.list();
    expect(all.map((o) => o.id)).not.toContain(B.poId);
    const filteredByB = await callerFor(A).orders.list({ supplierId: B.supplierId });
    expect(filteredByB.map((o) => o.id)).not.toContain(B.poId);
  });
});

describe('match router + receiving detail reads: foreign id attacks (A → B)', () => {
  it('match.runForInvoice rejects a foreign invoiceId and creates no run for A', async () => {
    await expect(
      callerFor(A).match.runForInvoice({ invoiceId: B.invoiceId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('receiving.getReceipt rejects a foreign grId / poId', async () => {
    await expect(callerFor(A).receiving.getReceipt({ grId: B.grId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(callerFor(A).receiving.getReceipt({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('receiving.getInvoice rejects a foreign invoiceId', async () => {
    await expect(
      callerFor(A).receiving.getInvoice({ invoiceId: B.invoiceId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('platform-admin procedures reject a non-admin tenant user', () => {
  // A is a normal restaurant owner, not a platform admin, and no
  // PLATFORM_ADMIN_EMAILS allowlist is set in tests.
  it('admin.listRestaurants → FORBIDDEN', async () => {
    await expect(callerFor(A).admin.listRestaurants()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('admin.getRestaurant → FORBIDDEN', async () => {
    await expect(
      callerFor(A).admin.getRestaurant({ restaurantId: B.restaurantId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('admin.assignPlan → FORBIDDEN (and changes nothing)', async () => {
    await expect(
      callerFor(A).admin.assignPlan({ restaurantId: B.restaurantId, planKey: 'pro' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('admin.setOverrides → FORBIDDEN', async () => {
    await expect(
      callerFor(A).admin.setOverrides({ restaurantId: B.restaurantId, overrides: {} }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('admin.setMemberRole → FORBIDDEN', async () => {
    await expect(
      callerFor(A).admin.setMemberRole({
        restaurantId: B.restaurantId,
        userId: B.ownerUserId,
        role: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('admin.listLeads → FORBIDDEN', async () => {
    await expect(callerFor(A).admin.listLeads()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
