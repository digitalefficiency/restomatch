import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, recoveryClaims, restaurants, testDbUrl } from '@restomatch/db';
import { OVERDUE_BOUNDARY_CASES, OVERDUE_BOUNDARY_NOW } from '../lib/claims';
import { vatAtRisk } from '../vat/vatAtRisk';
import { __resetOpsSources, __setOpsSources, israelWeek, runOpsTool, type OpsContext } from '../ask/opsTools';
import { classifyQuestion } from '../ask/offline';
import { runTool, TOOL_DEFINITIONS } from '../ask/tools';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-06 · the five "what needs me" tools on a seeded tenant. Tenant B always
 * holds BIGGER numbers, so a cross-tenant leak would show in every figure.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const NOW = new Date(OVERDUE_BOUNDARY_NOW); // 2026-10-25 13:00 Israel (a Sunday)

const ctx = (t: Tenant, over: Partial<OpsContext> = {}): OpsContext => ({
  db,
  restaurantId: t.restaurantId,
  role: 'owner',
  now: NOW,
  locale: 'he',
  ...over,
});

async function setFeatures(t: Tenant, features: Record<string, boolean>) {
  await db.update(restaurants).set({ settings: { features } as never }).where(eq(restaurants.id, t.restaurantId));
}

/** One claim on its own discrepancy (claims are one per discrepancy). */
async function claim(
  t: Tenant,
  over: Partial<typeof recoveryClaims.$inferInsert> & { type?: 'PRICE_HIGHER' | 'QTY_SHORT' | 'MISSING_ON_INVOICE' },
): Promise<string> {
  const { type = 'PRICE_HIGHER', ...rest } = over;
  const [d] = await db
    .insert(discrepancies)
    .values({
      matchRunId: t.matchRunId,
      restaurantId: t.restaurantId,
      type,
      severity: 'warn',
      deltaAmount: '10.00',
      resolutionStatus: 'accepted',
    })
    .returning({ id: discrepancies.id });
  const [c] = await db
    .insert(recoveryClaims)
    .values({
      restaurantId: t.restaurantId,
      discrepancyId: d!.id,
      supplierId: t.supplierId,
      invoiceId: t.invoiceId,
      amountAgorot: 1000,
      status: 'claimed',
      claimedAt: NOW,
      ...rest,
    })
    .returning({ id: recoveryClaims.id });
  return c!.id;
}

