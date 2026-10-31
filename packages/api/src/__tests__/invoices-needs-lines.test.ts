import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  invoiceLines,
  invoices,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import { holdReasonsOf } from '../routers/invoices';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * PILOT (train B) · invoices.needsLines: the owner's list of invoices waiting for
 * lines — a failed read, or read with 0 lines. Tenant-scoped on the RLS app role;
 * receiver and chef FORBIDDEN; B's invoices never appear for A.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
type Role = 'owner' | 'manager' | 'bookkeeper' | 'receiver' | 'chef';
const callerOf = (t: Tenant, role: Role = 'owner') =>
  appRouter.createCaller({ db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } });

async function addInvoice(t: Tenant, v: Partial<typeof invoices.$inferInsert>) {
  const [row] = await ownerDb
    .insert(invoices)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, source: 'photo', status: 'parsed', invoiceDate: new Date(), ...v })
    .returning({ id: invoices.id });
  return row!.id;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});
beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'NA'); // a matched invoice WITH one line: never listed
  B = await seedTenant(ownerDb, 'NB');
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('invoices.needsLines', () => {
  it('lists a failed read and a 0-line read, with their reason; never a lined, reading, paid or consolidated invoice', async () => {
    const failed = await addInvoice(A, {
      invoiceNumber: 'F-1',
      ocrPayload: { provider: 'reconciled', raw: { ocrFailed: true, reason: 'extraction_failed' } } as never,
    });
    const empty = await addInvoice(A, { invoiceNumber: 'E-1' });
    await addInvoice(A, { invoiceNumber: 'R-1', status: 'ocr_pending' }); // still reading
    await addInvoice(A, { invoiceNumber: 'P-1', status: 'paid' });
    await addInvoice(A, { invoiceNumber: 'M-1', source: 'manual' }); // typed, never read: not "waiting for lines"
    await addInvoice(A, {
      invoiceNumber: 'C-1',
      ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated' } } as never,
    });
    const r = await callerOf(A).invoices.needsLines();
    expect(r.count).toBe(2);
    expect(new Map(r.rows.map((x) => [x.id, x.reason]))).toEqual(
      new Map([
        [failed, 'ocr_failed'],
        [empty, 'no_lines'],
      ]),
    );
    expect(r.rows.some((x) => x.id === A.invoiceId)).toBe(false);
    expect(r.rows.find((x) => x.id === empty)!.supplierName).toBe(A.supplierName);
  });

  it('a failed read still in ocr_pending is listed (the worker gave up)', async () => {
    const id = await addInvoice(A, {
      status: 'ocr_pending',
      ocrPayload: { provider: 'reconciled', raw: { ocrFailed: true, reason: 'quota_exceeded' } } as never,
    });
    expect((await callerOf(A).invoices.needsLines()).rows.map((x) => x.id)).toEqual([id]);
  });

  it('once a line is added the invoice leaves the list', async () => {
    const id = await addInvoice(A, {});
    expect((await callerOf(A).invoices.needsLines()).count).toBe(1);
    await ownerDb.insert(invoiceLines).values({ invoiceId: id, rawDescription: 'x', qtyBilled: '1', unit: 'kg', unitPriceBilled: '1', lineTotal: '1' });
    expect((await callerOf(A).invoices.needsLines()).count).toBe(0);
  });

  it("isolation: B's unread invoice never appears for A, and A's never for B", async () => {
    const bId = await addInvoice(B, { invoiceNumber: 'B-SECRET' });
    const aId = await addInvoice(A, { invoiceNumber: 'A-1' });
    const a = await callerOf(A).invoices.needsLines();
    const b = await callerOf(B).invoices.needsLines();
    expect(a.rows.map((x) => x.id)).toEqual([aId]);
    expect(b.rows.map((x) => x.id)).toEqual([bId]);
    expect(JSON.stringify(a)).not.toContain('B-SECRET');
    // B's id under A's session: still only A's rows (the query takes no id; RLS + restaurant filter).
    await ownerDb.update(invoices).set({ invoiceNumber: 'B-SECRET-2' }).where(eq(invoices.id, bId));
    expect(JSON.stringify(await callerOf(A).invoices.needsLines())).not.toContain('B-SECRET');
  });

  const heldPayload = (reviewReasons: unknown) => ({ provider: 'reconciled', raw: { reviewReasons } }) as never;
  async function heldWithLine(t: Tenant, number: string, reviewReasons: unknown) {
    const id = await addInvoice(t, { invoiceNumber: number, ocrPayload: heldPayload(reviewReasons) });
    // A held invoice usually has lines: it is listed for its reasons, not for "no lines".
    await ownerDb.insert(invoiceLines).values({ invoiceId: id, rawDescription: 'x', qtyBilled: '1', unit: 'kg', unitPriceBilled: '1', lineTotal: '1' });
    return id;
  }

  it('a held invoice (parsed, review reasons) is listed with its non-link reasons', async () => {
    const id = await heldWithLine(A, 'H-1', ['supplier_id_mismatch', 'doc_kind_receipt']);
    const r = await callerOf(A).invoices.needsLines();
    expect(r.rows).toEqual([expect.objectContaining({ id, reason: 'held', reviewReasons: ['supplier_id_mismatch', 'doc_kind_receipt'] })]);
  });

  it('a link-only hold is NOT listed (G-08 owns it); mixed link + other shows only the other', async () => {
    await heldWithLine(A, 'L-1', ['unlinked']);
    await heldWithLine(A, 'L-2', ['unlinkedPo', 'unlinked']);
    const mixed = await heldWithLine(A, 'M-1', ['unlinked', 'consolidated_evidence']);
    const r = await callerOf(A).invoices.needsLines();
    expect(r.rows.map((x) => [x.id, x.reviewReasons])).toEqual([[mixed, ['consolidated_evidence']]]);
  });

  it("review #3: 'consolidated' is a marker, not an action — alone it is not listed; with an actionable code it is, without the marker", async () => {
    const marker = await heldWithLine(A, 'C-M', ['consolidated']);
    const unknown = await heldWithLine(A, 'C-U', ['consolidated', 'consolidated_unknown_supplier']);
    for (const id of [marker, unknown]) {
      await ownerDb
        .update(invoices)
        .set({ ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated', reviewReasons: id === marker ? ['consolidated'] : ['consolidated', 'consolidated_unknown_supplier'] } } as never })
        .where(eq(invoices.id, id));
    }
    await heldWithLine(A, 'X-1', ['supplier_id_mismatch']).then((id) => ownerDb.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, id)));
    const r = await callerOf(A).invoices.needsLines();
    expect(r.rows.map((x) => [x.id, x.reason, x.reviewReasons])).toEqual([[unknown, 'held', ['consolidated_unknown_supplier']]]);
  });

  it('review #1: a failed read whose lines a person typed (and was matched) leaves the list', async () => {
    const id = await addInvoice(A, { ocrPayload: { provider: 'reconciled', raw: { ocrFailed: true, reason: 'extraction_failed' } } as never });
    await ownerDb.insert(invoiceLines).values({ invoiceId: id, rawDescription: 'typed', qtyBilled: '2', unit: 'kg', unitPriceBilled: '5', lineTotal: '10' });
    await ownerDb.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, id));
    expect((await callerOf(A).invoices.needsLines()).rows.map((x) => x.id)).not.toContain(id);
  });

  it('review #2: link-only holds are filtered in SQL, so 205 of them never push a real hold past the LIMIT', async () => {
    const values = Array.from({ length: 205 }, (_, i) => ({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      source: 'photo' as const,
      status: 'parsed' as const,
      invoiceNumber: `LNK-${i}`,
      ocrPayload: { provider: 'reconciled', raw: { reviewReasons: i % 2 ? ['unlinked'] : [{ code: 'unlinkedPo' }] } } as never,
    }));
    const linkIds = (await ownerDb.insert(invoices).values(values).returning({ id: invoices.id })).map((x) => x.id);
    // They have lines (a held invoice usually does), so only their hold could list them.
    await ownerDb.insert(invoiceLines).values(linkIds.map((invoiceId) => ({ invoiceId, rawDescription: 'x', qtyBilled: '1', unit: 'kg', unitPriceBilled: '1', lineTotal: '1' })));
    const real = await heldWithLine(A, 'REAL-1', ['supplier_id_mismatch']);
    // The real one is the OLDEST (orderBy createdAt desc): it must still be returned.
    await ownerDb.update(invoices).set({ createdAt: new Date('2020-01-01T00:00:00Z') }).where(eq(invoices.id, real));
    const r = await callerOf(A).invoices.needsLines();
    expect(r.rows.map((x) => x.id)).toEqual([real]);
  });

  it('review #5: a scanned read with 0 lines is no_lines (warn + CTA) even when held, its reasons riding along', async () => {
    const id = await addInvoice(A, { invoiceNumber: 'Z-1', ocrPayload: heldPayload(['unlinked', 'doc_kind_receipt']) });
    expect((await callerOf(A).invoices.needsLines()).rows).toEqual([
      expect.objectContaining({ id, reason: 'no_lines', reviewReasons: ['doc_kind_receipt'], supplierId: A.supplierId }),
    ]);
  });

  it('a failed read wins over its hold reasons', async () => {
    const id = await addInvoice(A, { ocrPayload: { provider: 'reconciled', raw: { ocrFailed: true, reviewReasons: ['supplier_id_mismatch'] } } as never });
    expect((await callerOf(A).invoices.needsLines()).rows).toEqual([
      expect.objectContaining({ id, reason: 'ocr_failed', reviewReasons: ['supplier_id_mismatch'] }),
    ]);
  });

  it("held isolation: B's held invoice never reaches A", async () => {
    await heldWithLine(B, 'B-HELD', ['supplier_id_mismatch']);
    expect((await callerOf(A).invoices.needsLines()).count).toBe(0);
    expect((await callerOf(B).invoices.needsLines()).count).toBe(1);
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerOf(B, role).invoices.needsLines()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('holdReasonsOf reads loosely: strings or {code}, deduped, link codes dropped, junk ignored', () => {
    expect(holdReasonsOf(['a', { code: 'b' }, 'a', 'unlinked', 'consolidated', 3, null, { x: 1 }])).toEqual(['a', 'b']);
    expect(holdReasonsOf(null)).toEqual([]);
    expect(holdReasonsOf('supplier_id_mismatch')).toEqual([]);
  });

  it('owner, manager and bookkeeper may read; receiver and chef are FORBIDDEN', async () => {
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      await expect(callerOf(A, role).invoices.needsLines()).resolves.toMatchObject({ count: 0 });
    }
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerOf(A, role).invoices.needsLines()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
