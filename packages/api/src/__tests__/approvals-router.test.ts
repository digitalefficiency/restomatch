import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { eq } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { MockWhatsAppNotifier } from '../notifications';

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

async function resetDb() {
  // Claims are born at decision time (W2-10a) and reference the discrepancy.
  await db.delete(recoveryEvents);
  await db.delete(recoveryClaims);
  await db.delete(notificationsOutbox);
  await db.delete(auditLog);
  // W2-10a: approve makes the claim at the decision — claims block discrepancy deletes, clear them first.
  await db.delete(recoveryEvents);
  await db.delete(recoveryClaims);
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

interface Scenario {
  restaurantId: string;
  ownerId: string;
  managerId: string;
  bookkeeperId: string;
  matchRunId: string;
  discrepancyOwnerId: string;
  discrepancyManagerId: string;
}

async function seed(): Promise<Scenario> {
  const [r] = await db.insert(restaurants).values({ name: 'Approvals Bistro' }).returning();
  const owner = await db.insert(users).values({ email: 'owner@a.test' }).returning();
  const manager = await db.insert(users).values({ email: 'mgr@a.test' }).returning();
  const bookkeeper = await db.insert(users).values({ email: 'bk@a.test' }).returning();
  await db.insert(memberships).values([
    { userId: owner[0]!.id, restaurantId: r!.id, role: 'owner' },
    { userId: manager[0]!.id, restaurantId: r!.id, role: 'manager' },
    { userId: bookkeeper[0]!.id, restaurantId: r!.id, role: 'bookkeeper' },
  ]);

  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: r!.id, overallStatus: 'major', totalDiscrepancyAmount: '500' })
    .returning();

  const [dOwner] = await db
    .insert(discrepancies)
    .values({
      restaurantId: r!.id,
      matchRunId: mr!.id,
      type: 'PRICE_HIGHER',
      severity: 'block',
      deltaAmount: '300',
      requiresRole: 'owner',
      resolutionStatus: 'open',
    })
    .returning();

  const [dManager] = await db
    .insert(discrepancies)
    .values({
      restaurantId: r!.id,
      matchRunId: mr!.id,
      type: 'QTY_OVER',
      severity: 'warn',
      deltaAmount: '80',
      requiresRole: 'manager',
      resolutionStatus: 'open',
    })
    .returning();

  return {
    restaurantId: r!.id,
    ownerId: owner[0]!.id,
    managerId: manager[0]!.id,
    bookkeeperId: bookkeeper[0]!.id,
    matchRunId: mr!.id,
    discrepancyOwnerId: dOwner!.id,
    discrepancyManagerId: dManager!.id,
  };
}

function caller(session: { userId: string; restaurantId: string; role: 'owner' | 'manager' | 'bookkeeper' }) {
  // adminDb: the owner connection the web passes (escalation reads the owners' addresses on it).
  const ctx: AppContext = { db, adminDb: db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(resetDb);
afterAll(resetDb);

describe('approvals.myQueue', () => {
  it('manager sees only manager-routed discrepancies', async () => {
    const s = await seed();
    const queue = await caller({
      userId: s.managerId,
      restaurantId: s.restaurantId,
      role: 'manager',
    }).approvals.myQueue();
    expect(queue.map((q) => q.id)).toEqual([s.discrepancyManagerId]);
  });

  it('owner sees both manager- and owner-routed', async () => {
    const s = await seed();
    const queue = await caller({
      userId: s.ownerId,
      restaurantId: s.restaurantId,
      role: 'owner',
    }).approvals.myQueue();
    expect(queue.map((q) => q.id).sort()).toEqual(
      [s.discrepancyOwnerId, s.discrepancyManagerId].sort(),
    );
  });

  it('bookkeeper sees bookkeeper-routed only (none here)', async () => {
    const s = await seed();
    const queue = await caller({
      userId: s.bookkeeperId,
      restaurantId: s.restaurantId,
      role: 'bookkeeper',
    }).approvals.myQueue();
    expect(queue).toEqual([]);
  });

  it('hides the ₪0 QTY_SHORT twin of a short delivery billed in full', async () => {
    const s = await seed();
    const [zero] = await db
      .insert(discrepancies)
      .values({
        matchRunId: s.matchRunId,
        restaurantId: s.restaurantId,
        type: 'QTY_SHORT',
        severity: 'warn',
        deltaAmount: '0',
        requiresRole: 'manager',
        resolutionStatus: 'open',
      })
      .returning();
    const [real] = await db
      .insert(discrepancies)
      .values({
        matchRunId: s.matchRunId,
        restaurantId: s.restaurantId,
        type: 'QTY_SHORT',
        severity: 'warn',
        deltaAmount: '16',
        requiresRole: 'manager',
        resolutionStatus: 'open',
      })
      .returning();
    const queue = await caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' }).approvals.myQueue();
    const ids = queue.map((q) => q.id);
    expect(ids).not.toContain(zero!.id);
    expect(ids).toContain(real!.id);
    expect(ids).toContain(s.discrepancyManagerId);
  });

  it('respects multi-tenant isolation', async () => {
    const s = await seed();
    const [other] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    const [u] = await db.insert(users).values({ email: 'mgr@other.test' }).returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, restaurantId: other!.id, role: 'manager' });
    const queue = await caller({
      userId: u!.id,
      restaurantId: other!.id,
      role: 'manager',
    }).approvals.myQueue();
    expect(queue).toEqual([]);
  });
});

