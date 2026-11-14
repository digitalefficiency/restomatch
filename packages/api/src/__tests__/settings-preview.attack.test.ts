/**
 * DS3-06 · settings.previewThresholds — the preview before saving a threshold.
 *
 * Tenant isolation (A's preview counts and names only A's open gaps), the role
 * gate (finance tier: receiver and chef FORBIDDEN), the read-only guarantee
 * (nothing is written), and fidelity: the answer is what the matching engine
 * and the approvals engine say for the restaurant's own invoice, never a rule
 * re-implemented here.
 *
 * Seed (fixtures.seedTenant, per tenant): order 10 kg at ₪8.50, received 5 kg,
 * billed 10 kg at ₪10.00 (₪100 + ₪17 VAT). The real pipeline then matches it
 * (buildMatchInputForInvoice → runMatch → persistMatchRun), which stores, open:
 * QTY_OVER block ₪50 (billed 5 kg more than received), PRICE_HIGHER block ₪15
 * (+17.6 % a unit), VAT_MISMATCH warn ₪1 — and the zero-₪ QTY_SHORT twin, which
 * the queue (and so the preview) leaves out. seedTenant's own hand-made
 * PRICE_HIGHER row (no line ids) stays open too: the re-run cannot reproduce it,
 * so it is never attributed to a threshold.
 */
import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, createDb, discrepancies, eq, matchRuns, restaurants, sql } from '@restomatch/db';
import { runMatch } from '@restomatch/matching';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { buildRules, resolveApprovalThresholds } from '../approvals/engine';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { persistMatchRun } from '../match/persist';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());

let A: Tenant;
let B: Tenant;

function callerWithRole(tenant: Tenant, role: Session['role']) {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

/** Match the seeded invoice through the real pipeline, as the worker does. */
async function matchSeeded(t: Tenant) {
  const built = await buildMatchInputForInvoice(db, t.restaurantId, t.invoiceId, { pinnedPoId: t.poId });
  if (!built) throw new Error('seed: no match input');
  const out = runMatch(built.input);
  await persistMatchRun(
    db,
    { restaurantId: t.restaurantId, invoiceId: t.invoiceId, poId: built.poId, grId: built.grId },
    built.input,
    out,
    buildRules(resolveApprovalThresholds(undefined)),
  );
}

async function counts(t: Tenant) {
  const [d] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(discrepancies)
    .where(eq(discrepancies.restaurantId, t.restaurantId));
  const [m] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(matchRuns)
    .where(eq(matchRuns.restaurantId, t.restaurantId));
  const [a] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(eq(auditLog.restaurantId, t.restaurantId));
  const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, t.restaurantId));
  return { discrepancies: d?.n, runs: m?.n, audit: a?.n, settings: JSON.stringify(r?.settings ?? {}) };
}

