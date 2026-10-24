import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * CONSOLIDATED CROSS-MATCH ATTACK SUITE — consolidated.proposal / .coverage on
 * the RLS-enforced app role (`restomatch_app`, no BYPASSRLS), like production.
 *
 * A has a consolidated invoice (חשבונית ריכוז) and two of its delivery notes
 * this month, plus: the fixture's receipt already covered by A's own matched
 * invoice, and a receipt of ANOTHER supplier of A. B has a receipt of B's
 * supplier on the same day. A's proposal must hold exactly A's two notes; no id
 * of B reaches B's data; the chef is refused; the flag gates both procedures.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let consolidatedId: string;
const ownNotes: string[] = [];
let otherSupplierGr: string;
let bGr: string;
let itemizedId: string;
const listedNotes: string[] = [];
let bListedGr: string;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

/** A delivery note (PO + receipt) of `supplierId` with one line of `productId`. */
async function deliveryNote(t: Tenant, supplierId: string, productId: string, qty: number, price: number, at: Date, number?: string) {
  const [po] = await ownerDb
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId, expectedDeliveryAt: at, status: 'closed', source: 'manual' })
    .returning();
  const [pl] = await ownerDb
    .insert(poLines)
    .values({ poId: po!.id, productId, qtyOrdered: String(qty), unit: 'kg', unitPriceExpected: String(price) })
    .returning();
  const [gr] = await ownerDb
    .insert(goodsReceipts)
    .values({ restaurantId: t.restaurantId, poId: po!.id, receivedAt: at, status: 'completed', notes: number ? `ת.מ. ${number}` : null })
    .returning();
  await ownerDb.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId, qtyReceived: String(qty), qtyRejected: '0' });
  return gr!.id;
}

const flag = (t: Tenant, on: boolean) =>
  ownerDb
    .update(restaurants)
    .set({ settings: (on ? { features: { consolidatedMatch: true } } : {}) as (typeof restaurants.$inferInsert)['settings'] })
    .where(eq(restaurants.id, t.restaurantId));

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  await flag(A, true);
  await flag(B, true);

  const now = new Date();
  const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  // Keep both notes inside the invoice's month (fixture invoice day = today).
  const d1 = now.getDate() > 2 ? day(2) : now;
  const d2 = now.getDate() > 1 ? day(1) : now;
  ownNotes.push(await deliveryNote(A, A.supplierId, A.productId, 10, 8.5, d1));
  ownNotes.push(await deliveryNote(A, A.supplierId, A.productId, 5, 8.5, d2));
  const [otherSupplier] = await ownerDb
    .insert(suppliers)
    .values({ restaurantId: A.restaurantId, name: 'ספק אחר A' })
    .returning();
  otherSupplierGr = await deliveryNote(A, otherSupplier!.id, A.productId, 3, 8.5, d1);
  bGr = await deliveryNote(B, B.supplierId, B.productId, 7, 8.5, d1);
  // An itemized ריכוז of A that LISTS its notes by number (`ת.מ. 9001/9002`), one
  // line per note — 9001 billed ₪9.00 against the PO's ₪8.50. B has a note with
  // the same number 9001: it must never surface on A's side.
  listedNotes.push(await deliveryNote(A, A.supplierId, A.productId, 4, 8.5, d1, '9001'));
  listedNotes.push(await deliveryNote(A, A.supplierId, A.productId, 6, 8.5, d2, '9002'));
  bListedGr = await deliveryNote(B, B.supplierId, B.productId, 4, 8.5, d1, '9001');
  const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const [itemized] = await ownerDb
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: 'A-M-1',
      invoiceDate: now,
      totalExclVat: '87.00',
      vatAmount: '15.66',
      totalInclVat: '102.66',
      status: 'parsed',
      source: 'email',
      ocrPayload: {
        provider: 'reconciled',
        raw: { kind: 'consolidated', periodStart: ymd(d1), periodEnd: ymd(d2), deliveryNotes: [{ number: '9001' }, { number: '9002' }] },
      } as (typeof invoices.$inferInsert)['ocrPayload'],
    })
    .returning();
  itemizedId = itemized!.id;
  await ownerDb.insert(invoiceLines).values([
    { invoiceId: itemizedId, productId: A.productId, rawDescription: 'ת.מ. 9001 · מוצר', qtyBilled: '4', unit: 'kg', unitPriceBilled: '9.00', lineTotal: '36.00' },
    { invoiceId: itemizedId, productId: A.productId, rawDescription: 'ת.מ. 9002 · מוצר', qtyBilled: '6', unit: 'kg', unitPriceBilled: '8.50', lineTotal: '51.00' },
  ]);

  // A's consolidated invoice: the 15 kg delivered, billed at the PO price.
  const [inv] = await ownerDb
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: 'A-R-1',
      invoiceDate: now,
      totalExclVat: '127.50',
      vatAmount: '22.95',
      totalInclVat: '150.45',
      status: 'parsed',
      source: 'email',
      // A ריכוז that lists no notes: its notes are the supplier's uncovered ones in its month.
      ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated' } } as (typeof invoices.$inferInsert)['ocrPayload'],
    })
    .returning();
  consolidatedId = inv!.id;
  await ownerDb.insert(invoiceLines).values({
    invoiceId: inv!.id,
    productId: A.productId,
    rawDescription: 'ריכוז תעודות משלוח',
    qtyBilled: '15',
    unit: 'kg',
    unitPriceBilled: '8.50',
    lineTotal: '127.50',
  });
});

