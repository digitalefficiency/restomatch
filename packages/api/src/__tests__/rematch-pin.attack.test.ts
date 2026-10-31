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
  invoiceLines,
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
    .set({ invoiceDate: D0, vatAmount: '18.00', totalInclVat: '118.00', source: 'photo' })
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
async function extraPo(
  T: Tenant,
  at: Date,
  price: string,
  status: 'sent' | 'cancelled' | 'closed' = 'sent',
  received = true,
) {
  const [po] = await ownerDb
    .insert(purchaseOrders)
    .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, expectedDeliveryAt: at, status, source: 'manual' })
    .returning();
  const [pl] = await ownerDb
    .insert(poLines)
    .values({ poId: po!.id, productId: T.productId, rawDescription: 'x', qtyOrdered: '10', unit: 'kg', unitPriceExpected: price })
    .returning();
  if (received) await receive(T, po!.id, pl!.id);
  return po!.id;
}
/** A goods receipt of 10 on the PO's line. */
async function receive(T: Tenant, poId: string, poLineId: string) {
  const [gr] = await ownerDb
    .insert(goodsReceipts)
    .values({ restaurantId: T.restaurantId, poId, receivedBy: T.ownerUserId, status: 'pending' })
    .returning();
  await ownerDb.insert(grLines).values({ grId: gr!.id, poLineId, qtyReceived: '10', qtyRejected: '0' });
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

/**
 * #90 verification (MAJOR): the next standing order — placed, not yet delivered,
 * with a closer expected day — must never take an invoice from the PO its goods
 * were received against. Candidates rank by "has a goods receipt", then nearest day.
 */
describe('a received PO outranks an undelivered closer one', () => {
  const state = async (invoiceId: string) => {
    const [run] = await ownerDb
      .select({ poId: matchRuns.poId, total: matchRuns.totalDiscrepancyAmount })
      .from(matchRuns)
      .where(eq(matchRuns.invoiceId, invoiceId));
    const f = await ownerDb
      .select({
        id: discrepancies.id,
        type: discrepancies.type,
        delta: discrepancies.deltaAmount,
        status: discrepancies.resolutionStatus,
        sev: discrepancies.severity,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(matchRuns.invoiceId, invoiceId));
    return { poId: run?.poId, total: run?.total, raw: f };
  };
  /** PO1 expected D0, received `received` of 10 kg at ₪10; the invoice bills 10 kg, dated D0+2. */
  async function onPo1(received: string) {
    const T = await seedTenant(ownerDb, 'S');
    const managerId = await member(T, 'manager');
    const mgr = as(T, managerId, 'manager');
    await ownerDb.update(purchaseOrders).set({ expectedDeliveryAt: D0 }).where(eq(purchaseOrders.id, T.poId));
    await ownerDb.update(poLines).set({ productId: T.productId, unitPriceExpected: '10' }).where(eq(poLines.id, T.poLineId));
    await ownerDb.update(grLines).set({ qtyReceived: received }).where(eq(grLines.id, T.grLineId));
    // "PO1 received": its receipt is closed (G-04 receipt truth: a pending receipt — a
    // receiver still counting — feeds the engine nothing).
    await ownerDb.update(goodsReceipts).set({ status: received === '10' ? 'completed' : 'partial' }).where(eq(goodsReceipts.id, T.grId));
    await ownerDb
      .update(invoices)
      .set({ invoiceDate: new Date(D0.getTime() + 2 * DAY), vatAmount: '18.00', totalInclVat: '118.00', source: 'photo' })
      .where(eq(invoices.id, T.invoiceId));
    await ownerDb.delete(matchRuns).where(eq(matchRuns.invoiceId, T.invoiceId));
    return { T, mgr };
  }
  const placeNextOrder = async (T: Tenant, mgr: ReturnType<typeof as>, line: Record<string, unknown>) => {
    const draft = await mgr.orders.createDraft({
      supplierId: T.supplierId,
      expectedDeliveryAt: new Date(D0.getTime() + 3 * DAY),
      lines: [line as never],
    });
    await mgr.orders.placeOrder({ poId: draft.poId, channel: 'none' });
  };

  it('R1: late delivery billed on PO1 (GR short) — next standing order PO2 placed — re-match after a line fix stays on PO1', async () => {
    const { T, mgr } = await onPo1('8');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const first = await state(T.invoiceId);
    expect(first.poId).toBe(T.poId);
    const qs = first.raw.find((x) => x.type === 'QTY_SHORT');
    if (qs && qs.status === 'open') {
      await as(T, T.ownerUserId, 'owner').approvals.approve({ discrepancyId: qs.id, note: 'credit note promised' });
    }
    await placeNextOrder(T, mgr, { productId: T.productId, qty: 10, unit: 'kg', unitPriceExpected: 10 });
    const [line] = await ownerDb.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, T.invoiceId));
    await mgr.receiving.updateInvoiceLine({ lineId: line!.id, patch: { rawDescription: 'עגבניות שרי' } });
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const second = await state(T.invoiceId);
    expect(second.poId).toBe(T.poId);
    expect(second.total).toBe(first.total); // the ₪ leak survives
    expect(second.raw.find((x) => x.type === 'QTY_SHORT')?.status).toBe('accepted'); // decision carried
  });

  it('R1 (fresh match): with PO2 already placed, a first match still picks the received PO1', async () => {
    const { T, mgr } = await onPo1('8');
    await placeNextOrder(T, mgr, { productId: T.productId, qty: 10, unit: 'kg', unitPriceExpected: 10 });
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const s = await state(T.invoiceId);
    expect(s.poId).toBe(T.poId);
    expect(s.raw.some((x) => x.type === 'QTY_OVER')).toBe(true); // billed 10, received 8
  });

  it('R2: clean invoice on PO1 — next order PO2 for other goods — re-match stays clean on PO1', async () => {
    const { T, mgr } = await onPo1('10');
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    await placeNextOrder(T, mgr, { rawDescription: 'מלפפונים', qty: 20, unit: 'kg', unitPriceExpected: 6 });
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const second = await state(T.invoiceId);
    expect(second.poId).toBe(T.poId);
    expect(second.raw.filter((x) => x.sev === 'block')).toHaveLength(0);
  });
});

