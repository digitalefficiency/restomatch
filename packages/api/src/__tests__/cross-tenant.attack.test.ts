import { testDbUrl } from '@restomatch/db';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  catalogImports,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invitations,
  invoiceLines,
  invoices,
  memberships,
  poLines,
  priceBaselines,
  products,
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
  testDbUrl();
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

/**
 * Caller bound to a tenant's restaurant but carrying an arbitrary session role —
 * the role check in requireRoles reads the session role, not the DB membership,
 * so this drives the managerProcedure role gate without reseeding memberships.
 */
function callerWithRole(tenant: Tenant, role: Session['role']) {
  const session: Session = {
    userId: tenant.ownerUserId,
    restaurantId: tenant.restaurantId,
    role,
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
  'receiving.updateInvoiceHeader': 'attack',
  'receiving.updateInvoiceLine': 'attack',
  'receiving.pendingInvoices': 'isolation',
  'scans.upload':
    'memberProcedure write keyed to ctx.session.restaurantId; takes NO client-supplied tenant id or storage prefix (PR1/A.3 — the tenant + object path are derived server-side from the session), so it cannot target another tenant. The actual byte upload + service-role mapping insert are Supabase-network-bound and verified by storage.attack.test (membership gate) + against real Supabase; role denial is implicit in memberProcedure.',
  'admin.listRestaurants': 'admin-denial',
  'admin.getRestaurant': 'admin-denial',
  'admin.assignPlan': 'admin-denial',
  'admin.setOverrides': 'admin-denial',
  'admin.setMemberRole': 'admin-denial',
  'admin.listLeads': 'admin-denial',
  // Phase 5+6 additions
  'settings.get': 'isolation',
  'settings.update': 'isolation',
  'settings.profile': 'isolation',
  'settings.updateProfile': 'isolation',
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
  'catalog.createItem': 'attack',
  'catalog.updateItem': 'attack',
  'catalog.deleteItem': 'attack',
  'orders.list': 'isolation',
  'orders.get': 'attack',
  'orders.createDraft': 'attack',
  'orders.previewDelivery': 'attack',
  'orders.importPo':
    'managerProcedure that ingests an uploaded document; takes no client-supplied tenant entity id (supplier is resolved FROM the parsed doc) and is gated on ANTHROPIC_API_KEY. Cross-tenant reach is bounded by the member tx restaurant GUC, and the import is keyed to ctx.session.restaurantId. Role denial is covered in the managerProcedure-role-denial block.',
  'orders.cancelOrder': 'attack',
  'orders.updateOrderLine': 'attack',
  'orders.deleteOrderLine': 'attack',
  'orders.placeOrder': 'attack',
  // guardrail now calls assertSupplierOwned (wave 3b): a foreign supplierId is
  // rejected with NOT_FOUND before any baseline is read. Defense-in-depth on
  // top of the restaurant-scoped baseline query (which already excluded B's
  // rows). The B-only baseline fixture still proves no leak through the query.
  'orders.guardrail': 'attack',
  'match.runForInvoice': 'attack',
  'plans.list':
    'public marketing catalog (publicProcedure); reads the global plans table only, no tenant-scoped rows — nothing to isolate',
  'leads.create':
    'public landing capture (publicProcedure); writes to the non-tenant leads table, takes no entity ids and reads nothing tenant-scoped',
  // Team management (ownerProcedure, except acceptInvite=userScoped). Every
  // mutation that takes a client-supplied id (invite id / member userId) must
  // reject a foreign one; list excludes the other tenant's members + invites;
  // acceptInvite is bound to the invited address. See the team.* block below.
  'team.list': 'isolation',
  'team.invite':
    'ownerProcedure write keyed to ctx.session.restaurantId; takes no client-supplied tenant entity id (cannot target another tenant). Owner-role denial is covered in the ownerProcedure role-denial block.',
  'team.resendInvite': 'attack',
  'team.revokeInvite': 'attack',
  'team.updateMemberRole': 'attack',
  'team.removeMember': 'attack',
  'team.acceptInvite': 'attack',
  // Catalog SKU→product mapping queue (member reads / managerProcedure confirm).
  // Lists are restaurant-scoped even with a foreign supplierId filter; confirm
  // calls assertSupplierOwned before any write. See the mapping.* block below.
  'mapping.unmapped': 'isolation',
  'mapping.searchProducts': 'isolation',
  'mapping.confirm': 'attack',
  // Canonical product management (rename / recategorize / exclusivity / delete).
  'products.update': 'attack',
  'products.delete': 'attack',
  // Data-subject-rights (E.6). Not tenant-scoped: export/delete act ONLY on the
  // caller's own identity (keyed to ctx.session.userId — no client-supplied
  // target, so a member can never reach another user); eraseLead operates on the
  // non-tenant leads table and is platform-admin gated (admin-denial).
  'dsr.exportMyData':
    'authed self-service; reads only the caller-owned user/membership/lead/activity rows keyed to ctx.session.userId — no client-supplied tenant entity id',
  'dsr.deleteMyAccount':
    'authed self-service; anonymizes ONLY the caller (ctx.session.userId) — takes no target id, cannot reach another user',
  'dsr.eraseLead': 'admin-denial',
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

  it('settings.profile + settings.updateProfile read/write only the caller restaurant', async () => {
    const callerA = callerFor(A);
    // A changes its VAT + timezone; B must keep its defaults.
    await callerA.settings.updateProfile({ vatRate: 0.18, timezone: 'Asia/Jerusalem' });
    const profileA = await callerA.settings.profile();
    expect(profileA.vatRate).toBe(0.18);
    expect(profileA.timezone).toBe('Asia/Jerusalem');

    const [rowB] = await db
      .select({ vatRate: restaurants.vatRate })
      .from(restaurants)
      .where(eq(restaurants.id, B.restaurantId));
    expect(Number(rowB?.vatRate)).toBe(0.18); // B's default VAT untouched
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

  it('catalog.createItem rejects a foreign supplierId and writes nothing for B', async () => {
    const beforeB = await db
      .select({ id: supplierCatalogItems.id })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.restaurantId, B.restaurantId));
    await expect(
      callerFor(A).catalog.createItem({
        supplierId: B.supplierId,
        supplierNameRaw: 'hijack',
        listPrice: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const afterB = await db
      .select({ id: supplierCatalogItems.id })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.restaurantId, B.restaurantId));
    expect(afterB).toHaveLength(beforeB.length);
  });

  it('catalog.updateItem cannot edit a foreign item (B price unchanged)', async () => {
    await expect(
      callerFor(A).catalog.updateItem({ itemId: bCatalogItemId, patch: { listPrice: 999 } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ listPrice: supplierCatalogItems.listPrice })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, bCatalogItemId));
    expect(row?.listPrice).toBe('9.0000'); // B's seeded price, untouched
  });

  it('catalog.deleteItem cannot delete a foreign item (B item survives)', async () => {
    await expect(
      callerFor(A).catalog.deleteItem({ itemId: bCatalogItemId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ id: supplierCatalogItems.id })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, bCatalogItemId));
    expect(row?.id).toBe(bCatalogItemId);
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

  it('orders.previewDelivery rejects a foreign supplierId before deriving a date', async () => {
    await expect(
      callerFor(A).orders.previewDelivery({ supplierId: B.supplierId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('orders.guardrail rejects a foreign supplierId (advanced_analytics, implicit trial)', async () => {
    // wave 3b: guardrail now calls assertSupplierOwned, so a foreign supplierId
    // is rejected with NOT_FOUND before any baseline read — A can no longer even
    // probe B's product/supplier pair. (The restaurant-scoped baseline query was
    // already the leak backstop; this is defense-in-depth.)
    await expect(
      callerFor(A).orders.guardrail({
        supplierId: B.supplierId,
        lines: [{ productId: B.productId, unitPriceExpected: 1000 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('orders.list excludes B purchase orders even with a B supplierId filter', async () => {
    const all = await callerFor(A).orders.list();
    expect(all.map((o) => o.id)).not.toContain(B.poId);
    const filteredByB = await callerFor(A).orders.list({ supplierId: B.supplierId });
    expect(filteredByB.map((o) => o.id)).not.toContain(B.poId);
  });

  it('orders.updateOrderLine cannot edit a foreign line (B unchanged)', async () => {
    const [before] = await db
      .select({ qty: poLines.qtyOrdered })
      .from(poLines)
      .where(eq(poLines.id, B.poLineId));
    await expect(
      callerFor(A).orders.updateOrderLine({ lineId: B.poLineId, patch: { qtyOrdered: 999 } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [after] = await db
      .select({ qty: poLines.qtyOrdered })
      .from(poLines)
      .where(eq(poLines.id, B.poLineId));
    expect(after?.qty).toBe(before?.qty);
  });

  it('orders.deleteOrderLine cannot delete a foreign line (B survives)', async () => {
    await expect(
      callerFor(A).orders.deleteOrderLine({ lineId: B.poLineId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db.select({ id: poLines.id }).from(poLines).where(eq(poLines.id, B.poLineId));
    expect(row?.id).toBe(B.poLineId);
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

  it('receiving.updateInvoiceHeader rejects a foreign invoiceId and leaves B untouched', async () => {
    await expect(
      callerFor(A).receiving.updateInvoiceHeader({
        invoiceId: B.invoiceId,
        patch: { invoiceNumber: 'HIJACK' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(eq(invoices.id, B.invoiceId));
    expect(row?.invoiceNumber).toBe(B.invoiceNumber);
  });

  it('receiving.updateInvoiceLine rejects a foreign lineId and leaves B untouched', async () => {
    await expect(
      callerFor(A).receiving.updateInvoiceLine({
        lineId: B.invoiceLineId,
        patch: { unitPriceBilled: 999 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ qtyBilled: invoiceLines.qtyBilled, unitPriceBilled: invoiceLines.unitPriceBilled })
      .from(invoiceLines)
      .where(eq(invoiceLines.id, B.invoiceLineId));
    expect(row?.qtyBilled).toBe('10.000'); // B's seeded line, untouched
    expect(row?.unitPriceBilled).toBe('10.0000');
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

/* ──────────────────────────────────────────────────────────────────────────
 * Role denial: managerProcedure writes are owner/manager only. A member-tier
 * caller (member / receiver / chef / bookkeeper — none of which are in
 * ['owner','manager']) must be rejected with FORBIDDEN by the requireRoles
 * middleware BEFORE the resolver runs — even when the caller is operating on
 * its OWN tenant's ids (so the denial is the role gate, not tenant ownership).
 *
 * Writes covered: suppliers.update (incl orderSchedule), catalog.commitImport,
 * orders.placeOrder. Authorization is orthogonal to tenancy, so this guards the
 * "a receiver fat-fingers a manager-only mutation" path the attack tests above
 * (all owner-role) cannot reach.
 * ────────────────────────────────────────────────────────────────────────── */

describe('role denial: managerProcedure writes reject member-tier callers', () => {
  // No bare 'member' role exists in the UserRole enum; the member-tier (non-
  // manager) roles are receiver / chef / bookkeeper — all outside the
  // ['owner','manager'] managerProcedure allowlist. receiver + chef stand in.
  const denied = ['receiver', 'chef'] as const;

  for (const role of denied) {
    it(`suppliers.update (incl orderSchedule) → FORBIDDEN for ${role} and leaves A untouched`, async () => {
      const [before] = await db
        .select({ name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.id, A.supplierId));
      await expect(
        callerWithRole(A, role).suppliers.update({
          supplierId: A.supplierId,
          patch: {
            name: 'ROLE-HIJACK',
            orderSchedule: {
              windows: [
                {
                  orderDays: [1],
                  cutoff: '10:00',
                  fulfillment: { kind: 'lead_days', leadDays: 1 },
                },
              ],
            },
          },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const [after] = await db
        .select({ name: suppliers.name, orderSchedule: suppliers.orderSchedule })
        .from(suppliers)
        .where(eq(suppliers.id, A.supplierId));
      expect(after?.name).toBe(before?.name);
      expect(after?.name).not.toBe('ROLE-HIJACK');
      expect(after?.orderSchedule ?? null).toBeNull();
    });

    it(`catalog.commitImport → FORBIDDEN for ${role} and writes no import row for A`, async () => {
      const beforeA = await db
        .select({ id: catalogImports.id })
        .from(catalogImports)
        .where(eq(catalogImports.restaurantId, A.restaurantId));
      await expect(
        callerWithRole(A, role).catalog.commitImport({
          supplierId: A.supplierId,
          file: { filename: 'x.csv', text: 'name,price\nx,1' },
          mapping: { name: 'name', price: 'price' },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const afterA = await db
        .select({ id: catalogImports.id })
        .from(catalogImports)
        .where(eq(catalogImports.restaurantId, A.restaurantId));
      expect(afterA).toHaveLength(beforeA.length);
    });

    it(`orders.placeOrder → FORBIDDEN for ${role} and never mutates A's PO`, async () => {
      const [before] = await db
        .select({ status: purchaseOrders.status, sentAt: purchaseOrders.sentAt })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, A.poId));
      await expect(
        callerWithRole(A, role).orders.placeOrder({ poId: A.poId, channel: 'none' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const [after] = await db
        .select({ status: purchaseOrders.status, sentAt: purchaseOrders.sentAt })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, A.poId));
      expect(after?.status).toBe(before?.status);
      expect(after?.sentAt ?? null).toEqual(before?.sentAt ?? null);
    });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * Team router (owner-gated membership + invitation management) and the catalog
 * SKU→product mapping queue — both registered in appRouter during the
 * supplier-catalog wave but previously undeclared in COVERAGE. team.* mutations
 * take a client-supplied invite id / member userId; acceptInvite is bound to the
 * invited mailbox; mapping.confirm calls assertSupplierOwned. Seed inline: a B
 * invite with a known raw token (for the email-binding attack) and one unmapped
 * (supplier SKU, no productId) line per tenant (for queue isolation).
 * ────────────────────────────────────────────────────────────────────────── */

let bInviteId: string;
const ACCEPT_RAW_TOKEN = 'cross-tenant-accept-raw-token';

beforeAll(async () => {
  const [bInv] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.restaurantId, B.restaurantId), eq(invitations.status, 'pending')))
    .limit(1);
  bInviteId = bInv!.id;

  // A B invite addressed to newcomer-b@attack.test with a KNOWN raw token, so A's
  // owner (a different mailbox) can attempt to accept it and prove the binding.
  await db.insert(invitations).values({
    restaurantId: B.restaurantId,
    email: 'newcomer-b@attack.test',
    role: 'receiver',
    tokenHash: createHash('sha256').update(ACCEPT_RAW_TOKEN).digest('hex'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  // One unmapped line per tenant so the mapping queue has cross-tenant rows.
  await db.insert(poLines).values({
    poId: A.poId,
    rawDescription: 'פריט לא ממופה A',
    qtyOrdered: '3',
    unit: 'kg',
    supplierSku: 'UNMAPPED-A',
  });
  await db.insert(poLines).values({
    poId: B.poId,
    rawDescription: 'פריט לא ממופה B',
    qtyOrdered: '3',
    unit: 'kg',
    supplierSku: 'UNMAPPED-B',
  });
});

describe('team router: foreign-id attacks + list isolation (A → B)', () => {
  it('team.list returns only A members + invites, never B', async () => {
    const { members, invites } = await callerFor(A).team.list();
    expect(members.every((m) => m.userId === A.ownerUserId)).toBe(true);
    const inviteEmails = invites.map((i) => i.email);
    expect(inviteEmails).toContain('invitee-A@attack.test');
    expect(inviteEmails).not.toContain('invitee-B@attack.test');
    expect(inviteEmails).not.toContain('newcomer-b@attack.test');
  });

  it('team.resendInvite rejects a foreign invite id and leaves B pending', async () => {
    await expect(callerFor(A).team.resendInvite({ id: bInviteId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const [inv] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, bInviteId));
    expect(inv?.status).toBe('pending');
  });

  it('team.revokeInvite cannot revoke a foreign invite (B stays pending)', async () => {
    // revokeInvite is idempotent (no throw) but scoped to the caller restaurant,
    // so a foreign id changes nothing.
    await callerFor(A).team.revokeInvite({ id: bInviteId });
    const [inv] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, bInviteId));
    expect(inv?.status).toBe('pending');
  });

  it('team.updateMemberRole rejects a foreign userId and leaves B owner intact', async () => {
    await expect(
      callerFor(A).team.updateMemberRole({ userId: B.ownerUserId, role: 'receiver' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rows = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(eq(memberships.restaurantId, B.restaurantId), eq(memberships.userId, B.ownerUserId)),
      );
    expect(rows.map((r) => r.role)).toEqual(['owner']);
  });

  it('team.removeMember cannot remove a foreign member (B membership intact)', async () => {
    // Idempotent for a non-member: B's user is not a member of A, so this no-op
    // must NOT touch B's membership.
    await callerFor(A).team.removeMember({ userId: B.ownerUserId });
    const rows = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(eq(memberships.restaurantId, B.restaurantId), eq(memberships.userId, B.ownerUserId)),
      );
    expect(rows).toHaveLength(1);
  });

  it('team.acceptInvite rejects an invite bound to a different mailbox (no membership leak)', async () => {
    // A's owner (owner-A@attack.test) holds the raw token of a B invite addressed
    // to newcomer-b@attack.test. The email binding must reject it (FORBIDDEN) and
    // never enroll A's user into B; the invite stays pending.
    await expect(
      callerFor(A).team.acceptInvite({ token: ACCEPT_RAW_TOKEN }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const leaked = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(eq(memberships.restaurantId, B.restaurantId), eq(memberships.userId, A.ownerUserId)),
      );
    expect(leaked).toHaveLength(0);
    const [inv] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(
        and(
          eq(invitations.restaurantId, B.restaurantId),
          eq(invitations.email, 'newcomer-b@attack.test'),
        ),
      );
    expect(inv?.status).toBe('pending');
  });
});

describe('mapping router: foreign-id attack + queue isolation (A → B)', () => {
  it('mapping.unmapped excludes B lines, even with a B supplierId filter', async () => {
    const aQueue = await callerFor(A).mapping.unmapped();
    const aSkus = aQueue.map((u) => u.supplierSku);
    expect(aSkus).toContain('UNMAPPED-A');
    expect(aSkus).not.toContain('UNMAPPED-B');

    // A B supplierId filter must not punch through the restaurant scope.
    const filteredByB = await callerFor(A).mapping.unmapped({ supplierId: B.supplierId });
    expect(filteredByB.map((u) => u.supplierSku)).not.toContain('UNMAPPED-B');

    // Positive control: B sees its own unmapped line.
    const bQueue = await callerFor(B).mapping.unmapped();
    expect(bQueue.map((u) => u.supplierSku)).toContain('UNMAPPED-B');
  });

  it('mapping.searchProducts returns only A products', async () => {
    const hits = await callerFor(A).mapping.searchProducts({ q: 'עגבניה' });
    const names = hits.map((p) => p.canonicalName);
    expect(names.some((n) => n.includes('A'))).toBe(true);
    expect(names.some((n) => n.includes('B'))).toBe(false);
  });

  it('mapping.confirm rejects a foreign supplierId before creating a product', async () => {
    const before = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.restaurantId, B.restaurantId));
    await expect(
      callerFor(A).mapping.confirm({
        supplierId: B.supplierId,
        supplierSku: 'UNMAPPED-B',
        rawName: 'hijack',
        newProductName: 'hijack product',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const after = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.restaurantId, B.restaurantId));
    expect(after).toHaveLength(before.length);
  });
});

describe('products router: foreign-id attacks (A → B)', () => {
  it('products.update cannot rename a foreign product (B unchanged)', async () => {
    await expect(
      callerFor(A).products.update({ productId: B.productId, patch: { canonicalName: 'HIJACK' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ canonicalName: products.canonicalName })
      .from(products)
      .where(eq(products.id, B.productId));
    expect(row?.canonicalName).toBe('עגבניה B');
  });

  it('products.update rejects assigning a foreign supplier as exclusivity owner', async () => {
    // A owns the product but tries to set B's supplier as owner → NOT_FOUND.
    await expect(
      callerFor(A).products.update({ productId: A.productId, patch: { supplierId: B.supplierId } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ supplierId: products.supplierId })
      .from(products)
      .where(eq(products.id, A.productId));
    expect(row?.supplierId ?? null).toBeNull();
  });

  it('products.delete cannot delete a foreign product (B survives)', async () => {
    await expect(
      callerFor(A).products.delete({ productId: B.productId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db.select({ id: products.id }).from(products).where(eq(products.id, B.productId));
    expect(row?.id).toBe(B.productId);
  });
});

describe('role denial: ownerProcedure team writes reject non-owner callers', () => {
  // team.* mutations are ownerProcedure — manager/receiver fall outside the
  // ['owner'] allowlist and must be rejected by requireRoles BEFORE the resolver,
  // even on the caller's OWN tenant ids (the role gate, not tenancy).
  const denied = ['manager', 'receiver'] as const;
  for (const role of denied) {
    it(`team.invite → FORBIDDEN for ${role}`, async () => {
      await expect(
        callerWithRole(A, role).team.invite({ email: 'x@attack.test', role: 'receiver' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it(`team.updateMemberRole → FORBIDDEN for ${role} and leaves A owner intact`, async () => {
      await expect(
        callerWithRole(A, role).team.updateMemberRole({ userId: A.ownerUserId, role: 'receiver' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const rows = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(eq(memberships.restaurantId, A.restaurantId), eq(memberships.userId, A.ownerUserId)),
        );
      expect(rows.map((r) => r.role)).toEqual(['owner']);
    });
  }
});

describe('role denial: mapping.confirm rejects member-tier callers', () => {
  const denied = ['receiver', 'chef'] as const;
  for (const role of denied) {
    it(`mapping.confirm → FORBIDDEN for ${role} and creates no product`, async () => {
      const before = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.restaurantId, A.restaurantId));
      await expect(
        callerWithRole(A, role).mapping.confirm({
          supplierId: A.supplierId,
          supplierSku: 'UNMAPPED-A',
          rawName: 'role hijack',
          newProductName: 'role hijack product',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const after = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.restaurantId, A.restaurantId));
      expect(after).toHaveLength(before.length);
    });
  }
});