afterAll(() => resetDb(ownerDb));

describe('consolidated.proposal — isolation (RLS app role)', () => {
  it("A's proposal holds exactly A's own uncovered delivery notes of that supplier", async () => {
    const p = await caller(A).consolidated.proposal({ invoiceId: consolidatedId });
    expect(p).not.toBeNull();
    const ids = p!.deliveryNotes.map((n) => n.grId).sort();
    expect(ids).toEqual([...ownNotes].sort());
    expect(ids).not.toContain(A.grId); // covered by A's own matched invoice
    expect(ids).not.toContain(otherSupplierGr); // another supplier
    expect(ids).not.toContain(bGr); // tenant B — never
    expect(p!.status).toBe('matched');
    expect(p!.totals).toMatchObject({ deliveryNotesIls: 127.5, invoiceSubtotalIls: 127.5, leakIls: 0 });
  });

  it('an itemized ריכוז gets exactly the notes it lists — never B’s note with the same number', async () => {
    const p = await caller(A).consolidated.proposal({ invoiceId: itemizedId });
    expect(p!.deliveryNotes.map((n) => n.grId).sort()).toEqual([...listedNotes].sort());
    expect(p!.deliveryNotes.map((n) => n.grId)).not.toContain(bListedGr);
    expect(p!.deliveryNotes.map((n) => [n.number, n.deltaIls])).toEqual([
      ['9001', 2],
      ['9002', 0],
    ]);
    expect(p!.findings.filter((f) => f.countsAsLeak).map((f) => [f.type, f.deltaAmount, f.deliveryNoteNumber])).toEqual([
      ['PRICE_HIGHER', 2, '9001'],
    ]);
    expect(p!.totals).toMatchObject({ leakIls: 2, deliveryNotesIls: 85, invoiceSubtotalIls: 87 });
  });

  it('an ordinary invoice waiting for its PO link (no consolidated payload) gets no proposal', async () => {
    // #95 review P0: it used to be cross-matched against the whole month's notes —
    // "differences" with invented MISSING_ON_INVOICE.
    const [plain] = await ownerDb
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: 'A-77001',
        invoiceDate: new Date(),
        totalExclVat: '68.34',
        vatAmount: '12.30',
        totalInclVat: '80.64',
        status: 'parsed',
        source: 'email',
      })
      .returning();
    await ownerDb.insert(invoiceLines).values({
      invoiceId: plain!.id,
      productId: A.productId,
      rawDescription: 'ביצים',
      qtyBilled: '2',
      unit: 'kg',
      unitPriceBilled: '34.17',
      lineTotal: '68.34',
    });
    expect(await caller(A).consolidated.proposal({ invoiceId: plain!.id })).toBeNull();
  });

  it('a ריכוז cannot be re-matched to a PO (it would turn into a red UNORDERED_ARRIVAL blocker)', async () => {
    await expect(caller(A, 'manager').match.runForInvoice({ invoiceId: itemizedId })).rejects.toThrow(/PRECONDITION_FAILED|consolidated/i);
    const runs = await ownerDb.execute(`select count(*)::int as c from match_runs where invoice_id = '${itemizedId}'`);
    const rows = (Array.isArray(runs) ? runs : (runs as { rows: { c: number }[] }).rows) as { c: number }[];
    expect(rows[0]!.c).toBe(0);
  });

  it('the proposal (₪ deltas) is for finance roles: a receiver is refused, a bookkeeper reads it', async () => {
    await expect(caller(A, 'receiver').consolidated.proposal({ invoiceId: consolidatedId })).rejects.toThrow(/FORBIDDEN|role/i);
    expect(await caller(A, 'bookkeeper').consolidated.proposal({ invoiceId: consolidatedId })).not.toBeNull();
  });

  it('billed twice: a later ריכוז listing a note an earlier one lists is flagged, naming it — the earlier one is not', async () => {
    const [later] = await ownerDb
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: 'A-M-2',
        invoiceDate: new Date(),
        totalExclVat: '36.00',
        vatAmount: '6.48',
        totalInclVat: '42.48',
        status: 'parsed',
        source: 'email',
        ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated', deliveryNotes: [{ number: '9001' }] } } as (typeof invoices.$inferInsert)['ocrPayload'],
      })
      .returning();
    await ownerDb.insert(invoiceLines).values({
      invoiceId: later!.id,
      productId: A.productId,
      rawDescription: 'ת.מ. 9001 · מוצר',
      qtyBilled: '4',
      unit: 'kg',
      unitPriceBilled: '9.00',
      lineTotal: '36.00',
    });
    try {
      const p = await caller(A).consolidated.proposal({ invoiceId: later!.id });
      expect(p!.findings.filter((f) => f.countsAsLeak).map((f) => [f.type, f.deltaAmount, f.deliveryNoteNumber, f.alreadyBilledOn?.invoiceNumber])).toEqual([
        ['QTY_OVER', 36, '9001', 'A-M-1'],
      ]);
      // The earlier ריכוז keeps its own finding only.
      const first = await caller(A).consolidated.proposal({ invoiceId: itemizedId });
      expect(first!.findings.every((f) => f.alreadyBilledOn === null)).toBe(true);
    } finally {
      await ownerDb.delete(invoices).where(eq(invoices.id, later!.id));
    }
  });

  it('an ordinary matched invoice (its own PO) gets no proposal', async () => {
    expect(await caller(A).consolidated.proposal({ invoiceId: A.invoiceId })).toBeNull();
  });

  it("A cannot read B's invoice through the proposal (foreign id)", async () => {
    await expect(caller(A).consolidated.proposal({ invoiceId: B.invoiceId })).rejects.toThrow();
    await expect(caller(A).consolidated.proposal({ invoiceId: randomUUID() })).rejects.toThrow();
  });

  it('the chef is refused (invoice readers only)', async () => {
    await expect(caller(A, 'chef').consolidated.proposal({ invoiceId: consolidatedId })).rejects.toThrow(/FORBIDDEN|role/i);
    await expect(
      caller(A, 'chef').consolidated.coverage({ supplierId: A.supplierId, from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }),
    ).rejects.toThrow(/FORBIDDEN|role/i);
  });

  it('flag off → no proposal, no coverage (nothing computed)', async () => {
    await flag(A, false);
    try {
      expect(await caller(A).consolidated.proposal({ invoiceId: consolidatedId })).toBeNull();
      expect(
        await caller(A).consolidated.coverage({ supplierId: A.supplierId, from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }),
      ).toEqual([]);
    } finally {
      await flag(A, true);
    }
  });

  it('read-only: computing the proposal writes nothing (the invoice stays pending, no match run)', async () => {
    await caller(A).consolidated.proposal({ invoiceId: consolidatedId });
    const [inv] = await ownerDb.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, consolidatedId));
    expect(inv!.status).toBe('parsed');
    const runs = await ownerDb.execute(`select count(*)::int as c from match_runs where invoice_id = '${consolidatedId}'`);
    const rows = (Array.isArray(runs) ? runs : (runs as { rows: { c: number }[] }).rows) as { c: number }[];
    expect(rows[0]!.c).toBe(0);
  });
});