/**
 * An emailed invoice often arrives BEFORE the goods (email / WhatsApp ingest): the
 * supplier delivers Mon and Thu, and Thursday's invoice is emailed Thursday
 * morning. It goes by the nearest day — but a pinned PO with a receipt is never
 * displaced by one without (R1/R2 hold for every source).
 */
describe('an emailed invoice goes by the nearest day', () => {
  /** Mon = PO1 at D0, received; the invoice is emailed, dated Thu (D0+3). */
  async function emailedThursday() {
    const T = await linked('E');
    await ownerDb
      .update(invoices)
      .set({ source: 'email', invoiceDate: new Date(D0.getTime() + 3 * DAY) })
      .where(eq(invoices.id, T.invoiceId));
    await ownerDb.delete(matchRuns).where(eq(matchRuns.invoiceId, T.invoiceId));
    const thu = await extraPo(T, new Date(D0.getTime() + 3 * DAY), '9.5', 'sent', false);
    return { T, thu, mgr: as(T, T.managerId, 'manager') };
  }

  it("E1: Mon received, Thu not yet — a fresh match of Thursday's emailed invoice picks Thu", async () => {
    const { T, thu, mgr } = await emailedThursday();
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(thu);
  });

  it('E2: Thu is then received — the re-match stays on Thu', async () => {
    const { T, thu, mgr } = await emailedThursday();
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    const [line] = await ownerDb.select({ id: poLines.id }).from(poLines).where(eq(poLines.poId, thu));
    await receive(T, thu, line!.id);
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(thu);
  });

  it('E3: emailed invoice pinned to a received PO — a nearer new PO without a receipt does not take it', async () => {
    const T = await linked('E');
    await ownerDb
      .update(invoices)
      .set({ source: 'email', invoiceDate: new Date(D0.getTime() + 2 * DAY) })
      .where(eq(invoices.id, T.invoiceId));
    const mgr = as(T, T.managerId, 'manager');
    await ownerDb.delete(matchRuns).where(eq(matchRuns.invoiceId, T.invoiceId));
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(T.poId);
    await extraPo(T, new Date(D0.getTime() + 2 * DAY), '9.5', 'sent', false);
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(T.poId);
  });
});

/**
 * G-04 (receiving-04 / functional-flows-06): a DRAFT PO — a walk-in's retro PO
 * before the manager confirms it — is never pinned, so the owner's
 * UNORDERED_ARRIVAL hold stays; a foreign PO is never pinned either.
 */
describe('a draft or foreign PO is never pinned', () => {
  it('D1: the pinned PO goes back to draft → the re-match drops the pin → UNORDERED_ARRIVAL; confirmed again → pinned', async () => {
    const T = await linked('D');
    const mgr = as(T, T.managerId, 'manager');
    await ownerDb.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, T.grId));
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(T.poId);
    await ownerDb.update(purchaseOrders).set({ status: 'draft' }).where(eq(purchaseOrders.id, T.poId));
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBeNull();
    expect((await findings(T.invoiceId)).map((f) => f.type)).toContain('UNORDERED_ARRIVAL');
    await ownerDb.update(purchaseOrders).set({ status: 'confirmed' }).where(eq(purchaseOrders.id, T.poId));
    await mgr.match.runForInvoice({ invoiceId: T.invoiceId });
    expect(await runPo(T.invoiceId)).toBe(T.poId);
    expect((await findings(T.invoiceId)).map((f) => f.type)).not.toContain('UNORDERED_ARRIVAL');
  });
  it("D2: another tenant's PO id as the pin is never used", async () => {
    const A = await linked('A');
    const B = await linked('B');
    const { buildMatchInputForInvoice } = await import('../match/buildMatchInput');
    // The worker's service connection bypasses RLS: the explicit restaurant scoping is what stops it.
    const built = await buildMatchInputForInvoice(ownerDb, A.restaurantId, A.invoiceId, { pinnedPoId: B.poId });
    expect(built!.poId).toBe(A.poId);
    expect(built!.pinSkipped).toBeUndefined();
  });
});

