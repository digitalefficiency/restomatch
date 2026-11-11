import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activityEvents, and, createDb, discrepancies, eq, invoices, matchRuns, sql, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { discrepancyKey, loadPriorDecisions, matchActivitySummary } from '../match/persist';
import { resetDb, seedPlans, seedTenant as seedTenantPending, type Tenant } from './fixtures';

/** #216 F3: a match refuses a receipt still being counted; these runs stand on a COUNTED receipt (as match-money). */
async function seedTenant(...args: Parameters<typeof seedTenantPending>): Promise<Tenant> {
  const t = await seedTenantPending(...args);
  await args[0].execute(sql`UPDATE goods_receipts SET status = 'completed' WHERE id = ${t.grId}`);
  return t;
}

/**
 * W2-13: persistMatchRun writes the activity row as v2 metadata (no baked Hebrew or ₪),
 * and an escalation keeps its provenance (who escalated, from which role) across a re-match.
 */
const db = createDb(testDbUrl());

function ownerCaller(t: Tenant) {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } };
  return appRouter.createCaller(ctx);
}

const HEBREW = /[֐-׿]/;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
});
afterAll(() => resetDb(db));

describe('persistMatchRun activity row (v2)', () => {
  it('writes v2 metadata, a machine title, detail null, no ₪ and no Hebrew in title/detail', async () => {
    const A = await seedTenant(db, 'A');
    const res = await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    const [ev] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.restaurantId, A.restaurantId), eq(activityEvents.entityId, res.matchRunId!)));
    expect(ev!.title).toBe(`invoice_matched:${A.invoiceNumber}`);
    expect(ev!.detail).toBeNull();
    expect(`${ev!.title}${ev!.detail ?? ''}`).not.toMatch(/₪/);
    expect(`${ev!.title}${ev!.detail ?? ''}`).not.toMatch(HEBREW);
    const m = ev!.metadata as Record<string, unknown>;
    expect(m).toMatchObject({ v: 2, invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber, supplierName: A.supplierName });
    expect(Number.isInteger(m.leakAgorot)).toBe(true);
    expect(m.leakAgorot).toBe(Math.round((m.leakIls as number) * 100));
  });
});

describe('the v2 leak figures are the feed leak rule (matchActivitySummary), nothing else', () => {
  // The leak story has ONE rule: matchActivitySummary. W1-08 (#211, train B) moves it onto charts'
  // isLeakType() so MISSING_ON_INVOICE is no longer a leak; this pins that persist's v2 metadata is
  // derived from that rule over the run's persisted findings, so the exclusion flows into the feed.
  it('leakCount / leakIls / leakAgorot / reviewCount equal matchActivitySummary over the persisted findings', async () => {
    const A = await seedTenant(db, 'A');
    const res = await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    const findings = await db
      .select({ type: discrepancies.type, severity: discrepancies.severity, deltaAmount: discrepancies.deltaAmount, resolutionStatus: discrepancies.resolutionStatus })
      .from(discrepancies)
      .where(eq(discrepancies.matchRunId, res.matchRunId!));
    const [inv] = await db.select({ total: invoices.totalInclVat }).from(invoices).where(eq(invoices.id, A.invoiceId));
    const [ev] = await db.select().from(activityEvents).where(eq(activityEvents.entityId, res.matchRunId!));
    const m = ev!.metadata as Record<string, unknown>;
    const summary = matchActivitySummary(
      findings.map((f) => ({ ...f, deltaAmount: Number(f.deltaAmount ?? 0) })),
      Number(inv!.total ?? 0),
      { poMatched: m.poMatched as boolean },
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(m).toMatchObject({
      v: 2,
      leakCount: summary.leakCount,
      leakIls: summary.leakIls,
      leakAgorot: Math.round(summary.leakIls * 100),
      reviewCount: summary.reviewCount,
      pendingLink: summary.pendingLink,
    });
  });
});

describe('MISSING_ON_INVOICE is not a leak in the v2 feed figures (W1-08 #211 isLeakType)', () => {
  it('a run with a MISSING_ON_INVOICE line: only the real leak line is counted; leakAgorot follows', () => {
    const f = (type: string, severity: string, deltaAmount: number) => ({ type, severity, deltaAmount, resolutionStatus: 'open' });
    const s = matchActivitySummary([f('MISSING_ON_INVOICE', 'block', 640), f('PRICE_HIGHER', 'warn', 104.8)], 5000, { poMatched: true });
    expect(s.leakCount).toBe(1);
    expect(s.leakIls).toBe(104.8);
    // persist writes exactly these into the v2 metadata (pinned above): leakAgorot = round(leakIls × 100).
    expect(Math.round(s.leakIls * 100)).toBe(10480);
    const only = matchActivitySummary([f('MISSING_ON_INVOICE', 'block', 640)], 5000, { poMatched: true });
    expect(only).toMatchObject({ leakCount: 0, leakIls: 0 });
  });
});

describe('escalation provenance survives a re-match (deep-fix class 14)', () => {
  it('escalate → re-match → same finding key → fromRole and escalatedBy equal', async () => {
    const A = await seedTenant(db, 'A');
    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    const findings = await db
      .select({ id: discrepancies.id, type: discrepancies.type, invoiceLineId: discrepancies.invoiceLineId, poLineId: discrepancies.poLineId, productId: discrepancies.productId, status: discrepancies.resolutionStatus })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(matchRuns.invoiceId, A.invoiceId));
    const target = findings.find((f) => f.status === 'open');
    expect(target, 'the seeded invoice has an open finding').toBeDefined();
    await caller.approvals.escalate({ discrepancyId: target!.id, note: 'for the owner' });

    const before = (await loadPriorDecisions(db, A.restaurantId, A.invoiceId)).find(
      (p) => discrepancyKey(p) === discrepancyKey(target!),
    );
    expect(before?.decision).toMatchObject({ resolutionStatus: 'escalated', escalatedBy: A.ownerUserId, fromRole: 'owner' });

    await caller.match.runForInvoice({ invoiceId: A.invoiceId });

    const after = (await loadPriorDecisions(db, A.restaurantId, A.invoiceId)).find(
      (p) => discrepancyKey(p) === discrepancyKey(target!),
    );
    expect(after?.decision.resolutionStatus).toBe('escalated');
    expect(after?.decision.escalatedBy).toBe(before!.decision.escalatedBy);
    expect(after?.decision.fromRole).toBe(before!.decision.fromRole);
    expect(after?.decision.requiresRole).toBe('owner');
  });
});