describe('consolidated.coverage — isolation (RLS app role)', () => {
  const wide = { from: '2026-01-01T00:00:00Z', to: '2027-12-31T00:00:00Z' };

  it("A's supplier: covered / in the consolidated invoice — and nothing of B", async () => {
    const rows = await caller(A).consolidated.coverage({ supplierId: A.supplierId, ...wide });
    const byId = new Map(rows.map((r) => [r.grId, r]));
    expect(byId.get(A.grId)).toMatchObject({ state: 'covered', invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber });
    for (const id of ownNotes) expect(byId.get(id)).toMatchObject({ state: 'in_consolidated', invoiceId: consolidatedId });
    // Listed by number on the itemized ריכוז: proposed there (it is still parsed), flagged consolidated.
    for (const id of listedNotes) {
      expect(byId.get(id)).toMatchObject({ state: 'in_consolidated', invoiceId: itemizedId, invoiceNumber: 'A-M-1', consolidated: true });
    }
    expect(byId.get(A.grId)).toMatchObject({ consolidated: false });
    expect(byId.has(bGr)).toBe(false);
    expect(byId.has(bListedGr)).toBe(false);
    expect(byId.has(otherSupplierGr)).toBe(false);
  });

  it('once the ריכוז is paid, the notes it lists are covered', async () => {
    await ownerDb.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, itemizedId));
    try {
      const rows = await caller(A).consolidated.coverage({ supplierId: A.supplierId, ...wide });
      for (const id of listedNotes) {
        expect(rows.find((r) => r.grId === id)).toMatchObject({ state: 'covered', invoiceId: itemizedId, consolidated: true });
      }
    } finally {
      await ownerDb.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, itemizedId));
    }
  });

  it('an ordinary invoice waiting for its PO link covers nothing: a note in its month stays not_invoiced', async () => {
    // #95 review: it has no billing period — counting it would hide a note nobody billed.
    // Move A-R-1 out of the way (not a ריכוז for this check) and add a plain waiting invoice.
    await ownerDb.update(invoices).set({ ocrPayload: null }).where(eq(invoices.id, consolidatedId));
    const [plain] = await ownerDb
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: 'A-77002',
        invoiceDate: new Date(),
        totalExclVat: '10.00',
        vatAmount: '1.80',
        totalInclVat: '11.80',
        status: 'parsed',
        source: 'email',
      })
      .returning();
    try {
      const rows = await caller(A).consolidated.coverage({ supplierId: A.supplierId, ...wide });
      for (const id of ownNotes) expect(rows.find((r) => r.grId === id)).toMatchObject({ state: 'not_invoiced', invoiceId: null });
    } finally {
      await ownerDb.delete(invoices).where(eq(invoices.id, plain!.id));
      await ownerDb
        .update(invoices)
        .set({ ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated' } } as (typeof invoices.$inferInsert)['ocrPayload'] })
        .where(eq(invoices.id, consolidatedId));
    }
  });

  it("B's supplier id from A's session returns nothing (RLS: B's receipts are invisible)", async () => {
    expect(await caller(A).consolidated.coverage({ supplierId: B.supplierId, ...wide })).toEqual([]);
  });
});
