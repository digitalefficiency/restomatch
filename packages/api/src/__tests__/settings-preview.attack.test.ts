/**
 * DS3-06 · settings.previewThresholds — the preview before saving a threshold.
 *
 * Runs on the RLS app role (as production does), seeding on the owner
 * connection. Proves tenant isolation (A's preview counts and names only A's
 * open gaps, even with planted cross-tenant references), the role gate (the
 * count is finance tier; the what-if needs settings.edit = the owner; receiver
 * and chef FORBIDDEN), the read-only guarantee (a READ ONLY transaction; nothing
 * changes anywhere), and fidelity: the answer is what the matching engine and
 * the approvals engine say for the restaurant's own invoice.
 *
 * Seed (fixtures.seedTenant, per tenant): order 10 kg at ₪8.50, received 5 kg
 * (receipt completed here), billed 10 kg at ₪10.00 (₪100 + ₪17 VAT). The real
 * pipeline (buildMatchInputForInvoice → runMatch → persistMatchRun) stores, open:
 * QTY_OVER block ₪50 (billed 5 kg more than received), PRICE_HIGHER block ₪15
 * (+17.6 % a unit), VAT_MISMATCH warn ₪1, and the zero-₪ QTY_SHORT twin (paired,
 * never counted). seedTenant's own hand-made PRICE_HIGHER warn ₪100 sits on an
 * older run of the same invoice: it can never be re-run, so it counts as open.
 */
import { applyCoreTenantRls, ensureRlsAppRole, testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityEvents,
  and,
  auditLog,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  invoices,
  matchRuns,
  notificationsOutbox,
  priceHistory,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { runMatch } from '@restomatch/matching';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { awaitingDecision } from '../approvals/awaiting';
import { buildRules, resolveApprovalThresholds } from '../approvals/engine';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { persistMatchRun } from '../match/persist';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;

let A: Tenant;
let B: Tenant;

function callerWithRole(tenant: Tenant, role: Session['role']) {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db: appDb, session };
  return appRouter.createCaller(ctx);
}
const owner = (t: Tenant) => callerWithRole(t, 'owner');

/** Complete the seeded receipt and match the seeded invoice through the real pipeline, as the job does. */
async function matchSeeded(t: Tenant) {
  await ownerDb.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, t.grId));
  const built = await buildMatchInputForInvoice(ownerDb, t.restaurantId, t.invoiceId, { pinnedPoId: t.poId, strictPin: true });
  if (!built) throw new Error('seed: no match input');
  await persistMatchRun(
    ownerDb,
    { restaurantId: t.restaurantId, invoiceId: t.invoiceId, poId: built.poId, grId: built.grId },
    built.input,
    runMatch(built.input),
    buildRules(resolveApprovalThresholds(undefined)),
  );
  // The persisted run is the invoice's latest; the seeded hand-made run is older.
  await ownerDb
    .update(matchRuns)
    .set({ runAt: new Date(Date.now() - 86_400_000) })
    .where(and(eq(matchRuns.id, t.matchRunId), eq(matchRuns.restaurantId, t.restaurantId)));
}

/** Everything a write could touch, for one tenant. */
async function snapshot(t: Tenant) {
  const count = async (table: typeof discrepancies | typeof matchRuns | typeof auditLog | typeof activityEvents | typeof priceHistory | typeof notificationsOutbox) => {
    const [r] = await ownerDb
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq((table as typeof discrepancies).restaurantId, t.restaurantId));
    return r?.n;
  };
  const rows = await ownerDb
    .select({ id: discrepancies.id, status: discrepancies.resolutionStatus, role: discrepancies.requiresRole })
    .from(discrepancies)
    .where(eq(discrepancies.restaurantId, t.restaurantId))
    .orderBy(discrepancies.id);
  const inv = await ownerDb
    .select({ id: invoices.id, status: invoices.status, ocr: invoices.ocrPayload })
    .from(invoices)
    .where(eq(invoices.restaurantId, t.restaurantId))
    .orderBy(invoices.id);
  const [r] = await ownerDb.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, t.restaurantId));
  return {
    discrepancies: await count(discrepancies),
    runs: await count(matchRuns),
    audit: await count(auditLog),
    activity: await count(activityEvents),
    priceHistory: await count(priceHistory),
    outbox: await count(notificationsOutbox),
    rows: JSON.stringify(rows),
    invoices: JSON.stringify(inv),
    settings: JSON.stringify(r?.settings ?? {}),
  };
}

