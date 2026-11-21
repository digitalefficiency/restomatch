import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  auditLog,
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
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { CONSOLIDATED_ITEM_REVIEWED } from '../match/consolidated';
import { recordAudit } from '../audit';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';
import { RESTAURANT_TZ, restaurantDateKey } from './helpers/il-day';
import { addCalendarDaysInTz } from '../lib/time';

/**
 * G-04 Q5 — "נבדק" on a consolidated review item (owner decision 11.11, Q5 (א)),
 * on the RLS-enforced app role. No schema: an append-only audit row
 * (`consolidated.item_reviewed`) bound to the item's key AND its current fact.
 * A changed fact re-appears; finance roles only; nothing crosses tenants.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let laterId: string;
let laterLineId: string;

const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

async function deliveryNote(t: Tenant, qty: number, at: Date, number: string) {
  const [po] = await ownerDb
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, expectedDeliveryAt: at, status: 'closed', source: 'manual' })
    .returning();
  const [pl] = await ownerDb
    .insert(poLines)
    .values({ poId: po!.id, productId: t.productId, qtyOrdered: String(qty), unit: 'kg', unitPriceExpected: '8.50' })
    .returning();
  const [gr] = await ownerDb
    .insert(goodsReceipts)
    .values({ restaurantId: t.restaurantId, poId: po!.id, receivedAt: at, status: 'completed', notes: `ת.מ. ${number}` })
    .returning();
  await ownerDb.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId: t.productId, qtyReceived: String(qty), qtyRejected: '0' });
}

async function listing(t: Tenant, number: string, lines: Array<[string, number, string]>) {
  const total = lines.reduce((s, [, q, p]) => s + q * Number(p), 0);
  const [inv] = await ownerDb
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceNumber: number,
      invoiceDate: new Date(),
      totalExclVat: total.toFixed(2),
      vatAmount: (total * 0.18).toFixed(2),
      totalInclVat: (total * 1.18).toFixed(2),
      status: 'parsed',
      source: 'email',
      ocrPayload: {
        provider: 'reconciled',
        raw: { kind: 'consolidated', deliveryNotes: lines.map(([n]) => ({ number: n })) },
      } as (typeof invoices.$inferInsert)['ocrPayload'],
    })
    .returning();
  const rows = await ownerDb
    .insert(invoiceLines)
    .values(
      lines.map(([n, q, p]) => ({
        invoiceId: inv!.id,
        productId: t.productId,
        rawDescription: `ת.מ. ${n} · מוצר`,
        qtyBilled: String(q),
        unit: 'kg',
        unitPriceBilled: p,
        lineTotal: (q * Number(p)).toFixed(2),
      })),
    )
    .returning({ id: invoiceLines.id });
  return { id: inv!.id, lineIds: rows.map((r) => r.id) };
}

const marks = (restaurantId: string, invoiceId: string) =>
  ownerDb
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.action, CONSOLIDATED_ITEM_REVIEWED), eq(auditLog.entityId, invoiceId)));

const twice = async (t: Tenant = A, id = laterId) =>
  (await caller(t).consolidated.proposal({ invoiceId: id }))!.reviewItems!.find((r) => r.flag === 'note_billed_twice')!;

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  for (const t of [A, B]) {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { consolidatedMatch: true } } as (typeof restaurants.$inferInsert)['settings'] })
      .where(eq(restaurants.id, t.restaurantId));
  }
  const now = new Date();
  const d = Number(restaurantDateKey({ now }).slice(8, 10)) > 1 ? addCalendarDaysInTz(now, -1, RESTAURANT_TZ) : now;
  await deliveryNote(A, 4, d, '9001');
  await deliveryNote(B, 4, d, '9001');
  // A's earlier ריכוז lists 9001; a later one lists it again → note_billed_twice (T2, blocks "תואמת").
  await listing(A, 'A-M-1', [['9001', 4, '8.50']]);
  const later = await listing(A, 'A-M-2', [['9001', 4, '8.50']]);
  laterId = later.id;
  laterLineId = later.lineIds[0]!;
  await listing(B, 'B-M-1', [['9001', 4, '8.50']]);
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('consolidated.markReviewed (G-04 Q5)', () => {
  it('marks the item "נבדק": it stays listed, reviewed, and no longer blocks "תואמת" — one audit row bound to its fact', async () => {
    const item = await twice();
    expect(item).toMatchObject({ reviewed: false, blocksMatched: true, amountIls: 34 });
    expect((await caller(A).consolidated.proposal({ invoiceId: laterId }))!.status).toBe('differences');

    await expect(caller(A).consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value })).resolves.toEqual({
      ok: true,
      alreadyReviewed: false,
    });
    const after = await twice();
    expect(after).toMatchObject({ key: item.key, value: item.value, reviewed: true, blocksMatched: false });
    const p = await caller(A).consolidated.proposal({ invoiceId: laterId });
    expect(p!.status).toBe('matched');
    expect(p!.claim).toEqual({ exclIls: 0, inclIls: 0 }); // never ₪: review items were never leak or claim
    const rows = await marks(A.restaurantId, laterId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toMatchObject({ key: item.key, value: item.value, flag: 'note_billed_twice' });
  });

  it('is idempotent: a second mark of the same fact writes nothing', async () => {
    const item = await twice();
    await caller(A).consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value });
    await expect(caller(A, 'manager').consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value })).resolves.toEqual({
      ok: true,
      alreadyReviewed: true,
    });
    expect(await marks(A.restaurantId, laterId)).toHaveLength(1);
  });

  it('a changed fact re-appears unreviewed and blocking; the stale screen gets CONFLICT', async () => {
    const item = await twice();
    await caller(A, 'bookkeeper').consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value });
    // The later ריכוז now bills the note at a different price: the overlapping ₪ changes.
    await ownerDb.update(invoiceLines).set({ unitPriceBilled: '9.00', lineTotal: '36.00' }).where(eq(invoiceLines.id, laterLineId));
    const changed = await twice();
    expect(changed.key).toBe(item.key);
    expect(changed.value).not.toBe(item.value);
    expect(changed).toMatchObject({ reviewed: false, blocksMatched: true });
    await expect(caller(A).consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(caller(A).consolidated.markReviewed({ invoiceId: laterId, key: 'nope:1:-', value: item.value })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("B marking A's invoice → NOT_FOUND, and no audit row is written for it", async () => {
    const item = await twice();
    await expect(caller(B).consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await marks(B.restaurantId, laterId)).toHaveLength(0);
    expect(await marks(A.restaurantId, laterId)).toHaveLength(0);
    expect((await twice()).reviewed).toBe(false);
  });

  it("a mark in B's audit log naming A's invoice and item never reaches A's proposal (read back restaurant-scoped)", async () => {
    const item = await twice();
    await recordAudit(ownerDb, {
      restaurantId: B.restaurantId,
      userId: B.ownerUserId,
      action: CONSOLIDATED_ITEM_REVIEWED,
      entityType: 'invoice',
      entityId: laterId,
      after: { key: item.key, value: item.value },
    });
    expect((await twice()).reviewed).toBe(false);
  });

  it('receiver and chef are FORBIDDEN; nothing is written', async () => {
    const item = await twice();
    for (const role of ['receiver', 'chef'] as const) {
      await expect(caller(A, role).consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(await marks(A.restaurantId, laterId)).toHaveLength(0);
  });

  it('the flag gates it: consolidatedMatch off → NOT_FOUND', async () => {
    const item = await twice();
    await ownerDb.update(restaurants).set({ settings: {} as (typeof restaurants.$inferInsert)['settings'] }).where(eq(restaurants.id, A.restaurantId));
    await expect(caller(A).consolidated.markReviewed({ invoiceId: laterId, key: item.key, value: item.value })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