describe('approvals.approve / reject / escalate', () => {
  it('manager can approve manager-routed discrepancy and writes audit log', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.approve({
      discrepancyId: s.discrepancyManagerId,
      note: 'בדקתי, בסדר',
    });
    expect(updated.resolutionStatus).toBe('accepted');

    const audits = await db.select().from(auditLog);
    const matching = audits.find((a) => a.entityId === s.discrepancyManagerId);
    expect(matching?.action).toBe('discrepancy.approved');
  });

  it('manager cannot approve owner-only discrepancy', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    await expect(
      c.approvals.approve({ discrepancyId: s.discrepancyOwnerId }),
    ).rejects.toThrow(/role manager/);
  });

  it('owner can approve owner-routed discrepancy', async () => {
    const s = await seed();
    const c = caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    const updated = await c.approvals.approve({ discrepancyId: s.discrepancyOwnerId });
    expect(updated.resolutionStatus).toBe('accepted');
  });

  it('reject requires a reason', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    await expect(
      c.approvals.reject({ discrepancyId: s.discrepancyManagerId, reason: '' }),
    ).rejects.toThrow();
  });

  it('reject sets resolution to rejected with note', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.reject({
      discrepancyId: s.discrepancyManagerId,
      reason: 'ספק טען שזה מחיר נכון לעונה',
    });
    expect(updated.resolutionStatus).toBe('rejected');
    expect(updated.resolutionNote).toBe('ספק טען שזה מחיר נכון לעונה');
  });

  it('escalate moves required_role to owner and logs', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.escalate({
      discrepancyId: s.discrepancyManagerId,
      note: 'צריך החלטה גבוהה יותר',
    });
    expect(updated.resolutionStatus).toBe('escalated');
    expect(updated.requiresRole).toBe('owner');
  });

  it('approve persists actor and timestamp', async () => {
    const s = await seed();
    const before = new Date();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.approve({ discrepancyId: s.discrepancyManagerId });
    expect(updated.resolvedBy).toBe(s.managerId);
    expect(updated.resolvedAt).toBeInstanceOf(Date);
    expect(updated.resolvedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe('approvals.history', () => {
  it('returns the audit log entries for a discrepancy', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    await c.approvals.approve({ discrepancyId: s.discrepancyManagerId, note: 'note A' });

    const history = await c.approvals.history({ discrepancyId: s.discrepancyManagerId });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.action).toBe('discrepancy.approved');
  });
});

describe('MockWhatsAppNotifier', () => {
  it('writes to outbox and marks sent', async () => {
    const s = await seed();
    const notifier = new MockWhatsAppNotifier();
    const result = await notifier.send(db, {
      restaurantId: s.restaurantId,
      channel: 'whatsapp',
      target: '+972-50-1234567',
      subject: 'חריגה חמורה',
      body: 'נדרש אישור שלך לחשבונית',
      relatedEntityType: 'discrepancy',
      relatedEntityId: s.discrepancyOwnerId,
    });
    expect(result.ok).toBe(true);
    expect(result.externalId).toMatch(/^wa-mock-/);

    const rows = await db.select().from(notificationsOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel).toBe('whatsapp');
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.relatedEntityId).toBe(s.discrepancyOwnerId);
  });
});