describe('DS3-06 settings.previewThresholds', () => {
  beforeAll(async () => {
    await resetDb(ownerDb);
    await applyCoreTenantRls(TEST_DB_URL);
    appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
    A = await seedTenant(ownerDb, 'A');
    B = await seedTenant(ownerDb, 'B');
    await matchSeeded(A);
    await matchSeeded(B);
    // B's own thresholds must never colour A's answer.
    await ownerDb
      .update(restaurants)
      .set({ settings: { tolerances: { pricePercent: 0.5, priceAbsolute: 50 } } })
      .where(eq(restaurants.id, B.restaurantId));
  });
  afterAll(async () => {
    await resetDb(ownerDb);
  });

  it('no change: only the real count of open gaps (awaitingDecision), nothing re-run', async () => {
    const p = await owner(A).settings.previewThresholds({});
    // QTY_OVER + PRICE_HIGHER + VAT_MISMATCH from the match, + the seeded row; the zero-₪ twin is left out.
    expect(p).toMatchObject({ openNow: 4, changed: false, wouldOpen: 4, notOpenedCount: 0, evaluatedRuns: 0 });
    // The figure every screen shows: awaitingDecision over all open rows the owner reads.
    const awaiting = await awaitingDecision(ownerDb, { session: { restaurantId: A.restaurantId, role: 'owner' } }, { scope: 'all' });
    expect(p.openNow).toBe(awaiting.count);
    // A proposal that resolves to the values in force is no change either.
    expect((await owner(A).settings.previewThresholds({ tolerances: { pricePercent: 0.02 } })).changed).toBe(false);
  });

  it('a looser price tolerance: the price gap would not have opened, named with its ₪ (A only)', async () => {
    const p = await owner(A).settings.previewThresholds({ tolerances: { pricePercent: 0.25 } });
    expect(p).toMatchObject({
      openNow: 4,
      changed: true,
      evaluatedRuns: 1,
      wouldOpen: 3, // QTY_OVER (block), VAT_MISMATCH, and the seeded row that cannot be re-run
      wouldBlock: 1,
      notOpenedCount: 1,
      notOpenedAgorot: 1500,
      notEvaluated: 1,
    });
    expect(p.notOpened).toEqual([{ label: 'עגבניה A', labelEn: null, amountAgorot: 1500 }]);
    expect(p.proposal.tolerances.pricePercent).toBe(0.25);
    expect(JSON.stringify(p)).not.toMatch(/[עג][גב][בנ]?י[הו]ת? B/);
  });

  it('the unit tolerance: billing over received stops blocking, but the units move to the short gap — still open', async () => {
    // Engine: with 10 units of tolerance, 5 kg billed over 5 received is no QTY_OVER block; the line's
    // QTY_SHORT now carries those 5 kg (info, queued by the cumulative rule). The quantity unit stays open.
    const p = await owner(A).settings.previewThresholds({ tolerances: { qtyAbsolute: 10 } });
    expect(p.notOpenedCount).toBe(0);
    expect(p.wouldOpen).toBe(4);
    expect(p.wouldBlock).toBe(1); // only the price gap still blocks (+17.6 % ≥ 10 %)
  });

  it('a stricter threshold never claims a gap would close', async () => {
    const p = await owner(A).settings.previewThresholds({ tolerances: { pricePercent: 0.01, blockPricePercent: 0.05 } });
    expect(p).toMatchObject({ wouldOpen: 4, wouldBlock: 2, notOpenedCount: 0 });
  });

  it('only the no-PO / unordered amounts changed: nothing can change, nothing is re-run', async () => {
    const p = await owner(A).settings.previewThresholds({ approvalThresholds: { largeInvoiceWithoutPo: 10, unorderedItemSignificant: 1 } });
    expect(p).toMatchObject({ changed: true, evaluatedRuns: 0, notEvaluated: 0, wouldOpen: 4, notOpenedCount: 0 });
  });

  it('null brings a knob back to the engine default (update’s semantics); unreproduced gaps stay counted', async () => {
    await ownerDb.update(restaurants).set({ settings: { tolerances: { pricePercent: 0.25 } } }).where(eq(restaurants.id, A.restaurantId));
    try {
      const p = await owner(A).settings.previewThresholds({ tolerances: { pricePercent: null } });
      // In force (25 %) the stored price gap is not reproduced: it is never attributed, it stays open.
      expect(p).toMatchObject({ changed: true, wouldOpen: 4, wouldBlock: 2, notOpenedCount: 0, notEvaluated: 2 });
    } finally {
      await ownerDb.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
    }
  });

  it('writes nothing, on either tenant (and runs in a read-only transaction)', async () => {
    const beforeA = await snapshot(A);
    const beforeB = await snapshot(B);
    await owner(A).settings.previewThresholds({
      tolerances: { pricePercent: 0.3, qtyAbsolute: 9 },
      approvalThresholds: { cumulativeLargeAmount: 1000 },
    });
    expect(await snapshot(A)).toEqual(beforeA);
    expect(await snapshot(B)).toEqual(beforeB);
  });

  it('B sees only B', async () => {
    const p = await owner(B).settings.previewThresholds({ tolerances: { pricePercent: 0.01 } });
    expect(p.openNow).toBe(4);
    expect(JSON.stringify(p)).not.toContain('עגבניה A');
  });

  it('roles: the count is finance tier; the what-if is the owner’s (settings.edit); receiver and chef FORBIDDEN', async () => {
    for (const role of ['manager', 'bookkeeper'] as const) {
      await expect(callerWithRole(A, role).settings.previewThresholds({})).resolves.toMatchObject({ openNow: 4 });
      await expect(
        callerWithRole(A, role).settings.previewThresholds({ tolerances: { pricePercent: 0.25 } }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerWithRole(A, role).settings.previewThresholds({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('rejects out-of-range and unknown knobs (same schema as update)', async () => {
    await expect(owner(A).settings.previewThresholds({ tolerances: { pricePercent: 2 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(owner(A).settings.previewThresholds({ tolerances: { nope: 1 } } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('planted cross-tenant references: an A gap pointing at B’s product, line, invoice and order leaks nothing of B', async () => {
    const [latestA] = await ownerDb
      .select({ id: matchRuns.id })
      .from(matchRuns)
      .where(and(eq(matchRuns.restaurantId, A.restaurantId), eq(matchRuns.invoiceId, A.invoiceId)))
      .orderBy(sql`${matchRuns.runAt} desc`)
      .limit(1);
    // (1) on A's own latest run, an open gap naming B's product and B's invoice line;
    await ownerDb.insert(discrepancies).values({
      matchRunId: latestA!.id,
      restaurantId: A.restaurantId,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      productId: B.productId,
      invoiceLineId: B.invoiceLineId,
      deltaAmount: '7.00',
      requiresRole: 'manager',
      resolutionStatus: 'open',
    });
    // (2) an A run on B's invoice and B's order, with an open A gap.
    const [foreignRun] = await ownerDb
      .insert(matchRuns)
      .values({ restaurantId: A.restaurantId, invoiceId: B.invoiceId, poId: B.poId, overallStatus: 'major', totalDiscrepancyAmount: '9.00' })
      .returning({ id: matchRuns.id });
    await ownerDb.insert(discrepancies).values({
      matchRunId: foreignRun!.id,
      restaurantId: A.restaurantId,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      productId: B.productId,
      deltaAmount: '9.00',
      requiresRole: 'manager',
      resolutionStatus: 'open',
    });
    const beforeB = await snapshot(B);
    const p = await owner(A).settings.previewThresholds({ tolerances: { pricePercent: 0.25 } });
    expect(p.openNow).toBe(6);
    // Neither planted gap can be re-run or reproduced: both stay open and are never named.
    expect(p.notOpenedCount).toBe(1);
    expect(p.notOpened).toEqual([{ label: 'עגבניה A', labelEn: null, amountAgorot: 1500 }]);
    const text = JSON.stringify(p);
    expect(text).not.toContain('עגבניה B');
    expect(text).not.toContain('עגבניות B');
    expect(await snapshot(B)).toEqual(beforeB);
  });
});