async function clearClaims() {
  await db.delete(recoveryClaims);
  for (const t of [A, B]) {
    const keep = t.discrepancyId;
    const rows = await db.select({ id: discrepancies.id }).from(discrepancies).where(eq(discrepancies.restaurantId, t.restaurantId));
    for (const r of rows) if (r.id !== keep) await db.delete(discrepancies).where(eq(discrepancies.id, r.id));
  }
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
beforeEach(async () => {
  await setFeatures(A, { all: true });
  await setFeatures(B, { all: true });
  await clearClaims();
});
afterEach(() => __resetOpsSources());
afterAll(async () => {
  await resetDb(db);
});

describe('who_owes_me (recovery listClaims + overdueSql)', () => {
  it('sums outstanding (amount − credited) per supplier in integer agorot, ₪ at the edge; tenant B never appears', async () => {
    await claim(A, { amountAgorot: 12_345 });
    await claim(A, { amountAgorot: 5_000, creditedAgorot: 1_999, status: 'acknowledged' });
    await claim(A, { amountAgorot: 7_000, status: 'recovered', creditedAgorot: 7_000 }); // closed: not owed
    await claim(B, { amountAgorot: 9_999_900 });

    const r = await runOpsTool('who_owes_me', {}, ctx(A));
    expect(r.data).toMatchObject({ available: true, supplierCount: 1, claimCount: 2, outstandingIls: 153.46 });
    const d = r.data as { suppliers: Array<{ supplierId: string; outstandingIls: number }> };
    expect(d.suppliers).toEqual([expect.objectContaining({ supplierId: A.supplierId, outstandingIls: 153.46 })]);
    expect(JSON.stringify(r.data)).not.toContain(B.supplierId);
    expect(r.links.map((l) => l.href)).toContain('/dashboard/recovery');
    expect(r.links.map((l) => l.href)).toContain(`/dashboard/suppliers/${A.supplierId}`);
  });

  it('never counts a never-claimable type (owner 31.10: MISSING_ON_INVOICE) as owed', async () => {
    await claim(A, { type: 'MISSING_ON_INVOICE', amountAgorot: 4_000, letterSentAt: new Date('2026-10-01T09:00:00Z') });
    const r = await runOpsTool('who_owes_me', {}, ctx(A));
    expect(r.data).toMatchObject({ available: true, supplierCount: 0, outstandingIls: 0, overdueIls: 0 });
  });

  it.each(OVERDUE_BOUNDARY_CASES)('overdue boundary: letter $letterSentAt → overdue=$overdue ($why)', async (c) => {
    await claim(A, { status: 'letter_sent', letterSentAt: new Date(c.letterSentAt), claimedAt: new Date(c.letterSentAt) });
    const r = await runOpsTool('who_owes_me', {}, ctx(A));
    const d = r.data as { overdueIls: number; suppliers: Array<{ overdue: boolean }> };
    expect(d.suppliers[0]!.overdue).toBe(c.overdue);
    expect(d.overdueIls).toBe(c.overdue ? 10 : 0);
  });

  it('a claim reminded yesterday still counts as owed and overdue (no re-chase gate)', async () => {
    await claim(A, {
      status: 'letter_sent',
      letterSentAt: new Date('2026-10-10T09:00:00Z'),
      claimedAt: new Date('2026-10-10T09:00:00Z'),
      lastReminderAt: new Date('2026-10-24T05:30:00Z'),
    });
    const r = await runOpsTool('who_owes_me', {}, ctx(A));
    expect(r.data).toMatchObject({ outstandingIls: 10, overdueIls: 10, overdueSupplierCount: 1 });
    expect((r.data as { suppliers: Array<{ oldestWaitingDays: number }> }).suppliers[0]!.oldestWaitingDays).toBe(15);
  });

  it('recovery off → an honest "not available", never ₪0', async () => {
    await setFeatures(A, { aiAssistant: true });
    const r = await runOpsTool('who_owes_me', {}, ctx(A));
    expect(r.data).toEqual({ available: false, reason: 'feature_off', feature: 'recovery' });
  });
});

describe('vat_at_risk (vat/vatAtRisk — its own figure)', () => {
  beforeEach(async () => {
    // A: one invoice above the threshold with no allocation number; B: a bigger one.
    await db
      .update(invoices)
      .set({ invoiceDate: new Date('2026-10-20T08:00:00Z'), totalExclVat: '12000.00', vatAmount: '2160.00', allocationNumber: null, status: 'matched' })
      .where(eq(invoices.id, A.invoiceId));
    await db
      .update(invoices)
      .set({ invoiceDate: new Date('2026-10-20T08:00:00Z'), totalExclVat: '90000.00', vatAmount: '16200.00', allocationNumber: null, status: 'matched' })
      .where(eq(invoices.id, B.invoiceId));
  });

  it('equals vatAtRisk(open) for the session tenant, labelled vatAtRisk (never leak)', async () => {
    const src = await vatAtRisk(db, A.restaurantId, 'open', { now: NOW });
    const r = await runOpsTool('vat_at_risk', {}, ctx(A));
    expect(src.count).toBeGreaterThan(0);
    expect(r.data).toMatchObject({
      available: true,
      label: 'vatAtRisk',
      count: src.count,
      totalVatAtRiskIls: src.totalVatAtRisk,
      soonestDaysLeft: src.rows[0]!.daysLeft,
    });
    expect(JSON.stringify(r.data)).not.toMatch(/leak/i);
    expect((r.data as { totalVatAtRiskIls: number }).totalVatAtRiskIls).toBe(2160);
    expect(r.links.map((l) => l.href)).toContain(`/dashboard/invoices/${A.invoiceId}`);
  });

  it('flag off → "בדיקת מע״מ בסיכון כבויה" (feature_off), never ₪0', async () => {
    await setFeatures(A, { recovery: true });
    const r = await runOpsTool('vat_at_risk', {}, ctx(A));
    expect(r.data).toEqual({ available: false, reason: 'feature_off', feature: 'vatAtRisk' });
  });
});

describe('interim tools (sources not merged yet) answer honestly', () => {
  it('waiting_for_me / intake_stuck / to_pay_this_week → available:false, never ₪0', async () => {
    expect((await runOpsTool('waiting_for_me', {}, ctx(A))).data).toEqual({ available: false, reason: 'not_live' });
    expect((await runOpsTool('intake_stuck', {}, ctx(A))).data).toEqual({ available: false, reason: 'not_live' });
    expect((await runOpsTool('to_pay_this_week', {}, ctx(A))).data).toEqual({ available: false, reason: 'due_dates_not_live' });
    await setFeatures(A, { aiAssistant: true });
    expect((await runOpsTool('to_pay_this_week', {}, ctx(A))).data).toEqual({ available: false, reason: 'feature_off', feature: 'payRun' });
  });

  it('waiting_for_me maps the G-12a shape: before-VAT ₪ headline, other bases apart, oldest age in Israel days', async () => {
    __setOpsSources({
      awaiting: async (_db, c) => {
        expect(c.session).toEqual({ restaurantId: A.restaurantId, role: 'manager' });
        return {
          count: 4,
          blockers: 1,
          oldestAt: new Date('2026-10-22T08:00:00Z'),
          toDecide: { count: 3 },
          ils: { excl: 296, incl: 0, vat: 12.5, mixedBasis: true },
        };
      },
    });
    const r = await runOpsTool('waiting_for_me', {}, ctx(A, { role: 'manager' }));
    expect(r.data).toMatchObject({
      available: true,
      count: 4,
      toDecideCount: 3,
      blockingCount: 1,
      awaitingIls: 296,
      awaitingInclVatIls: null,
      awaitingVatIls: 12.5,
      mixedBasis: true,
      oldestAgeDays: 3,
    });
    expect(r.links[0]).toEqual({ screen: 'approvals', href: '/dashboard/approvals' });
  });

  it('intake_stuck: counts only, no ₪; no inbox count or link when no ingest channel is on', async () => {
    __setOpsSources({ intake: async () => ({ needsReview: null, ocrStuck: 2, ocrFailed: 1, noSupplier: 0 }) });
    const r = await runOpsTool('intake_stuck', {}, ctx(A));
    expect(r.data).toMatchObject({ available: true, needsReviewCount: null, ocrStuckCount: 2, ocrFailedCount: 1, totalCount: 3 });
    expect(r.links.map((l) => l.href)).not.toContain('/dashboard/inbox');
    expect(Object.keys(r.data).some((k) => /Ils$/.test(k))).toBe(false);

    __setOpsSources({ intake: async () => ({ needsReview: { count: 3, oldestAgeHours: 26 }, ocrStuck: 0, ocrFailed: 0, noSupplier: 0 }) });
    const r2 = await runOpsTool('intake_stuck', {}, ctx(A));
    expect(r2.data).toMatchObject({ needsReviewCount: 3, oldestReviewAgeHours: 26 });
    expect(r2.links.map((l) => l.href)).toContain('/dashboard/inbox');
  });

  it('to_pay_this_week: agorot → ₪ for the Israel week Sun–Sat', async () => {
    __setOpsSources({
      dueWeek: async () => ({ dueAgorot: 123_456, overdueAgorot: 10_000, heldAgorot: 5_050, heldCount: 1, dueCount: 4, overdueCount: 1 }),
    });
    const r = await runOpsTool('to_pay_this_week', {}, ctx(A));
    expect(r.data).toMatchObject({
      available: true,
      period: { from: '2026-10-25', through: '2026-10-31', complete: true },
      dueIls: 1234.56,
      overdueIls: 100,
      heldIls: 50.5,
    });
    expect(israelWeek(new Date('2026-10-31T20:00:00Z'))).toEqual({ from: '2026-10-25', through: '2026-10-31' }); // Sat 23:00 IL
    expect(israelWeek(new Date('2026-10-31T22:30:00Z'))).toEqual({ from: '2026-11-01', through: '2026-11-07' }); // Sun 00:30 IL
  });
});

describe('runTool wiring: figures by field name, period on every fact', () => {
  it('every ₪ field of a live ops tool ends in Ils, so grounding sees it as ₪', async () => {
    await claim(A, { amountAgorot: 12_000 });
    const out = await runTool('who_owes_me', {}, { db, restaurantId: A.restaurantId, now: NOW, locale: 'he', role: 'owner' });
    expect(out.figures.ils).toContain(120);
  });

  it('each new tool is defined strict with no input, and its fact carries {from, through, complete}', async () => {
    for (const name of ['waiting_for_me', 'intake_stuck', 'who_owes_me', 'to_pay_this_week', 'vat_at_risk'] as const) {
      const def = TOOL_DEFINITIONS.find((t) => t.name === name)!;
      expect(def.strict).toBe(true);
      expect(def.input_schema.properties).toEqual({});
    }
    __setOpsSources({
      awaiting: async () => ({ count: 0, blockers: 0, oldestAt: null, toDecide: { count: 0 }, ils: { excl: 0, incl: 0, vat: 0, mixedBasis: false } }),
      intake: async () => ({ needsReview: null, ocrStuck: 0, ocrFailed: 0, noSupplier: 0 }),
      dueWeek: async () => ({ dueAgorot: 0, overdueAgorot: 0, heldAgorot: 0, heldCount: 0, dueCount: 0, overdueCount: 0 }),
    });
    for (const name of ['waiting_for_me', 'intake_stuck', 'who_owes_me', 'to_pay_this_week', 'vat_at_risk'] as const) {
      const r = await runOpsTool(name, {}, ctx(A));
      expect(r.data, name).toMatchObject({ available: true, period: { from: expect.any(String), through: expect.any(String), complete: true } });
    }
  });

  it('rejects any model-supplied input (nothing to pick)', async () => {
    await expect(runOpsTool('who_owes_me', { restaurantId: B.restaurantId }, ctx(A))).rejects.toThrow();
  });
});

describe('classification stays narrow', () => {
  it('the leak chips keep their intents', () => {
    expect(classifyQuestion('מה כדאי לתבוע השבוע?')).toBe('claimWeek');
    expect(classifyQuestion('על מה לבקש זיכוי?')).toBe('claimWeek');
    expect(classifyQuestion('כמה כסף דלף החודש?')).toBe('leakTotal');
    expect(classifyQuestion('איזה ספק הכי דולף?')).toBe('topSupplier');
  });
});