describe('DS3-06 settings.previewThresholds', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    await matchSeeded(A);
    await matchSeeded(B);
    // B's own thresholds must never colour A's answer.
    await db
      .update(restaurants)
      .set({ settings: { tolerances: { pricePercent: 0.5, priceAbsolute: 50 } } })
      .where(eq(restaurants.id, B.restaurantId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('no change: only the real count of open gaps, nothing re-run', async () => {
    const p = await callerWithRole(A, 'owner').settings.previewThresholds({});
    // QTY_OVER + PRICE_HIGHER + VAT_MISMATCH from the match, + the seeded row; the zero-₪ twin is left out.
    expect(p).toMatchObject({ openNow: 4, changed: false, considered: 0, notOpenedCount: 0, evaluatedInvoices: 0 });
    // A proposal equal to the engine default is no change either.
    const same = await callerWithRole(A, 'owner').settings.previewThresholds({ tolerances: { pricePercent: 0.02 } });
    expect(same.changed).toBe(false);
  });

  it('a looser price tolerance: the price gap would not have opened, named with its ₪ (A only)', async () => {
    const p = await callerWithRole(A, 'owner').settings.previewThresholds({ tolerances: { pricePercent: 0.25 } });
    expect(p.changed).toBe(true);
    expect(p.openNow).toBe(4);
    expect(p.evaluatedInvoices).toBe(1);
    // The seeded hand-made row is not reproduced by today's re-run: never attributed.
    expect(p.considered).toBe(3);
    expect(p.wouldOpen).toBe(2); // QTY_OVER (block) + VAT_MISMATCH
    expect(p.wouldBlock).toBe(1);
    expect(p.notOpenedCount).toBe(1);
    expect(p.notOpenedAgorot).toBe(1500);
    expect(p.notOpened).toEqual([{ label: 'עגבניה A', amountAgorot: 1500 }]);
    expect(p.considered).toBe(p.wouldOpen + p.notOpenedCount);
    expect(JSON.stringify(p)).not.toContain('עגבניה B');
  });

  it('the unit tolerance decides when billing more than was received opens (engine rule, not ours)', async () => {
    const p = await callerWithRole(A, 'owner').settings.previewThresholds({ tolerances: { qtyAbsolute: 10 } });
    // 5 kg billed over 5 received is within 10 units: no QTY_OVER block.
    expect(p.notOpened).toEqual([{ label: 'עגבניה A', amountAgorot: 5000 }]);
    expect(p.wouldOpen).toBe(2); // PRICE_HIGHER + VAT_MISMATCH
    expect(p.wouldBlock).toBe(1); // the price gap still blocks (+17.6 % ≥ 10 %)
  });

  it('a stricter threshold never claims a gap would close', async () => {
    const p = await callerWithRole(A, 'owner').settings.previewThresholds({
      tolerances: { pricePercent: 0.01, blockPricePercent: 0.05 },
    });
    expect(p.considered).toBe(3);
    expect(p.wouldOpen).toBe(3);
    expect(p.notOpenedCount).toBe(0);
  });

  it('null brings a knob back to the engine default (update’s semantics)', async () => {
    await db
      .update(restaurants)
      .set({ settings: { tolerances: { pricePercent: 0.25 } } })
      .where(eq(restaurants.id, A.restaurantId));
    try {
      // In force: 25 % (the price gap would not open today) → back to the 2 % default: it would.
      const p = await callerWithRole(A, 'owner').settings.previewThresholds({ tolerances: { pricePercent: null } });
      expect(p.changed).toBe(true);
      // Today's re-run (25 %) does not reproduce the stored price gap, so it is not attributed.
      expect(p.considered).toBe(2);
      expect(p.notOpenedCount).toBe(0);
    } finally {
      await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
    }
  });

  it('writes nothing: discrepancies, runs, audit rows and settings are untouched on both tenants', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    await callerWithRole(A, 'owner').settings.previewThresholds({
      tolerances: { pricePercent: 0.3, qtyAbsolute: 9 },
      approvalThresholds: { cumulativeLargeAmount: 1000 },
    });
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  it('B sees only B: its own count, its own product names', async () => {
    const p = await callerWithRole(B, 'owner').settings.previewThresholds({ tolerances: { pricePercent: 0.01 } });
    expect(p.openNow).toBe(4);
    expect(JSON.stringify(p)).not.toContain('עגבניה A');
  });

  it('finance tier: manager and bookkeeper may preview; receiver and chef are FORBIDDEN', async () => {
    for (const role of ['manager', 'bookkeeper'] as const) {
      await expect(callerWithRole(A, role).settings.previewThresholds({})).resolves.toMatchObject({ openNow: 4 });
    }
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerWithRole(A, role).settings.previewThresholds({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('rejects out-of-range and unknown knobs (same schema as update)', async () => {
    await expect(
      callerWithRole(A, 'owner').settings.previewThresholds({ tolerances: { pricePercent: 2 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callerWithRole(A, 'owner').settings.previewThresholds({ tolerances: { nope: 1 } } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
