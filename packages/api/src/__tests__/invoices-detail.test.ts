import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyCoreTenantRls,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  invoiceLines,
  poLines,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/** W2-02 invoices.detail: lines joined to findings; receiver gets no ₪; chef FORBIDDEN; A → B NOT_FOUND. */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
const callerOf = (t: Tenant, role: 'owner' | 'manager' | 'bookkeeper' | 'receiver' | 'chef' = 'owner') =>
  appRouter.createCaller({ db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } });

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'DA');
  B = await seedTenant(ownerDb, 'DB');
  // A persisted run links each finding to its line and records the expected/actual it compared.
  await ownerDb
    .update(discrepancies)
    .set({ invoiceLineId: A.invoiceLineId, expectedValue: '8.5', actualValue: '10', toleranceUsed: '±0%' })
    .where(eq(discrepancies.id, A.discrepancyId));
  await ownerDb.update(invoiceLines).set({ productId: A.productId }).where(eq(invoiceLines.id, A.invoiceLineId));
  await ownerDb.update(poLines).set({ productId: A.productId }).where(eq(poLines.id, A.poLineId));
});
afterAll(async () => {
  await resetDb(ownerDb);
});

const MONEY_KEYS = /Agorot$|^unitPriceBilled$|^expected$|^actual$/;
function moneyLeaves(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyLeaves(x, `${path}[${i}]`));
  if (v && typeof v === 'object' && !(v instanceof Date))
    return Object.entries(v).flatMap(([k, x]) =>
      MONEY_KEYS.test(k) && typeof x === 'number' && !/qty|QTY/.test(path) ? [`${path}.${k}`] : moneyLeaves(x, `${path}.${k}`),
    );
  return [];
}

describe('invoices.detail', () => {
  it('returns state, the match refs and lines joined to their findings (expected, actual, Δ₪, tolerance)', async () => {
    const d = await callerOf(A, 'bookkeeper').invoices.detail({ invoiceId: A.invoiceId });
    expect(d.state).toBe('flagged_open');
    expect(d.match?.poId).toBe(A.poId);
    expect(d.match?.grId).toBe(A.grId);
    const line = d.lines.find((l) => l.id === A.invoiceLineId)!;
    expect(line.findings).toHaveLength(1);
    const f = line.findings[0]!;
    expect(f.type).toBe('PRICE_HIGHER');
    expect(f.deltaAgorot).toBe(10000);
    expect(f.expectedSource).toBe('po_price');
    expect(f.expected).toBe(8.5);
    expect(f.toleranceUsed).toBe('±0%');
    // Three-way: the fixture PO ordered 10 @ ₪8.50; the receipt counted 5.
    expect(line.qtyOrdered).toBe(10);
    expect(line.qtyReceived).toBe(5);
    expect(line.expectedPrice).toBe(8.5);
    expect(line.expectedPriceSource).toBe('po_price');
    expect(d.openCount).toBe(1);
    expect(d.openGapAgorot).toBe(10000);
    expect(d.totalInclVatAgorot).toBe(11700);
  });

  it('the receiver gets no ₪ or price field', async () => {
    const d = await callerOf(A, 'receiver').invoices.detail({ invoiceId: A.invoiceId });
    expect(d.totalInclVatAgorot).toBeNull();
    expect(d.gapAgorot).toBeNull();
    expect(d.lines[0]!.unitPriceBilled).toBeNull();
    expect(d.lines[0]!.expectedPrice).toBeNull();
    expect(d.lines[0]!.qtyReceived).toBe(5); // quantities are not ₪
    expect(d.lines[0]!.lineTotalAgorot).toBeNull();
    expect(d.lines[0]!.findings[0]!.deltaAgorot).toBeNull();
    expect(moneyLeaves(d)).toEqual([]);
  });

  it('a finding with no line sits in headerFindings', async () => {
    await ownerDb.update(discrepancies).set({ invoiceLineId: null }).where(eq(discrepancies.id, A.discrepancyId));
    const d = await callerOf(A).invoices.detail({ invoiceId: A.invoiceId });
    expect(d.headerFindings.map((f) => f.id)).toEqual([A.discrepancyId]);
    await ownerDb.update(discrepancies).set({ invoiceLineId: A.invoiceLineId }).where(eq(discrepancies.id, A.discrepancyId));
  });

  it('the chef is FORBIDDEN', async () => {
    await expect(callerOf(A, 'chef').invoices.detail({ invoiceId: A.invoiceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("A asking for B's invoice → NOT_FOUND", async () => {
    await expect(callerOf(A).invoices.detail({ invoiceId: B.invoiceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