describe('approvals role deadlock (DUPLICATE_INVOICE → bookkeeper)', () => {
  async function seedBookkeeperItem(s: Scenario) {
    const [d] = await db
      .insert(discrepancies)
      .values({
        restaurantId: s.restaurantId,
        matchRunId: s.matchRunId,
        type: 'DUPLICATE_INVOICE',
        severity: 'block',
        deltaAmount: '117',
        requiresRole: 'bookkeeper',
        resolutionStatus: 'open',
      })
      .returning();
    return d!.id;
  }
  const bk = (s: Scenario) =>
    caller({ userId: s.bookkeeperId, restaurantId: s.restaurantId, role: 'bookkeeper' });

  it('the bookkeeper sees AND can reject a duplicate routed to them', async () => {
    const s = await seed();
    const id = await seedBookkeeperItem(s);
    const queue = await bk(s).approvals.myQueue();
    expect(queue.map((q) => q.id)).toEqual([id]);
    // reject() on a duplicate = "not a duplicate, pay it" — the reason must say that, not "don't pay".
    const updated = await bk(s).approvals.reject({
      discrepancyId: id,
      reason: 'זו חשבונית אחרת, לא כפולה',
      reasonCode: 'not_duplicate',
    });
    expect(updated.resolutionStatus).toBe('rejected');
  });

  it('the bookkeeper can approve and escalate bookkeeper items', async () => {
    const s = await seed();
    const a = await seedBookkeeperItem(s);
    const b = await seedBookkeeperItem(s);
    expect((await bk(s).approvals.approve({ discrepancyId: a })).resolutionStatus).toBe('accepted');
    const esc = await bk(s).approvals.escalate({ discrepancyId: b });
    expect(esc.resolutionStatus).toBe('escalated');
    expect(esc.requiresRole).toBe('owner');
  });

  it('the bookkeeper still cannot act on manager/owner items', async () => {
    const s = await seed();
    await expect(
      bk(s).approvals.approve({ discrepancyId: s.discrepancyManagerId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      bk(s).approvals.reject({ discrepancyId: s.discrepancyOwnerId, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a receiver cannot decide anything', async () => {
    const s = await seed();
    const [rcv] = await db.insert(users).values({ email: 'rcv@a.test' }).returning();
    await db
      .insert(memberships)
      .values({ userId: rcv!.id, restaurantId: s.restaurantId, role: 'receiver' });
    const r = appRouter.createCaller({
      db,
      session: { userId: rcv!.id, restaurantId: s.restaurantId, role: 'receiver' },
    } as AppContext);
    await expect(r.approvals.approve({ discrepancyId: s.discrepancyManagerId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('approvals.myQueue view filters', () => {
  it('filters by discrepancy type and severity', async () => {
    const s = await seed();
    const owner = caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    expect((await owner.approvals.myQueue({ types: ['QTY_OVER'] })).map((q) => q.id)).toEqual([s.discrepancyManagerId]);
    expect((await owner.approvals.myQueue({ severities: ['block'] })).map((q) => q.id)).toEqual([s.discrepancyOwnerId]);
    expect(await owner.approvals.myQueue({ types: ['VAT_MISMATCH'] })).toEqual([]);
  });

  it('rejects unknown filter values', async () => {
    const s = await seed();
    const owner = caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    // @ts-expect-error — not a severity
    await expect(owner.approvals.myQueue({ severities: ['critical'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(owner.approvals.myQueue({ supplierIds: ['nope'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

/* ───────────────────────── W1-07 · money-named approvals ───────────────────────── */

async function insertD(s: Scenario, v: Partial<typeof discrepancies.$inferInsert>) {
  const [d] = await db
    .insert(discrepancies)
    .values({
      restaurantId: s.restaurantId,
      matchRunId: s.matchRunId,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      deltaAmount: '10',
      requiresRole: 'manager',
      resolutionStatus: 'open',
      ...v,
    })
    .returning();
  return d!;
}
/** Give the seed's match run a real invoice, so its rows have ₪ to claim under lib/claims. */
async function attachInvoice(s: Scenario, total = '5000.00') {
  const [i] = await db
    .insert(invoices)
    .values({ restaurantId: s.restaurantId, source: 'manual', status: 'matched', totalInclVat: total })
    .returning();
  await db.update(matchRuns).set({ invoiceId: i!.id }).where(eq(matchRuns.id, s.matchRunId));
}
const eqId = (id: string) => eq(discrepancies.id, id);
const ownerOf = (s: Scenario) => caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
const managerOf = (s: Scenario) => caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });

describe('approvals.myQueue priority order (approvals-14)', () => {
  it('severity first, then the invoice due first, then the biggest ₪', async () => {
    const s = await seed();
    const [sup] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'ספק' }).returning();
    const inv = async (due: string | null) => {
      const [i] = await db
        .insert(invoices)
        .values({ restaurantId: s.restaurantId, supplierId: sup!.id, source: 'manual', status: 'matched', dueDate: due ? new Date(due) : null })
        .returning();
      const [mr] = await db
        .insert(matchRuns)
        .values({ restaurantId: s.restaurantId, invoiceId: i!.id, overallStatus: 'minor', totalDiscrepancyAmount: '0' })
        .returning();
      return mr!.id;
    };
    const late = await inv('2026-11-20');
    const soon = await inv('2026-10-28');
    const a = await insertD(s, { matchRunId: late, deltaAmount: '90' });
    const b = await insertD(s, { matchRunId: soon, deltaAmount: '5' });
    const c = await insertD(s, { matchRunId: soon, deltaAmount: '40' });
    const queue = await ownerOf(s).approvals.myQueue();
    // seed(): owner block ₪300 (no invoice) → first; then warn: due 28.10 (₪40, ₪5), due 20.11 (₪90), no due (₪80, ₪… seed).
    expect(queue[0]!.id).toBe(s.discrepancyOwnerId);
    expect(queue.slice(1, 4).map((q) => q.id)).toEqual([c.id, b.id, a.id]);
  });

  it('offset pages the priority order without gaps or repeats', async () => {
    const s = await seed();
    for (let i = 0; i < 5; i++) await insertD(s, { deltaAmount: String(10 + i) });
    const all = (await ownerOf(s).approvals.myQueue({ limit: 100 })).map((q) => q.id);
    const p1 = (await ownerOf(s).approvals.myQueue({ limit: 3 })).map((q) => q.id);
    const p2 = (await ownerOf(s).approvals.myQueue({ limit: 3, offset: 3 })).map((q) => q.id);
    const p3 = (await ownerOf(s).approvals.myQueue({ limit: 3, offset: 6 })).map((q) => q.id);
    expect([...p1, ...p2, ...p3]).toEqual(all);
    expect(all).toHaveLength(7);
  });

  it('the legacy cursor still pages newest-first (mobile app)', async () => {
    const s = await seed();
    const q = await ownerOf(s).approvals.myQueue({ cursor: new Date(Date.now() + 60_000).toISOString() });
    const times = q.map((r) => r.createdAt.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it('carries the why-line facts: billed qty + unit, ordered qty, PO ref and date', async () => {
    const s = await seed();
    const [sup] = await db.insert(suppliers).values({ restaurantId: s.restaurantId, name: 'שטיינברג' }).returning();
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: s.restaurantId, supplierId: sup!.id, status: 'sent', sourceRef: 'PO-7781', sentAt: new Date('2026-10-14T08:00:00Z') })
      .returning();
    const [pl] = await db
      .insert(poLines)
      .values({ poId: po!.id, qtyOrdered: '2', unit: 'חבית', unitPriceExpected: '522.6' })
      .returning();
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: s.restaurantId, supplierId: sup!.id, source: 'manual', status: 'matched', invoiceNumber: 'ST-24108' })
      .returning();
    const [il] = await db
      .insert(invoiceLines)
      .values({ invoiceId: i!.id, rawDescription: 'בירה', qtyBilled: '2', unit: 'חבית', unitPriceBilled: '575', lineTotal: '1150' })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: s.restaurantId, invoiceId: i!.id, poId: po!.id, overallStatus: 'major', totalDiscrepancyAmount: '104.8' })
      .returning();
    const d = await insertD(s, {
      matchRunId: mr!.id,
      poLineId: pl!.id,
      invoiceLineId: il!.id,
      expectedValue: '522.6',
      actualValue: '575',
      deltaAmount: '104.80',
      toleranceUsed: 'price: ±2% or ₪5',
    });
    const row = (await ownerOf(s).approvals.myQueue()).find((q) => q.id === d.id)!;
    expect(row).toMatchObject({
      qtyBilled: '2.000',
      billedUnit: 'חבית',
      qtyOrdered: '2.000',
      poRef: 'PO-7781',
      invoiceNumber: 'ST-24108',
      supplierName: 'שטיינברג',
    });
    expect(row.poDate?.toISOString()).toBe('2026-10-14T08:00:00.000Z');
  });
});

describe('approvals.queueSummary (approvals-08, functional-flows-07)', () => {
  it('counts the whole queue, not a page: > 50 items, blockers, oldest', async () => {
    const s = await seed();
    for (let i = 0; i < 55; i++) await insertD(s, { deltaAmount: '1.10' });
    const page = await managerOf(s).approvals.myQueue({ limit: 50 });
    const summary = await managerOf(s).approvals.queueSummary();
    expect(page).toHaveLength(50);
    expect(summary.count).toBe(56); // 55 + seed's manager QTY_OVER
    expect(summary.blockers).toBe(0);
    expect(summary.oldestAt).toBeInstanceOf(Date);
    const ownerSummary = await ownerOf(s).approvals.queueSummary();
    expect(ownerSummary.count).toBe(57);
    expect(ownerSummary.blockers).toBe(1);
  });

  it('claimable ₪ follows the lib/claims rule (per-invoice cap) to the agora, and moves after a decision', async () => {
    const s = await seed();
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: s.restaurantId, source: 'manual', status: 'matched', totalInclVat: '150.00' })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: s.restaurantId, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    const big = await insertD(s, { matchRunId: mr!.id, deltaAmount: '104.80' });
    await insertD(s, { matchRunId: mr!.id, deltaAmount: '52.55' });
    // Σ|Δ| = 157.35 but the invoice is ₪150 — the letters claim at most ₪150.
    expect((await managerOf(s).approvals.queueSummary()).claimableIls).toBe(150);
    await managerOf(s).approvals.reject({ discrepancyId: big.id, reason: 'זניח', reasonCode: 'negligible' });
    // G-14 Q3: the leak ledger's tiers — a waiver (rejected) keeps its share of the invoice cap
    // (tier 2, before undecided), so the open line gets what is left: 150 − 104.80 = 45.20,
    // the same "to decide" ₪ the ledger / report / pay run show for this invoice.
    expect((await managerOf(s).approvals.queueSummary()).claimableIls).toBe(45.2);
  });

  it('honours the view filters', async () => {
    const s = await seed();
    const o = ownerOf(s);
    expect((await o.approvals.queueSummary({ types: ['QTY_OVER'] })).count).toBe(1);
    expect((await o.approvals.queueSummary({ severities: ['block'] })).count).toBe(1);
  });

  it("the manager's empty queue still names what waits for others (never 'all handled')", async () => {
    const s = await seed();
    await attachInvoice(s);
    await managerOf(s).approvals.approve({ discrepancyId: s.discrepancyManagerId });
    const sum = await managerOf(s).approvals.queueSummary();
    expect(sum.count).toBe(0);
    expect(sum.others).toEqual({ count: 1, amountIls: 300, byRole: [{ role: 'owner', count: 1, amountIls: 300 }] });
    const bk = await caller({ userId: s.bookkeeperId, restaurantId: s.restaurantId, role: 'bookkeeper' }).approvals.queueSummary();
    expect(bk.count).toBe(0);
    expect(bk.others.count).toBe(1);
  });
});

describe('decisions: verbs, reasons, preconditions (approvals-01/-05/-11)', () => {
  it('the activity title names the money effect from DECISION_COPY', async () => {
    const { DECISION_COPY } = await import('../notifications/templates');
    const { activityEvents } = await import('@restomatch/db');
    const s = await seed();
    await managerOf(s).approvals.approve({ discrepancyId: s.discrepancyManagerId });
    await ownerOf(s).approvals.reject({ discrepancyId: s.discrepancyOwnerId, reason: 'מחיר עודכן בהסכמה', reasonCode: 'price_agreed' });
    const rows = await db.select().from(activityEvents);
    expect(rows.map((r) => r.title).sort()).toEqual([DECISION_COPY.he.approved, DECISION_COPY.he.rejected].sort());
    expect(DECISION_COPY.he).toMatchObject({ approve: 'בקשת זיכוי · {amount}', reject: 'שלמו כפי שחויב', escalate: 'העבירו לבעלים' });
  });

  it('a waive reason chip stores its code in the audit after', async () => {
    const s = await seed();
    await managerOf(s).approvals.reject({ discrepancyId: s.discrepancyManagerId, reason: 'הגיע בפועל', reasonCode: 'received_actual' });
    const [a] = await db.select().from(auditLog);
    expect(a!.after).toMatchObject({ status: 'rejected', reasonCode: 'received_actual', reason: 'הגיע בפועל' });
    expect(a!.before).toMatchObject({ status: 'open', requiresRole: 'manager' });
  });

  it('rejects an unknown reason code', async () => {
    const s = await seed();
    await expect(
      // @ts-expect-error — not a reason code
      managerOf(s).approvals.reject({ discrepancyId: s.discrepancyManagerId, reason: 'x', reasonCode: 'because' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a decided row is CONFLICT for any later decision', async () => {
    const s = await seed();
    await managerOf(s).approvals.reject({ discrepancyId: s.discrepancyManagerId, reason: 'x' });
    await expect(ownerOf(s).approvals.approve({ discrepancyId: s.discrepancyManagerId })).rejects.toMatchObject({ code: 'CONFLICT' });
    const [d] = await db.select().from(discrepancies).where(eqId(s.discrepancyManagerId));
    expect(d!.resolutionStatus).toBe('rejected');
  });
});

describe('approvals.reopen (undo, approvals-04)', () => {
  it('undo of an escalation restores the routing (back to the manager)', async () => {
    const s = await seed();
    await managerOf(s).approvals.escalate({ discrepancyId: s.discrepancyManagerId, note: 'מעל הסמכות שלי' });
    const back = await managerOf(s).approvals.reopen({ discrepancyId: s.discrepancyManagerId });
    expect(back).toMatchObject({ resolutionStatus: 'open', requiresRole: 'manager', resolutionNote: null });
    expect((await managerOf(s).approvals.myQueue()).map((q) => q.id)).toContain(s.discrepancyManagerId);
  });

  it('refuses after the undo window', async () => {
    const s = await seed();
    await managerOf(s).approvals.approve({ discrepancyId: s.discrepancyManagerId });
    const { REOPEN_WINDOW_MS } = await import('../routers/approvals');
    await db.update(auditLog).set({ at: new Date(Date.now() - REOPEN_WINDOW_MS - 1000) });
    await expect(managerOf(s).approvals.reopen({ discrepancyId: s.discrepancyManagerId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('nothing to undo on an open row', async () => {
    const s = await seed();
    await expect(managerOf(s).approvals.reopen({ discrepancyId: s.discrepancyManagerId })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('approval e-mail names the decisions', () => {
  it('uses the same verbs as the queue', async () => {
    const { approvalNeededEmail, DECISION_COPY } = await import('../notifications/templates');
    const { html, text } = approvalNeededEmail({ supplierName: 'שטיינברג', discrepancyCount: 1, atRiskIls: '₪104.80' });
    expect(text).toContain(DECISION_COPY.he.reject);
    // Owner decision 7.11: partner wording, the ₪ slot stripped cleanly (no dangling '·').
    expect(text).toContain(`בקשת זיכוי או ${DECISION_COPY.he.reject}`);
    expect(text).not.toMatch(/דרשו|דרוש מהספק|מהספק|\{amount\}/);
    expect(html).toContain(DECISION_COPY.he.reject);
  });
});

describe('claimability (verbs keyed by type AND claimability)', () => {
  it('myQueue flags each row: warn/block with ₪ is claimable; info, PRICE_LOWER and ₪0 are checks', async () => {
    const s = await seed();
    const info = await insertD(s, { type: 'QTY_SHORT', severity: 'info', deltaAmount: '4.50' });
    const lower = await insertD(s, { type: 'PRICE_LOWER', severity: 'warn', deltaAmount: '-3.00' });
    const zero = await insertD(s, { type: 'UNIT_MISMATCH', severity: 'warn', deltaAmount: '0' });
    const q = await ownerOf(s).approvals.myQueue({ limit: 100 });
    const flag = (id: string) => q.find((r) => r.id === id)!.claimable;
    expect(flag(s.discrepancyOwnerId)).toBe(true);
    expect(flag(s.discrepancyManagerId)).toBe(true);
    expect(flag(info.id)).toBe(false);
    expect(flag(lower.id)).toBe(false);
    expect(flag(zero.id)).toBe(false);
  });

  it('queueSummary splits "להחלטה (₪)" from "לבדיקה (ללא ₪)"', async () => {
    const s = await seed();
    await insertD(s, { type: 'QTY_SHORT', severity: 'info', deltaAmount: '4.50' });
    await insertD(s, { type: 'PRICE_LOWER', severity: 'warn', deltaAmount: '-3.00' });
    const sum = await ownerOf(s).approvals.queueSummary();
    expect(sum.count).toBe(4);
    expect(sum.toDecide.count).toBe(2);
    expect(sum.toReview).toEqual({ count: 2 });
    expect(sum.toDecide.amountIls).toBe(sum.claimableIls);
  });

  it('the others lane sums only claimable ₪', async () => {
    const s = await seed();
    await attachInvoice(s);
    await insertD(s, { type: 'QTY_SHORT', severity: 'info', deltaAmount: '95.23', requiresRole: 'owner' });
    const sum = await managerOf(s).approvals.queueSummary();
    // seed's owner block ₪300 counts; the info ₪95.23 is a check, not money.
    expect(sum.others).toMatchObject({ count: 2, amountIls: 300 });
  });

  it('a tolerance row the engine auto-approved is a waiver: it holds its share of the cap, never claimed; per-row ₪ = the tile (G-14 Q3, M7)', async () => {
    const s = await seed();
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: s.restaurantId, source: 'manual', status: 'matched', totalInclVat: '100.00' })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: s.restaurantId, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    // Cap ₪100. The engine accepted ₪90 within tolerance (rule, no person) — waived, never claimed.
    await insertD(s, { matchRunId: mr!.id, type: 'PRICE_HIGHER', deltaAmount: '90.00', resolutionStatus: 'accepted', ruleId: 'minor-info' });
    const open = await insertD(s, { matchRunId: mr!.id, type: 'QTY_SHORT', deltaAmount: '50.00', requiresRole: 'owner' });
    const q = await ownerOf(s).approvals.myQueue({ limit: 100 });
    const row = q.find((r) => r.id === open.id)!;
    expect(row.claimable).toBe(true);
    // The ledger's tiers: the waived ₪90 holds its share of the ₪100 cap → ₪10 left to decide.
    expect(row.claimAgorot).toBe(1000);
    expect((await ownerOf(s).approvals.queueSummary()).toDecide.amountIls).toBe(10);
  });

  it('one "to decide" ₪ on every screen: a waiver holds its share of a binding cap (G-14 Q3 probe)', async () => {
    const { computeLeakReport, computeInvoiceLeak } = await import('@restomatch/charts');
    const { payRunStatusOf } = await import('../routers/payRun');
    const s = await seed();
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: s.restaurantId, source: 'manual', status: 'matched', totalInclVat: '8.00' })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: s.restaurantId, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    // Cap ₪8: a person waived ₪4 (rejected), ₪5 is still open → ₪4 left to decide.
    await insertD(s, { matchRunId: mr!.id, type: 'QTY_SHORT', deltaAmount: '4.00', resolutionStatus: 'rejected', resolvedAt: new Date() });
    const open = await insertD(s, { matchRunId: mr!.id, type: 'PRICE_HIGHER', deltaAmount: '5.00', requiresRole: 'owner' });
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date());
    const report = await computeLeakReport(db, s.restaurantId, month);
    const pay = payRunStatusOf(await computeInvoiceLeak(db, s.restaurantId, i!.id));
    const sum = await ownerOf(s).approvals.queueSummary();
    const row = (await ownerOf(s).approvals.myQueue({ limit: 100 })).find((r) => r.id === open.id)!;
    expect(report.status.stillOpenIls).toBe(4);
    expect(report.ledgerDriftAgorot).toBe(0);
    expect(pay.pendingIls).toBe(4);
    expect(sum.toDecide.amountIls).toBe(4);
    expect(row.claimAgorot).toBe(400);
  });

  it('an accepted duplicate is logged as a hold, never as a claim', async () => {
    const { DECISION_COPY } = await import('../notifications/templates');
    const { activityEvents } = await import('@restomatch/db');
    const s = await seed();
    const dup = await insertD(s, { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: '1170', requiresRole: 'manager' });
    await managerOf(s).approvals.approve({ discrepancyId: dup.id });
    const [row] = await db.select().from(activityEvents).where(eq(activityEvents.entityId, dup.id));
    expect(row!.title).toBe(DECISION_COPY.he.duplicateHeld);
    expect(row!.title).not.toBe(DECISION_COPY.he.approved);
  });
});

describe('G-14 Q3 round 3: one allocator — live claims first, on every screen', () => {
  const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date());
  async function run(s: Scenario, total: string) {
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: s.restaurantId, source: 'manual', status: 'matched', totalInclVat: total })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: s.restaurantId, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    return { invoiceId: i!.id, matchRunId: mr!.id };
  }
  /** Every screen's figures for one invoice: report, approvals, Ask, pay run and the letters' rule. */
  async function screens(s: Scenario, invoiceId: string) {
    const { computeLeakReport, computeInvoiceLeak } = await import('@restomatch/charts');
    const { payRunStatusOf } = await import('../routers/payRun');
    const { claimableFor } = await import('../ask/tools');
    const { claimableLines, sumClaims } = await import('../lib/claims');
    const report = await computeLeakReport(db, s.restaurantId, month());
    const leak = await computeInvoiceLeak(db, s.restaurantId, invoiceId);
    const pay = payRunStatusOf(leak);
    const queue = await ownerOf(s).approvals.myQueue({ limit: 100 });
    const lines = leak ? claimableLines(leak) : [];
    return {
      report,
      pay,
      toDecide: (await ownerOf(s).approvals.queueSummary()).toDecide.amountIls,
      rowsAgorot: queue.filter((r) => r.invoiceId === invoiceId).reduce((a, r) => a + (r.claimAgorot ?? 0), 0),
      ask: (await claimableFor(db, s.restaurantId, 'en')).totalIls,
      lettersUndecided: sumClaims(lines.filter((c) => c.undecided)),
    };
  }

  it('F1: approve ₪9, approve ₪10 (claim ₪3), reopen the ₪9 → ₪9 to decide on every screen, ₪3 claimed', async () => {
    const s = await seed();
    const { invoiceId, matchRunId } = await run(s, '12.00');
    const c = await insertD(s, { matchRunId, type: 'QTY_SHORT', deltaAmount: '9.00' });
    const a = await insertD(s, { matchRunId, type: 'PRICE_HIGHER', deltaAmount: '10.00' });
    await insertD(s, { matchRunId, type: 'PRICE_HIGHER', deltaAmount: '5.00' });
    await managerOf(s).approvals.approve({ discrepancyId: c.id });
    await managerOf(s).approvals.approve({ discrepancyId: a.id });
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, s.restaurantId));
    expect(Object.fromEntries(claims.map((r) => [r.discrepancyId, r.amountAgorot]))).toEqual({ [c.id]: 900, [a.id]: 300 });
    await managerOf(s).approvals.reopen({ discrepancyId: c.id });
    const v = await screens(s, invoiceId);
    expect(v.report.status.stillOpenIls).toBe(9);
    expect(v.report.status.claimedIls).toBe(3);
    expect(v.report.ledgerDriftAgorot).toBe(0);
    expect(v.toDecide).toBe(9);
    expect(v.rowsAgorot).toBe(900);
    expect(v.ask).toBe(9);
    expect(v.lettersUndecided).toBe(9);
    expect(v.pay.pendingIls).toBe(9);
    expect(v.pay.creditIls).toBe(v.report.status.claimedIls);
  });

  it('b3: an accept holding a live ₪3 claim takes ₪3 of the cap, not its ₪10 — the open ₪5 is ₪5 everywhere', async () => {
    const s = await seed();
    const { invoiceId, matchRunId } = await run(s, '12.00');
    const a = await insertD(s, { matchRunId, deltaAmount: '10.00', resolutionStatus: 'accepted', resolvedAt: new Date(), resolvedBy: s.managerId });
    await db.insert(recoveryClaims).values({ restaurantId: s.restaurantId, discrepancyId: a.id, status: 'claimed', amountAgorot: 300 });
    await insertD(s, { matchRunId, deltaAmount: '5.00' });
    const v = await screens(s, invoiceId);
    expect(v.report.status.stillOpenIls).toBe(5);
    expect(v.report.status.claimedIls).toBe(3);
    expect(v.report.ledgerDriftAgorot).toBe(400); // hero ₪12, found ₪8: the page says so (report-drift-note)
    expect([v.toDecide, v.rowsAgorot / 100, v.ask, v.lettersUndecided, v.pay.pendingIls]).toEqual([5, 5, 5, 5, 5]);
    expect(v.pay.creditIls).toBe(3);
  });

  it('b5: a disputed ₪6 claim on a reopened row is claimed — never also "to decide"', async () => {
    const s = await seed();
    const { invoiceId, matchRunId } = await run(s, '100.00');
    const d = await insertD(s, { matchRunId, deltaAmount: '6.00' });
    await db.insert(recoveryClaims).values({ restaurantId: s.restaurantId, discrepancyId: d.id, status: 'disputed', amountAgorot: 600 });
    const v = await screens(s, invoiceId);
    expect(v.report.status.claimedIls).toBe(6);
    expect(v.report.status.stillOpenIls).toBe(0);
    expect([v.toDecide, v.rowsAgorot, v.ask, v.lettersUndecided, v.pay.pendingIls]).toEqual([0, 0, 0, 0, 0]);
  });

  it('the hand-built mirror (lines without a ledger row: a ריכוז proposal) = the SQL allocator when no claim is involved', async () => {
    const { computeInvoiceLeak } = await import('@restomatch/charts');
    const { claimableLines } = await import('../lib/claims');
    const s = await seed();
    const { invoiceId, matchRunId } = await run(s, '20.00');
    // A binding cap with every tier but live claims: a decided claim, a tolerated and a rejected waiver, open rows.
    // Distinct created_at a second apart: the line's ISO createdAt keeps milliseconds only, while SQL orders by
    // microseconds — rows inserted in the same millisecond would tie in the mirror (a persisted line never
    // goes through it; a proposal's lines always have distinct createdAt).
    const at = (k: number) => new Date(Date.UTC(2026, 9, 1, 8, 0, k));
    await insertD(s, { matchRunId, createdAt: at(1), type: 'QTY_SHORT', deltaAmount: '4.00', resolutionStatus: 'accepted', resolvedAt: new Date(), resolvedBy: s.managerId });
    await insertD(s, { matchRunId, createdAt: at(2), deltaAmount: '3.00', resolutionStatus: 'accepted', ruleId: 'minor-info' });
    await insertD(s, { matchRunId, createdAt: at(3), deltaAmount: '5.00', resolutionStatus: 'rejected', resolvedAt: new Date(), resolvedBy: s.managerId });
    await insertD(s, { matchRunId, createdAt: at(4), deltaAmount: '6.00' });
    await insertD(s, { matchRunId, createdAt: at(5), type: 'QTY_OVER', deltaAmount: '7.00', resolutionStatus: 'escalated', requiresRole: 'owner' });
    const leak = (await computeInvoiceLeak(db, s.restaurantId, invoiceId))!;
    const persisted = claimableLines(leak);
    const handBuilt = claimableLines({ ...leak, lines: leak.lines.map(({ ledger: _l, ...l }) => l) });
    const view = (xs: typeof persisted) => xs.map((c) => [c.line.discrepancyId, c.amount, c.undecided]).sort();
    expect(view(handBuilt)).toEqual(view(persisted));
    expect(persisted.reduce((a, c) => a + c.amount, 0)).toBe(4 + 6 + 2); // 20 − 4 − 3 − 5 = 8 left for the open ₪6 + ₪7
  });

  it('F2: pay run credit = the report\'s claimed ₪ (b2: a live ₪4 claim on a ₪6 accept; b4: an acknowledged claim on a rejected row)', async () => {
    const s = await seed();
    // b2: ₪10 invoice; A ₪6 rejected, its claim written off with ₪0 back; B ₪6 accepted, live ₪4 claim.
    const b2 = await run(s, '10.00');
    const a = await insertD(s, { matchRunId: b2.matchRunId, deltaAmount: '6.00', resolutionStatus: 'rejected', resolvedAt: new Date(), resolvedBy: s.managerId });
    await db.insert(recoveryClaims).values({ restaurantId: s.restaurantId, discrepancyId: a.id, status: 'written_off', amountAgorot: 600 });
    const b = await insertD(s, { matchRunId: b2.matchRunId, deltaAmount: '6.00', resolutionStatus: 'accepted', resolvedAt: new Date(), resolvedBy: s.managerId });
    await db.insert(recoveryClaims).values({ restaurantId: s.restaurantId, discrepancyId: b.id, status: 'claimed', amountAgorot: 400 });
    const v2 = await screens(s, b2.invoiceId);
    expect(v2.report.status.claimedIls).toBe(4);
    expect(v2.pay.creditIls).toBe(v2.report.status.claimedIls);
    expect(v2.pay.status).toBe('claim');
    await db.delete(recoveryClaims);
    await db.delete(discrepancies).where(eq(discrepancies.matchRunId, b2.matchRunId));
    // b4: an acknowledged ₪6 claim on a rejected row → ₪6 claimed, offset in the pay run.
    const b4 = await run(s, '100.00');
    const r = await insertD(s, { matchRunId: b4.matchRunId, deltaAmount: '6.00', resolutionStatus: 'rejected', resolvedAt: new Date(), resolvedBy: s.managerId });
    await db.insert(recoveryClaims).values({ restaurantId: s.restaurantId, discrepancyId: r.id, status: 'acknowledged', amountAgorot: 600 });
    const v4 = await screens(s, b4.invoiceId);
    expect(v4.report.status.claimedIls).toBe(6);
    expect(v4.pay.creditIls).toBe(v4.report.status.claimedIls);
    expect(v4.pay.status).toBe('claim');
  });
});

describe('pre-merge review findings (#141)', () => {
  async function invoiceRun(s: Scenario, total: string) {
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: s.restaurantId, source: 'manual', status: 'matched', totalInclVat: total })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: s.restaurantId, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    return mr!.id;
  }

  it('F1: the before-VAT claimable total never mixes in a VAT amount or an unbilled line', async () => {
    const s = await seed();
    const run = await invoiceRun(s, '1000.00');
    await insertD(s, { matchRunId: run, type: 'PRICE_HIGHER', deltaAmount: '40.00' });
    await insertD(s, { matchRunId: run, type: 'VAT_MISMATCH', deltaAmount: '20.00' });
    await insertD(s, { matchRunId: run, type: 'MISSING_ON_INVOICE', deltaAmount: '30.00' });
    const sum = await managerOf(s).approvals.queueSummary();
    expect(sum.claimableIls).toBe(40);
    expect(sum.vatIls).toBe(20);
  });

  it('F2: the others lane ₪ follows the claims rule (per-invoice cap), not a raw Σ|Δ|', async () => {
    const s = await seed();
    const run = await invoiceRun(s, '150.00');
    await insertD(s, { matchRunId: run, deltaAmount: '104.80', requiresRole: 'owner' });
    await insertD(s, { matchRunId: run, deltaAmount: '52.55', requiresRole: 'owner' });
    const sum = await managerOf(s).approvals.queueSummary();
    // seed's owner ₪300 has no invoice (nothing claimable yet) + this invoice capped at ₪150.
    expect(sum.others.amountIls).toBe(150);
  });

  it('F3: paging after the last loaded row never skips rows decided elsewhere', async () => {
    const s = await seed();
    for (let i = 0; i < 6; i++) await insertD(s, { deltaAmount: String(10 + i) });
    const all = (await ownerOf(s).approvals.myQueue({ limit: 100 })).map((q) => q.id);
    const page1 = all.slice(0, 3);
    // Someone else decides two of the loaded cards.
    await ownerOf(s).approvals.approve({ discrepancyId: page1[0]! });
    await ownerOf(s).approvals.approve({ discrepancyId: page1[1]! });
    const next = (await ownerOf(s).approvals.myQueue({ limit: 3, afterId: page1[2]! })).map((q) => q.id);
    expect(next).toEqual(all.slice(3, 6));
  });

  it('F5: a card made stale by a colleague\'s escalation gets the "already decided" CONFLICT, not FORBIDDEN', async () => {
    const s = await seed();
    const [m2] = await db.insert(users).values({ email: 'mgr2@a.test' }).returning();
    await db.insert(memberships).values({ userId: m2!.id, restaurantId: s.restaurantId, role: 'manager' });
    await caller({ userId: m2!.id, restaurantId: s.restaurantId, role: 'manager' }).approvals.escalate({
      discrepancyId: s.discrepancyManagerId,
    });
    await expect(managerOf(s).approvals.approve({ discrepancyId: s.discrepancyManagerId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  // W2-04: the activity ₪ is no longer a baked string in `detail` (it was
  // formatted once, at write time, in one locale). It is integer agorot in the
  // v2 metadata and the feed formats it at display (W2-13). Stricter than before:
  // no ₪ text is stored at all, and the figures are exact agorot.
  it('F7 + F8: "mark as checked" logs a check, and the activity ₪ is integer agorot in metadata v2', async () => {
    const { DECISION_COPY, } = await import('../notifications/templates');
    const { activityEvents } = await import('@restomatch/db');
    const s = await seed();
    const info = await insertD(s, { type: 'QTY_SHORT', severity: 'info', deltaAmount: '4.50' });
    await managerOf(s).approvals.reject({ discrepancyId: info.id, reason: 'סמנו כנבדק', reasonCode: 'reviewed' });
    await managerOf(s).approvals.approve({ discrepancyId: s.discrepancyManagerId });
    const rows = await db.select().from(activityEvents);
    expect(rows.find((r) => r.entityId === info.id)!.title).toBe(DECISION_COPY.he.reviewed);
    const approved = rows.find((r) => r.entityId === s.discrepancyManagerId)!;
    expect(approved.detail).toBeNull();
    // No invoice behind this row → nothing claimable (0); the gap itself is 8000 agorot.
    expect(approved.metadata).toMatchObject({ v: 2, decision: 'accepted', amountAgorot: 0, deltaAgorot: 8000, supplierName: null });
    expect(rows.every((r) => !/₪/.test(r.detail ?? ''))).toBe(true);
  });
});

describe('myQueue afterId is tenant-scoped', () => {
  it("a foreign row id as afterId returns nothing (its sort key is never read)", async () => {
    const s = await seed();
    const [other] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: other!.id, overallStatus: 'major', totalDiscrepancyAmount: '1' })
      .returning();
    const [foreign] = await db
      .insert(discrepancies)
      .values({ restaurantId: other!.id, matchRunId: mr!.id, type: 'PRICE_HIGHER', severity: 'block', deltaAmount: '1', requiresRole: 'owner', resolutionStatus: 'open' })
      .returning();
    expect(await ownerOf(s).approvals.myQueue({ afterId: foreign!.id })).toEqual([]);
  });
});
