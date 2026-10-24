import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  goodsReceipts,
  grLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  purchaseOrders,
  suppliers,
  testDbUrl,
  users,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * Re-match PO pin (#68 independent verification, router level, RLS app role):
 * the pinned PO is one more discovery candidate — never a short-circuit — and a
 * PO 7–8 days from the invoice (inside the local-day window, past the engine's
 * 7×24h DATE_ANOMALY threshold) never crashes the insert.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const D0 = new Date('2026-06-10T09:00:00Z'); // 12:00 local, DST-free
beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});
beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
});
afterAll(() => resetDb(ownerDb));
function as(t: Tenant, userId: string, role: UserRole) {
  const ctx: AppContext = { db: appDb, session: { userId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}
async function member(t: Tenant, role: UserRole): Promise<string> {
  const [u] = await ownerDb
    .insert(users)
    .values({ email: `${role}-${t.restaurantId.slice(0, 8)}@semantics.test`, name: role })
    .returning();
  await ownerDb.insert(memberships).values({ userId: u!.id, restaurantId: t.restaurantId, role });
  return u!.id;
}
async function linked(tag: string): Promise<Tenant & { managerId: string; bookkeeperId: string }> {
  const T = await seedTenant(ownerDb, tag);
  await ownerDb.update(purchaseOrders).set({ expectedDeliveryAt: D0 }).where(eq(purchaseOrders.id, T.poId));
  await ownerDb.update(poLines).set({ productId: T.productId, unitPriceExpected: '9.5' }).where(eq(poLines.id, T.poLineId));
  await ownerDb.update(grLines).set({ qtyReceived: '10' }).where(eq(grLines.id, T.grLineId));
  await ownerDb
    .update(invoices)
    .set({ invoiceDate: D0, vatAmount: '18.00', totalInclVat: '118.00' })
    .where(eq(invoices.id, T.invoiceId));
  return { ...T, managerId: await member(T, 'manager'), bookkeeperId: await member(T, 'bookkeeper') };
}
const findings = (invoiceId: string) =>
  ownerDb
    .select({ id: discrepancies.id, type: discrepancies.type, poId: matchRuns.poId })
    .from(discrepancies)
    .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
    .where(eq(matchRuns.invoiceId, invoiceId));
const runPo = async (invoiceId: string) =>
  (await ownerDb.select({ poId: matchRuns.poId }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId)))[0]?.poId;
async function extraPo(T: Tenant, at: Date, price: string, status: 'sent' | 'cancelled' | 'closed' = 'sent') {
  const [po] = await ownerDb
    .insert(purchaseOrders)
    .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, expectedDeliveryAt: at, status, source: 'manual' })
    .returning();
  const [pl] = await ownerDb
    .insert(poLines)
    .values({ poId: po!.id, productId: T.productId, rawDescription: 'x', qtyOrdered: '10', unit: 'kg', unitPriceExpected: price })
    .returning();
  const [gr] = await ownerDb
    .insert(goodsReceipts)
    .values({ restaurantId: T.restaurantId, poId: po!.id, receivedBy: T.ownerUserId, status: 'pending' })
    .returning();
  await ownerDb.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, qtyReceived: '10', qtyRejected: '0' });
  return po!.id;
}
describe('re-match PO pin', () => {
  it('a1: date corrected inside the local-day window but >7×24h from the pinned PO → no crash', async () => {
    const T = await linked('A');
    const mgr = as(T, T.managerId, 'manager');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(T.poId);
    await mgr.receiving.updateInvoiceHeader({
      invoiceId: T.invoiceId,
      patch: { invoiceDate: new Date(D0.getTime() + 7 * DAY + 2 * HOUR) },
    });
    await expect(mgr.match.runForInvoice({ invoiceId: T.invoiceId })).resolves.toMatchObject({ poMatched: true });
  });
  it('a1b: same edge on a FIRST match (no pin)', async () => {
    const T = await linked('A');
    await ownerDb.delete(matchRuns).where(eq(matchRuns.invoiceId, T.invoiceId));
    await ownerDb
      .update(invoices)
      .set({ invoiceDate: new Date(D0.getTime() - 7 * DAY - 2 * HOUR) })
      .where(eq(invoices.id, T.invoiceId));
    await expect(as(T, T.managerId, 'manager').match.runForInvoice({ invoiceId: T.invoiceId })).resolves.toMatchObject({
      poMatched: true,
    });
  });
  it('a2: date corrected to the day of ANOTHER open PO → re-match = fresh match', async () => {
    const T = await linked('A');
    const mgr = as(T, T.managerId, 'manager');
    const po2 = await extraPo(T, new Date(D0.getTime() + 4 * DAY), '10');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(T.poId);
    await mgr.receiving.updateInvoiceHeader({ invoiceId: T.invoiceId, patch: { invoiceDate: new Date(D0.getTime() + 4 * DAY) } });
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const rematched = { po: await runPo(T.invoiceId), types: (await findings(T.invoiceId)).map((f) => f.type) };
    await ownerDb.delete(matchRuns).where(eq(matchRuns.invoiceId, T.invoiceId));
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const fresh = { po: await runPo(T.invoiceId), types: (await findings(T.invoiceId)).map((f) => f.type) };
    expect(fresh.po).toBe(po2);
    expect(rematched).toEqual(fresh);
  });
  it('a2b: pinned PO closed, date corrected onto another OPEN PO’s day → moves to it', async () => {
    const T = await linked('A');
    const mgr = as(T, T.managerId, 'manager');
    const po2 = await extraPo(T, new Date(D0.getTime() + 4 * DAY), '10');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    await ownerDb.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, T.poId));
    await mgr.receiving.updateInvoiceHeader({ invoiceId: T.invoiceId, patch: { invoiceDate: new Date(D0.getTime() + 4 * DAY) } });
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(po2);
  });
  it('a3: supplier corrected → pin dropped, new supplier’s PO found', async () => {
    const T = await linked('A');
    const mgr = as(T, T.managerId, 'manager');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const [s2] = await ownerDb
      .insert(suppliers)
      .values({ restaurantId: T.restaurantId, name: 'ספק 2', businessId: '515555555' })
      .returning();
    const [po] = await ownerDb
      .insert(purchaseOrders)
      .values({ restaurantId: T.restaurantId, supplierId: s2!.id, expectedDeliveryAt: D0, status: 'sent', source: 'manual' })
      .returning();
    await ownerDb
      .insert(poLines)
      .values({ poId: po!.id, productId: T.productId, rawDescription: 'x', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '10' });
    await ownerDb.update(invoices).set({ supplierId: s2!.id }).where(eq(invoices.id, T.invoiceId));
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(po!.id);
  });
  it('a4: pinned PO CANCELLED and replaced → re-match moves to the replacement', async () => {
    const T = await linked('A');
    const mgr = as(T, T.managerId, 'manager');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    await ownerDb.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, T.poId));
    const replacement = await extraPo(T, new Date(D0.getTime() + DAY), '10');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(replacement);
  });
  it('a5: pinned PO CLOSED + small in-window date correction → stays on its PO', async () => {
    const T = await linked('A');
    const mgr = as(T, T.managerId, 'manager');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    await ownerDb.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, T.poId));
    await mgr.receiving.updateInvoiceHeader({ invoiceId: T.invoiceId, patch: { invoiceDate: new Date(D0.getTime() + 2 * DAY) } });
    const res = await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(res.poMatched).toBe(true);
    expect(await runPo(T.invoiceId)).toBe(T.poId);
  });
});
