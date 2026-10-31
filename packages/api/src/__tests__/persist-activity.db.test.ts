import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activityEvents, and, createDb, discrepancies, eq, matchRuns, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { discrepancyKey, loadPriorDecisions } from '../match/persist';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

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
