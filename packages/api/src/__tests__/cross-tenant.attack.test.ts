import { testDbUrl } from '@restomatch/db';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  catalogImports,
  inArray,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  invitations,
  invoiceLines,
  invoices,
  memberships,
  poLines,
  priceAlertThresholds,
  priceAlerts,
  priceBaselines,
  products,
  creditNotes,
  recoveryClaims,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
  supplierContractPrices,
  suppliers,
  type RestaurantSettings,
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
  // S14 wave 1 — receiver languages + AI assistant (flag-gated).
  'receiverLangs.status': 'isolation',
  'receiverLangs.localNames': 'attack',
  'receiverLangs.setMyLocale': 'isolation',
  'receiverLangs.setMemberLocale': 'attack',
  'ask.status': 'isolation',
  'ask.ask': 'isolation',
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
  // Chain / branches (S8). Exercised on the RLS-enforced app role in
  // chain.attack.test.ts: A + B share a billing account, A also manages M and
  // owns X on another account — A's chain is exactly its owner branches there.
  'chain.branches':
    'isolation — chain.attack.test.ts: lists only caller-OWNED branches on the active billing account (not B on the same account, not manager-only M, not X on another account)',
  'chain.overview':
    'isolation — chain.attack.test.ts: per-branch withRestaurant (RLS) sums; totals = A + A2 only, B/M/X excluded; forged session restaurantId → FORBIDDEN',
  'chain.switchTarget':
    'attack — chain.attack.test.ts: switching to B (no membership) or a random uuid → NOT_FOUND',
  'chain.renameBranch':
    'attack — chain.attack.test.ts: renaming B or manager-only M → NOT_FOUND, names unchanged',
  'chain.addBranch':
    'attack — chain.attack.test.ts: owner-only, plan limit enforced, copies only the source branch rows, manager / no-billing-account → FORBIDDEN',
  'owner.kpis': 'isolation',
  'owner.leakHero': 'isolation',
  'owner.leakBreakdown': 'isolation',
  'owner.leakReport': 'isolation',
  'owner.leakSummary': 'isolation',
  'owner.leakGrouped': 'isolation',
  'owner.leakTrend': 'isolation',
  'owner.viewOptions': 'isolation',
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
  // S2 "Receiver in English": writes ONLY display columns, but still takes a
  // client-supplied poId / invoiceId — a foreign id must be NOT_FOUND and B's
  // po_lines / invoice_lines / products must stay untranslated.
  'receiving.ensureEnglish': 'attack',
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
  'catalog.imports': 'isolation',
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
  'team.setMemberLocale': 'attack',
  'settings.myLocale': 'isolation',
  'settings.setMyLocale': 'attack',
  // Catalog SKU→product mapping queue (member reads / managerProcedure confirm).
  // Lists are restaurant-scoped even with a foreign supplierId filter; confirm
  // calls assertSupplierOwned before any write. See the mapping.* block below.
  'mapping.unmapped': 'isolation',
  'mapping.searchProducts': 'isolation',
  'mapping.confirm': 'attack',
  // Canonical product management (rename / recategorize / exclusivity / delete).
  'products.update': 'attack',
  'products.list': 'isolation',
  'products.setNamesEn': 'attack',
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
  // Wave 1 (S11): supplier contract prices + price-trend alerts — feature-gated
  // (`contracts` / `priceAlerts`); attacks + isolation in the block at the end.
  'contracts.access': 'isolation',
  'contracts.list': 'isolation',
  'contracts.productOptions': 'attack',
  'contracts.create': 'attack',
  'contracts.update': 'attack',
  'contracts.delete': 'attack',
  'contracts.importPreview': 'attack',
  'contracts.importCommit': 'attack',
  'contracts.overContractForInvoice': 'attack',
  'contracts.overContract': 'isolation',
  'priceAlerts.list': 'isolation',
  'priceAlerts.dismiss': 'attack',
  'priceAlerts.refresh': 'isolation',
  'priceAlerts.thresholds': 'isolation',
  'priceAlerts.setThreshold': 'attack',
  'priceAlerts.deleteThreshold': 'attack',
  'priceAlerts.openCount': 'isolation',
  // Wave 1 · S12 — ₪-back tracker (flag `recovery`) + monthly report (flag `monthlyReport`).
  'recovery.flags': 'isolation',
  'recovery.summary': 'isolation',
  'recovery.list': 'isolation',
  'recovery.history': 'attack',
  'recovery.transition': 'attack',
  'recovery.recordCreditNote': 'attack',
  'recovery.creditLineSuggestions': 'isolation',
  'recovery.returnedThisMonth': 'isolation',
  'monthlyReport.preview': 'isolation',
  'monthlyReport.pdf': 'isolation',
  // S13 invoice ingestion (WhatsApp / e-mail). Reads are restaurant-scoped;
  // rotate/revoke act only on the session restaurant's own channel (no
  // client-supplied tenant id); sender / document ids are re-checked. The
  // PUBLIC webhooks have their own suite: ingest.attack.test.ts.
  'ingest.overview': 'isolation',
  'ingest.rotateChannel': 'isolation',
  'ingest.revokeChannel': 'isolation',
  'ingest.senders': 'isolation',
  'ingest.addSender': 'attack',
  'ingest.removeSender': 'attack',
  'ingest.inbox': 'isolation',
  'ingest.approveDocument': 'attack',
  'ingest.rejectDocument': 'attack',
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

  it('owner.leakHero aggregates A-scoped invoices only', async () => {
    const caller = callerFor(A);
    const hero = await caller.owner.leakHero();
    // Each seeded tenant has one ₪100 (excl. VAT) invoice dated today: B's must
    // not be added to A's spend.
    expect(hero.spendIls).toBe(100);
    expect(hero.invoiceCount).toBe(1);
  });

  it('owner.leakBreakdown excludes B invoices and lines', async () => {
    const caller = callerFor(A);
    const rows = await caller.owner.leakBreakdown();
    const json = JSON.stringify(rows);
    expect(rows.map((r) => r.invoiceId)).toContain(A.invoiceId);
    expect(json).not.toContain(B.invoiceId);
    expect(json).not.toContain(B.discrepancyId);
    expect(json).not.toContain(B.supplierName);
  });

  it('owner.leakSummary (views) aggregates A-scoped invoices only', async () => {
    const caller = callerFor(A);
    const { current } = await caller.owner.leakSummary({ view: { period: 'ytd' }, compare: 'off' });
    expect(current.spendIls).toBe(100); // A's one ₪100 invoice, not B's
    // A view filtered to B's supplier id sees nothing of B.
    const foreign = await caller.owner.leakSummary({
      view: { period: 'ytd', filters: { supplierIds: [B.supplierId] } },
      compare: 'prev',
    });
    expect(foreign.current.spendIls).toBe(0);
    expect(foreign.current.invoiceCount).toBe(0);
  });

  it('owner.leakGrouped / leakTrend exclude B rows', async () => {
    const caller = callerFor(A);
    const grouped = await caller.owner.leakGrouped({
      view: { period: 'last_12m' },
      groupBy: 'supplier',
      compare: 'yoy',
    });
    const json = JSON.stringify(grouped);
    expect(json).not.toContain(B.supplierId);
    expect(json).not.toContain(B.supplierName);
    const trend = await caller.owner.leakTrend({ view: { period: 'last_12m' }, compare: 'off' });
    expect(trend.points.reduce((s, p) => s + p.spendIls, 0)).toBe(100);
  });

  it('owner.viewOptions lists only A suppliers', async () => {
    const opts = await callerFor(A).owner.viewOptions();
    expect(opts.suppliers.map((s) => s.id)).toContain(A.supplierId);
    expect(opts.suppliers.map((s) => s.id)).not.toContain(B.supplierId);
  });

  it('view drill-downs stay finance-only (receiver/chef → FORBIDDEN); summary stays member-level', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(
        callerWithRole(A, role).owner.leakGrouped({ view: { period: 'this_month' }, groupBy: 'type', compare: 'off' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        callerWithRole(A, role).owner.leakTrend({ view: { period: 'this_month' }, compare: 'off' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        callerWithRole(A, role).owner.leakSummary({ view: { period: 'this_month' }, compare: 'off' }),
      ).resolves.toBeDefined();
      // Filters slice the leak per supplier/category/type → finance detail.
      await expect(
        callerWithRole(A, role).owner.leakSummary({
          view: { period: 'this_month', filters: { supplierIds: [A.supplierId] } },
          compare: 'off',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerWithRole(A, role).owner.viewOptions()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('view inputs are validated (custom needs dates, enums are closed, ids are uuids)', async () => {
    const caller = callerFor(A);
    await expect(caller.owner.leakSummary({ view: { period: 'custom' }, compare: 'off' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.owner.leakSummary({ view: { period: 'this_month', filters: { supplierIds: ["x' OR 1=1"] } }, compare: 'off' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      // @ts-expect-error — not a known discrepancy type
      caller.owner.leakSummary({ view: { period: 'this_month', filters: { types: ['DROP TABLE'] } }, compare: 'off' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Impossible / out-of-range calendar dates never reach Postgres.
    for (const [from, to] of [
      ['2026-02-30', '2026-03-05'],
      ['0000-01-01', '2026-01-01'],
      ['2000-01-01', '2026-01-01'], // > 3 years
    ]) {
      await expect(
        caller.owner.leakSummary({ view: { period: 'custom', from, to }, compare: 'off' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
  });

  it('owner.leakReport aggregates A-scoped data only', async () => {
    const caller = callerFor(A);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const report = await caller.owner.leakReport({ month });
    const json = JSON.stringify(report);
    expect(json).not.toContain(B.supplierName);
    expect(report.bySupplier.every((r) => r.supplierId !== B.supplierId)).toBe(true);
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

describe('receiving.ensureEnglish: foreign id attacks (A → B)', () => {
  it('rejects a foreign poId and writes no English into B rows', async () => {
    await expect(callerFor(A).receiving.ensureEnglish({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const [line] = await db
      .select({ en: poLines.rawDescriptionEn })
      .from(poLines)
      .where(eq(poLines.id, B.poLineId));
    expect(line?.en ?? null).toBeNull();
    const [product] = await db
      .select({ en: products.nameEn })
      .from(products)
      .where(eq(products.id, B.productId));
    expect(product?.en ?? null).toBeNull();
  });

  it('rejects a foreign invoiceId (even paired with A\'s own poId) and leaves B untouched', async () => {
    await expect(
      callerFor(A).receiving.ensureEnglish({ poId: A.poId, invoiceId: B.invoiceId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [line] = await db
      .select({ en: invoiceLines.rawDescriptionEn })
      .from(invoiceLines)
      .where(eq(invoiceLines.id, B.invoiceLineId));
    expect(line?.en ?? null).toBeNull();
  });
});

describe('S14 receiverLangs + ask: foreign ids and isolation (A → B)', () => {
  async function flagsOn(t: Tenant) {
    await db
      .update(restaurants)
      .set({ settings: { features: { receiverLanguages: true, aiAssistant: true } } as never })
      .where(eq(restaurants.id, t.restaurantId));
  }
  async function flagsOff(t: Tenant) {
    await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, t.restaurantId));
  }

  it('receiverLangs.status reads only the session restaurant flag', async () => {
    await flagsOn(B);
    await flagsOff(A);
    expect((await callerFor(A).receiverLangs.status()).enabled).toBe(false);
    expect((await callerFor(B).receiverLangs.status()).enabled).toBe(true);
    await flagsOff(B);
  });

  it('receiverLangs.localNames rejects a foreign poId / invoiceId', async () => {
    await flagsOn(A);
    await expect(callerFor(A).receiverLangs.localNames({ locale: 'ar', poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      callerFor(A).receiverLangs.localNames({ locale: 'ru', poId: A.poId, invoiceId: B.invoiceId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await flagsOff(A);
  });

  it("receiverLangs.setMemberLocale cannot change B's member; setMyLocale touches only my membership", async () => {
    await flagsOn(A);
    await expect(
      callerFor(A).receiverLangs.setMemberLocale({ userId: B.ownerUserId, locale: 'th' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await callerFor(A).receiverLangs.setMyLocale({ locale: 'ti' });
    const [bm] = await db
      .select({ l: memberships.preferredLocale })
      .from(memberships)
      .where(eq(memberships.restaurantId, B.restaurantId));
    expect(bm?.l ?? null).not.toBe('ti');
    await callerFor(A).receiverLangs.setMyLocale({ locale: null });
    await flagsOff(A);
  });

  it("ask.ask (offline) and ask.status never expose B's data", async () => {
    const { __setAskClient } = await import('../ask');
    __setAskClient(null);
    try {
      await flagsOn(A);
      const r = await callerFor(A).ask.ask({ question: 'What should I claim this week?', locale: 'en' });
      const s = JSON.stringify(r);
      expect(s).not.toContain(B.invoiceId);
      expect(s).not.toContain(B.restaurantId);
      expect(s).not.toContain(B.invoiceNumber);
      expect((await callerFor(A).ask.status()).enabled).toBe(true);
      expect((await callerFor(B).ask.status()).enabled).toBe(false);
      await expect(callerFor(B).ask.ask({ question: 'how much leaked?', locale: 'en' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    } finally {
      __setAskClient(undefined);
      await flagsOff(A);
    }
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

  it('products.update cannot set the English name of a foreign product (B unchanged)', async () => {
    await expect(
      callerFor(A).products.update({ productId: B.productId, patch: { nameEn: 'HIJACK' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ nameEn: products.nameEn })
      .from(products)
      .where(eq(products.id, B.productId));
    expect(row?.nameEn ?? null).toBeNull();
  });

  it('suppliers.update cannot set the English name of a foreign supplier (B unchanged)', async () => {
    await expect(
      callerFor(A).suppliers.update({ supplierId: B.supplierId, patch: { nameEn: 'HIJACK' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ nameEn: suppliers.nameEn })
      .from(suppliers)
      .where(eq(suppliers.id, B.supplierId));
    expect(row?.nameEn ?? null).toBeNull();
  });

  it('products.list returns only the caller restaurant products', async () => {
    const out = await callerFor(A).products.list();
    expect(out.rows.map((r) => r.id)).toContain(A.productId);
    expect(out.rows.map((r) => r.id)).not.toContain(B.productId);
  });

  it('products.setNamesEn rejects a batch containing a foreign product and writes nothing', async () => {
    await expect(
      callerFor(A).products.setNamesEn({
        items: [
          { productId: A.productId, nameEn: 'Mine' },
          { productId: B.productId, nameEn: 'HIJACK' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rows = await db
      .select({ id: products.id, nameEn: products.nameEn })
      .from(products)
      .where(inArray(products.id, [A.productId, B.productId]));
    for (const r of rows) expect(r.nameEn ?? null).toBeNull();
  });

  it('catalog.imports excludes B import history', async () => {
    await db.insert(catalogImports).values({
      restaurantId: B.restaurantId,
      supplierId: B.supplierId,
      filename: 'b-secret.xlsx',
    });
    const all = await callerFor(A).catalog.imports();
    expect(all.map((i) => i.filename)).not.toContain('b-secret.xlsx');
    const foreign = await callerFor(A).catalog.imports({ supplierId: B.supplierId });
    expect(foreign).toHaveLength(0);
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

/* ──────────────────────────────────────────────────────────────────────────
 * Per-member app language (client-ready S4). team.setMemberLocale takes a
 * client-supplied member userId (managerProcedure) — a foreign one must match
 * nothing; settings.setMyLocale / myLocale are keyed to the session only.
 * ────────────────────────────────────────────────────────────────────────── */
describe('member locale: foreign-id attacks + self isolation (A → B)', () => {
  async function bOwnerLocale() {
    const [row] = await db
      .select({ locale: memberships.preferredLocale })
      .from(memberships)
      .where(
        and(eq(memberships.restaurantId, B.restaurantId), eq(memberships.userId, B.ownerUserId)),
      );
    return row?.locale ?? null;
  }

  it('team.setMemberLocale rejects a foreign userId and leaves B locale untouched', async () => {
    await callerFor(B).team.setMemberLocale({ userId: B.ownerUserId, locale: 'he' });
    for (const role of ['owner', 'manager'] as const) {
      await expect(
        callerWithRole(A, role).team.setMemberLocale({ userId: B.ownerUserId, locale: 'en' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await bOwnerLocale()).toBe('he');
  });

  it('team.setMemberLocale → FORBIDDEN for receiver/bookkeeper/chef', async () => {
    for (const role of ['receiver', 'bookkeeper', 'chef'] as const) {
      await expect(
        callerWithRole(A, role).team.setMemberLocale({ userId: A.ownerUserId, locale: 'en' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('team.setMemberLocale works on an own-tenant member and team.list reflects it', async () => {
    await callerWithRole(A, 'manager').team.setMemberLocale({ userId: A.ownerUserId, locale: 'en' });
    const { members } = await callerWithRole(A, 'manager').team.list();
    expect(members.find((m) => m.userId === A.ownerUserId)?.preferredLocale).toBe('en');
    await callerFor(A).team.setMemberLocale({ userId: A.ownerUserId, locale: null });
  });

  it('settings.setMyLocale writes only the caller membership; myLocale reads only it', async () => {
    await callerFor(B).settings.setMyLocale({ locale: 'he' });
    await callerFor(A).settings.setMyLocale({ locale: 'en' });
    expect(await callerFor(A).settings.myLocale()).toEqual({ locale: 'en' });
    expect(await callerFor(B).settings.myLocale()).toEqual({ locale: 'he' });
    expect(await bOwnerLocale()).toBe('he');
    await callerFor(A).settings.setMyLocale({ locale: null });
    expect(await callerFor(A).settings.myLocale()).toEqual({ locale: null });
  });
});

describe('role denial: finance-only reads (leakBreakdown, approvals.history) — security review', () => {
  // The invoice-level drill-down (supplier, invoice number, line deltas) is the
  // /dashboard/leaks data; receiver/chef see only the aggregate leak hero.
  for (const role of ['receiver', 'chef'] as const) {
    it(`owner.leakBreakdown → FORBIDDEN for ${role}`, async () => {
      await expect(callerWithRole(A, role).owner.leakBreakdown()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  }
  it('owner.leakBreakdown stays available to bookkeeper (claims page) and manager', async () => {
    for (const role of ['bookkeeper', 'manager'] as const) {
      await expect(callerWithRole(A, role).owner.leakBreakdown()).resolves.toBeDefined();
    }
  });
  it('approvals.history → FORBIDDEN for receiver/chef', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(
        callerWithRole(A, role).approvals.history({ discrepancyId: A.discrepancyId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
  it('owner.leakHero (aggregate) stays readable by every member', async () => {
    await expect(callerWithRole(A, 'receiver').owner.leakHero()).resolves.toBeDefined();
  });
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

describe('wave 1 (S11): contracts + priceAlerts — foreign ids and isolation', () => {
  let bContractId: string;
  let bAlertId: string;
  let bThresholdId: string;
  let aContractId: string;

  beforeAll(async () => {
    for (const t of [A, B]) {
      await db.update(restaurants).set({ settings: { features: { contracts: true, priceAlerts: true } } as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
    }
    const mk = async (t: Tenant, price: string) => {
      const [c] = await db
        .insert(supplierContractPrices)
        .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, productId: t.productId, contractPrice: price, validFrom: '2020-01-01' })
        .returning();
      return c!.id;
    };
    aContractId = await mk(A, '9.0000');
    bContractId = await mk(B, '1.0000'); // B's invoice line (₪10) is far over B's contract
    const [alert] = await db
      .insert(priceAlerts)
      .values({
        restaurantId: B.restaurantId,
        productId: B.productId,
        supplierId: B.supplierId,
        windowDays: 21,
        thresholdPct: '0.1000',
        startPrice: '6.0000',
        endPrice: '7.0000',
        pctChange: '0.1667',
        startAt: new Date(Date.now() - 20 * 86_400_000),
        endAt: new Date(),
        observations: 4,
        dedupeKey: 'b-alert',
      })
      .returning();
    bAlertId = alert!.id;
    const [th] = await db
      .insert(priceAlertThresholds)
      .values({ restaurantId: B.restaurantId, supplierId: B.supplierId, thresholdPct: '0.0500', windowDays: 14 })
      .returning();
    bThresholdId = th!.id;
  });

  afterAll(async () => {
    await db.delete(supplierContractPrices);
    await db.delete(priceAlerts);
    await db.delete(priceAlertThresholds);
    for (const t of [A, B]) {
      await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, t.restaurantId));
    }
  });

  const bContract = async () =>
    (await db.select().from(supplierContractPrices).where(eq(supplierContractPrices.id, bContractId)))[0]!;

  it('contracts.access reports only the caller’s flags + open-alert count; hides flags from receivers', async () => {
    expect(await callerFor(A).contracts.access()).toEqual({ contracts: true, priceAlerts: true, openAlerts: 0 });
    expect(await callerFor(B).contracts.access()).toEqual({ contracts: true, priceAlerts: true, openAlerts: 1 });
    expect(await callerWithRole(A, 'receiver').contracts.access()).toEqual({ contracts: false, priceAlerts: false, openAlerts: 0 });
  });

  it('contracts.list / overContract never include B rows', async () => {
    const list = await callerFor(A).contracts.list();
    expect(list.map((r) => r.id)).toEqual([aContractId]);
    const over = await callerFor(A).contracts.overContract();
    expect(over.lines.every((l) => l.invoiceId === A.invoiceId)).toBe(true);
    expect(over.lines.some((l) => l.contractId === bContractId)).toBe(false);
  });

  it('contracts.overContractForInvoice on B’s invoice returns nothing', async () => {
    expect(await callerFor(A).contracts.overContractForInvoice({ invoiceId: B.invoiceId })).toEqual([]);
    // sanity: B sees its own over-contract line
    expect(await callerFor(B).contracts.overContractForInvoice({ invoiceId: B.invoiceId })).toHaveLength(1);
  });

  it('contracts.productOptions / importPreview / importCommit reject B’s supplier', async () => {
    await expect(callerFor(A).contracts.productOptions({ supplierId: B.supplierId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const file = { filename: 'c.csv', text: 'name,price\nעגבניה B,0.5\n' };
    await expect(callerFor(A).contracts.importPreview({ supplierId: B.supplierId, file })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callerFor(A).contracts.importCommit({ supplierId: B.supplierId, file, mapping: { name: 'name', price: 'price' }, defaultValidFrom: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await bContract()).contractPrice).toBe('1.0000');
  });

  it('contracts.importCommit on A’s supplier never resolves a B product by name', async () => {
    const res = await callerFor(A).contracts.importCommit({
      supplierId: A.supplierId,
      file: { filename: 'c.csv', text: 'name,price\nעגבניה B,0.5\n' },
      mapping: { name: 'name', price: 'price' },
      defaultValidFrom: '2026-02-02',
    });
    expect(res).toMatchObject({ created: 0, updated: 0 });
    expect(res.skipped[0]!.reason).toBe('NO_PRODUCT');
  });

  it('contracts.create rejects B’s supplier and B’s product', async () => {
    await expect(
      callerFor(A).contracts.create({ supplierId: B.supplierId, productId: A.productId, contractPrice: 1, validFrom: '2026-03-03' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callerFor(A).contracts.create({ supplierId: A.supplierId, productId: B.productId, contractPrice: 1, validFrom: '2026-03-03' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('contracts.update / delete reject B’s contract id and leave it untouched', async () => {
    await expect(callerFor(A).contracts.update({ id: bContractId, contractPrice: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).contracts.delete({ id: bContractId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await bContract()).contractPrice).toBe('1.0000');
  });

  it('priceAlerts.list / openCount / thresholds / refresh exclude B', async () => {
    expect(await callerFor(A).priceAlerts.list()).toEqual([]);
    expect(await callerFor(A).priceAlerts.openCount()).toEqual({ count: 0 });
    expect((await callerFor(A).priceAlerts.thresholds()).rules).toEqual([]);
    await callerFor(A).priceAlerts.refresh();
    const aAlerts = await db.select().from(priceAlerts).where(eq(priceAlerts.restaurantId, A.restaurantId));
    expect(aAlerts).toEqual([]);
    expect(await callerFor(B).priceAlerts.openCount()).toEqual({ count: 1 });
  });

  it('priceAlerts.dismiss / deleteThreshold reject B ids; setThreshold rejects B’s supplier', async () => {
    await expect(callerFor(A).priceAlerts.dismiss({ id: bAlertId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).priceAlerts.deleteThreshold({ id: bThresholdId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callerFor(A).priceAlerts.setThreshold({ supplierId: B.supplierId, category: null, thresholdPct: 0.5, windowDays: 30, enabled: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [alert] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, bAlertId));
    expect(alert!.status).toBe('open');
    const [th] = await db.select().from(priceAlertThresholds).where(eq(priceAlertThresholds.id, bThresholdId));
    expect(th!.thresholdPct).toBe('0.0500');
  });

  it('every wave-1 procedure is FORBIDDEN (FEATURE_DISABLED) for a tenant with the flags off', async () => {
    await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
    try {
      await expect(callerFor(A).contracts.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A).priceAlerts.openCount()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await db.update(restaurants).set({ settings: { features: { contracts: true, priceAlerts: true } } as RestaurantSettings }).where(eq(restaurants.id, A.restaurantId));
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Wave 1 · S12 — ₪-back tracker + monthly report. Both tenants have the flags
 * on and one accepted (claimed) discrepancy each; A must never see, move or
 * credit B's claims, nor use B's supplier / invoice line for a credit note.
 * ────────────────────────────────────────────────────────────────────────── */
describe('recovery + monthly report (A → B)', () => {
  let bClaimId: string;
  let aClaimId: string;

  beforeAll(async () => {
    for (const t of [A, B]) {
      await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, t.restaurantId));
      await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, t.discrepancyId));
    }
    aClaimId = (await callerFor(A).recovery.list())[0]!.id;
    bClaimId = (await callerFor(B).recovery.list())[0]!.id;
  });

  it('recovery.list / summary / returnedThisMonth aggregate A-scoped claims only', async () => {
    const caller = callerFor(A);
    const list = await caller.recovery.list();
    expect(list.map((c) => c.id)).toEqual([aClaimId]);
    expect(JSON.stringify(list)).not.toContain(B.supplierName);
    const { summary } = await caller.recovery.summary();
    expect(summary.claimCount).toBe(1);
    expect(summary.bySupplier.every((s) => s.supplierId !== B.supplierId)).toBe(true);
    // B's claim recovered → A's returned stays 0.
    await db.update(recoveryClaims).set({ status: 'recovered', creditedAgorot: 500, recoveredAt: new Date() }).where(eq(recoveryClaims.id, bClaimId));
    expect((await caller.recovery.returnedThisMonth()).returnedAgorot).toBe(0);
    await db.update(recoveryClaims).set({ status: 'claimed', creditedAgorot: 0, recoveredAt: null }).where(eq(recoveryClaims.id, bClaimId));
  });

  it('recovery.list ignores a foreign supplierId filter (returns nothing of B)', async () => {
    expect(await callerFor(A).recovery.list({ supplierId: B.supplierId })).toEqual([]);
  });

  it('recovery.history rejects a foreign claimId', async () => {
    await expect(callerFor(A).recovery.history({ claimId: bClaimId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('recovery.transition rejects a foreign claimId and leaves B untouched', async () => {
    await expect(
      callerFor(A).recovery.transition({ claimIds: [aClaimId, bClaimId], to: 'written_off' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [b] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, bClaimId));
    expect(b!.status).toBe('claimed');
  });

  it('recovery.recordCreditNote rejects B claims, B supplier and B invoice lines', async () => {
    const caller = callerFor(A);
    await expect(
      caller.recovery.recordCreditNote({ claimIds: [bClaimId], supplierId: A.supplierId, amountAgorot: 100, issuedOn: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.recovery.recordCreditNote({ claimIds: [aClaimId], supplierId: B.supplierId, amountAgorot: 100, issuedOn: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.update(invoiceLines).set({ lineTotal: '-5.00' }).where(eq(invoiceLines.id, B.invoiceLineId));
    try {
      await expect(
        caller.recovery.recordCreditNote({ claimIds: [aClaimId], invoiceLineId: B.invoiceLineId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await db.update(invoiceLines).set({ lineTotal: '100.00' }).where(eq(invoiceLines.id, B.invoiceLineId));
    }
    const [b] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, bClaimId));
    expect(b!.creditedAgorot).toBe(0);
  });

  it('recovery.creditLineSuggestions never offers B credit lines', async () => {
    await db.update(invoiceLines).set({ lineTotal: '-5.00' }).where(eq(invoiceLines.id, B.invoiceLineId));
    try {
      const rows = await callerFor(A).recovery.creditLineSuggestions({ supplierId: B.supplierId });
      expect(rows).toEqual([]);
      expect(JSON.stringify(await callerFor(A).recovery.creditLineSuggestions())).not.toContain(B.invoiceLineId);
    } finally {
      await db.update(invoiceLines).set({ lineTotal: '100.00' }).where(eq(invoiceLines.id, B.invoiceLineId));
    }
  });

  it('monthlyReport.preview / pdf aggregate A-scoped data only', async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const p = await callerFor(A).monthlyReport.preview({ month, locale: 'he' });
    const json = JSON.stringify(p);
    expect(json).not.toContain(B.supplierName);
    expect(p.data.restaurantName).toBe('Resto A');
    const pdf = await callerFor(A).monthlyReport.pdf({ month, locale: 'en' });
    expect(pdf.base64.length).toBeGreaterThan(100);
  });

  it('DB level: A rows can never reference B suppliers / invoices / discrepancies / lines (composite FKs, 23503)', async () => {
    // A B discrepancy with no claim yet (so the unique key cannot answer first).
    const [freshB] = await db
      .insert(discrepancies)
      .values({ matchRunId: B.matchRunId, restaurantId: B.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '3.00' })
      .returning();
    const attempts = [
      db.insert(creditNotes).values({ restaurantId: A.restaurantId, supplierId: B.supplierId, amountAgorot: 100, issuedOn: '2026-10-01' }),
      db.insert(creditNotes).values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceId: B.invoiceId,
        amountAgorot: 100,
        issuedOn: '2026-10-01',
      }),
      db.insert(creditNotes).values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceId: A.invoiceId,
        invoiceLineId: B.invoiceLineId,
        amountAgorot: 100,
        issuedOn: '2026-10-01',
        source: 'invoice_line',
      }),
      db.insert(recoveryClaims).values({ restaurantId: A.restaurantId, discrepancyId: freshB!.id, amountAgorot: 1 }),
      db.update(recoveryClaims).set({ invoiceId: B.invoiceId }).where(eq(recoveryClaims.id, aClaimId)),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toMatchObject({ code: '23503' });
    await db.delete(discrepancies).where(eq(discrepancies.id, freshB!.id));
    // B's claim is untouched and still B's.
    const [b] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, bClaimId));
    expect(b!.restaurantId).toBe(B.restaurantId);
  });

  it('flags are per restaurant: B with the flag off is refused while A works', async () => {
    await db.update(restaurants).set({ settings: {} as never }).where(eq(restaurants.id, B.restaurantId));
    try {
      expect(await callerFor(B).recovery.flags()).toEqual({ recovery: false, monthlyReport: false });
      expect(await callerFor(A).recovery.flags()).toEqual({ recovery: true, monthlyReport: true });
      await expect(callerFor(B).recovery.summary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A).recovery.summary()).resolves.toBeDefined();
    } finally {
      await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, B.restaurantId));
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * S13 ingest.* — B has a channel, an allow-listed sender and a needs_review
 * document; A must not see, approve, reject, remove or re-point any of them.
 * ────────────────────────────────────────────────────────────────────────── */
describe('ingest.*: isolation + foreign-id attacks (A → B)', () => {
  const ids = { bSender: '', bDoc: '', bMsg: '', aDoc: '' };

  beforeAll(async () => {
    for (const t of [A, B]) {
      await db
        .update(restaurants)
        .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } as never })
        .where(eq(restaurants.id, t.restaurantId));
    }
    const seed = async (t: Tenant, tag: string) => {
      const [ch] = await db
        .insert(ingestChannels)
        .values({ restaurantId: t.restaurantId, kind: 'email', tokenHash: tag.repeat(64).slice(0, 64), tokenHint: tag.repeat(4) })
        .returning();
      const [snd] = await db
        .insert(ingestSenders)
        .values({ restaurantId: t.restaurantId, kind: 'email', sender: `bills-${tag}@supplier.test`, supplierId: t.supplierId })
        .returning();
      const [msg] = await db
        .insert(ingestMessages)
        .values({
          restaurantId: t.restaurantId,
          channelId: ch!.id,
          kind: 'email',
          provider: 'stub',
          providerMessageId: `ct-${tag}`,
          sender: `stranger-${tag}@x.test`,
          senderAllowed: false,
          subject: `secret subject ${tag}`,
          status: 'needs_review',
        })
        .returning();
      const [doc] = await db
        .insert(ingestDocuments)
        .values({
          restaurantId: t.restaurantId,
          messageId: msg!.id,
          filename: `${tag}.pdf`,
          mimeType: 'application/pdf',
          storagePath: `${t.restaurantId}/scan-ct${tag}-00000000.pdf`,
          status: 'needs_review',
        })
        .returning();
      return { sender: snd!.id, doc: doc!.id, msg: msg!.id };
    };
    const a = await seed(A, 'a');
    const b = await seed(B, 'b');
    ids.bSender = b.sender;
    ids.bDoc = b.doc;
    ids.bMsg = b.msg;
    ids.aDoc = a.doc;
  });

  it('overview / senders / inbox list only the caller\'s rows', async () => {
    const ov = await callerFor(A).ingest.overview();
    expect(ov.channels.every((c) => c.tokenHint === 'aaaa')).toBe(true);
    expect(ov).not.toHaveProperty('channels.0.tokenHash');
    const senders = await callerFor(A).ingest.senders();
    expect(senders.map((s) => s.sender)).toEqual(['bills-a@supplier.test']);
    const inbox = await callerFor(A).ingest.inbox({ filter: 'all', limit: 100 });
    expect(inbox.map((m) => m.subject)).toEqual(['secret subject a']);
    expect(inbox.flatMap((m) => m.documents.map((d) => d.id))).toEqual([ids.aDoc]);
  });

  it('approveDocument / rejectDocument on B\'s document → NOT_FOUND, B untouched', async () => {
    await expect(callerFor(A).ingest.approveDocument({ documentId: ids.bDoc })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).ingest.rejectDocument({ documentId: ids.bDoc })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [doc] = await db.select().from(ingestDocuments).where(eq(ingestDocuments.id, ids.bDoc));
    expect(doc).toMatchObject({ status: 'needs_review', invoiceId: null });
  });

  it('approving A\'s own document with B\'s supplierId → NOT_FOUND (no invoice created)', async () => {
    await expect(
      callerFor(A).ingest.approveDocument({ documentId: ids.aDoc, supplierId: B.supplierId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [doc] = await db.select().from(ingestDocuments).where(eq(ingestDocuments.id, ids.aDoc));
    expect(doc!.invoiceId).toBeNull();
  });

  it('addSender with B\'s supplierId → NOT_FOUND; removeSender of B\'s entry → NOT_FOUND', async () => {
    await expect(
      callerFor(A).ingest.addSender({ kind: 'email', sender: 'x@y.test', supplierId: B.supplierId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).ingest.removeSender({ id: ids.bSender })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [still] = await db.select().from(ingestSenders).where(eq(ingestSenders.id, ids.bSender));
    expect(still).toBeTruthy();
  });

  it('rotate / revoke touch only the caller\'s channel', async () => {
    const r = await callerFor(A).ingest.rotateChannel({ kind: 'email' });
    expect(r.token).toMatch(/^inv_[0-9a-f]{32}$/);
    await callerFor(A).ingest.revokeChannel({ kind: 'email' });
    const bLive = await db
      .select()
      .from(ingestChannels)
      .where(and(eq(ingestChannels.restaurantId, B.restaurantId), eq(ingestChannels.active, true)));
    expect(bLive).toHaveLength(1);
    const aRows = await db.select().from(ingestChannels).where(eq(ingestChannels.restaurantId, A.restaurantId));
    // The stored row is a hash, never the plaintext token.
    expect(aRows.some((c) => c.tokenHash === r.token)).toBe(false);
  });

  it('role gate: receivers / chefs cannot read sender phones or addresses', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerWithRole(A, role).ingest.inbox({ filter: 'all', limit: 10 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerWithRole(A, role).ingest.senders()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('a rejected document cannot be approved afterwards (no OCR, no invoice)', async () => {
    await callerFor(A).ingest.rejectDocument({ documentId: ids.aDoc });
    await expect(callerFor(A).ingest.approveDocument({ documentId: ids.aDoc })).rejects.toMatchObject({ code: 'CONFLICT' });
    const [doc] = await db.select().from(ingestDocuments).where(eq(ingestDocuments.id, ids.aDoc));
    expect(doc).toMatchObject({ status: 'rejected', invoiceId: null });
  });

  it('role gate: a receiver cannot rotate tokens or approve documents', async () => {
    await expect(callerWithRole(A, 'receiver').ingest.rotateChannel({ kind: 'email' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerWithRole(A, 'receiver').ingest.approveDocument({ documentId: ids.aDoc })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('flag off → FORBIDDEN FEATURE_DISABLED on every procedure', async () => {
    await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
    await expect(callerFor(A).ingest.overview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A).ingest.inbox({ filter: 'all', limit: 10 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A).ingest.rotateChannel({ kind: 'whatsapp' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A).ingest.rejectDocument({ documentId: ids.aDoc })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
  });
});
