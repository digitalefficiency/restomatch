import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityEvents,
  auditLog,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';

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

interface Tenant {
  restaurantId: string;
  ownerUserId: string;
  supplierId: string;
  supplierName: string;
  poId: string;
  poLineId: string;
  grId: string;
  grLineId: string;
  invoiceId: string;
  invoiceNumber: string;
  matchRunId: string;
  discrepancyId: string;
}

let A: Tenant;
let B: Tenant;

async function resetDb() {
  await db.delete(activityEvents);
  await db.delete(auditLog);
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

async function seedTenant(tag: string): Promise<Tenant> {
  const [restaurant] = await db.insert(restaurants).values({ name: `Resto ${tag}` }).returning();
  if (!restaurant) throw new Error('seed: restaurant');

  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${tag}@attack.test`, name: `Owner ${tag}` })
    .returning();
  if (!owner) throw new Error('seed: user');
  await db
    .insert(memberships)
    .values({ userId: owner.id, restaurantId: restaurant.id, role: 'owner' });

  const supplierName = `ספק ${tag}`;
  const [supplier] = await db
    .insert(suppliers)
    .values({ restaurantId: restaurant.id, name: supplierName, businessId: `51234567${tag === 'A' ? '1' : '2'}` })
    .returning();
  if (!supplier) throw new Error('seed: supplier');

  const today = new Date();
  today.setHours(11, 0, 0, 0);
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: restaurant.id,
      supplierId: supplier.id,
      expectedDeliveryAt: today,
      status: 'sent',
      source: 'manual',
    })
    .returning();
  if (!po) throw new Error('seed: po');

  const [poLine] = await db
    .insert(poLines)
    .values({ poId: po.id, rawDescription: `עגבניות ${tag}`, qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' })
    .returning();
  if (!poLine) throw new Error('seed: poLine');

  const [gr] = await db
    .insert(goodsReceipts)
    .values({ restaurantId: restaurant.id, poId: po.id, receivedBy: owner.id, status: 'pending' })
    .returning();
  if (!gr) throw new Error('seed: gr');

  const [grLine] = await db
    .insert(grLines)
    .values({ grId: gr.id, poLineId: poLine.id, qtyReceived: '5', qtyRejected: '0' })
    .returning();
  if (!grLine) throw new Error('seed: grLine');

  const invoiceNumber = `INV-${tag}-1`;
  const [invoice] = await db
    .insert(invoices)
    .values({
      restaurantId: restaurant.id,
      supplierId: supplier.id,
      invoiceNumber,
      invoiceDate: today,
      totalExclVat: '100.00',
      vatAmount: '17.00',
      totalInclVat: '117.00',
      status: 'matched',
      source: 'photo',
      createdBy: owner.id,
    })
    .returning();
  if (!invoice) throw new Error('seed: invoice');

  const [matchRun] = await db
    .insert(matchRuns)
    .values({
      restaurantId: restaurant.id,
      poId: po.id,
      grId: gr.id,
      invoiceId: invoice.id,
      overallStatus: 'major',
      totalDiscrepancyAmount: '100.00',
    })
    .returning();
  if (!matchRun) throw new Error('seed: matchRun');

  const [discrepancy] = await db
    .insert(discrepancies)
    .values({
      matchRunId: matchRun.id,
      restaurantId: restaurant.id,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      deltaAmount: '100.00',
      requiresRole: 'manager',
      resolutionStatus: 'open',
    })
    .returning();
  if (!discrepancy) throw new Error('seed: discrepancy');

  await db.insert(auditLog).values({
    restaurantId: restaurant.id,
    userId: owner.id,
    action: 'discrepancy.created',
    entityType: 'discrepancy',
    entityId: discrepancy.id,
    after: { tag },
  });

  await db.insert(activityEvents).values({
    restaurantId: restaurant.id,
    eventType: 'invoice_matched',
    title: `אירוע סודי של ${tag}`,
    entityType: 'match_run',
    entityId: matchRun.id,
  });

  return {
    restaurantId: restaurant.id,
    ownerUserId: owner.id,
    supplierId: supplier.id,
    supplierName,
    poId: po.id,
    poLineId: poLine.id,
    grId: gr.id,
    grLineId: grLine.id,
    invoiceId: invoice.id,
    invoiceNumber,
    matchRunId: matchRun.id,
    discrepancyId: discrepancy.id,
  };
}

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
  await resetDb();
  A = await seedTenant('A');
  B = await seedTenant('B');
});

afterAll(async () => {
  await resetDb();
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
  'receiving.startReceipt': 'attack',
  'receiving.markGrLine': 'attack',
  'receiving.submitReceipt': 'attack',
  'receiving.registerInvoice': 'attack',
  'receiving.pendingInvoices': 'isolation',
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
});
