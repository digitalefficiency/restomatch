import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createDb, eq, invoices, notificationsOutbox, restaurants, suppliers } from '@restomatch/db';
import { router } from '../trpc';
import type { AppContext, Session } from '../context';
import { vatRouter } from '../routers/vat';
import { israelDay } from '../vat/caseState';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-08 attack suite: tenant isolation and roles for every vat.* procedure.
 * `vat` is mounted locally until its appRouter line lands.
 */
const testRouter = router({ vat: vatRouter });
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let bInvoice: string;
let aInvoice: string;

const day = (() => {
  const d = new Date(`${israelDay(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 5);
  return d.toISOString().slice(0, 10);
})();
const cmid = () => `cm-${Math.random().toString(36).slice(2, 12)}`;

function vatAs(t: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return testRouter.createCaller(ctx).vat;
}

async function atRiskInvoice(t: Tenant) {
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceNumber: `ATK-${Math.random().toString(36).slice(2, 8)}`,
      invoiceDate: new Date(`${day}T10:00:00+03:00`),
      totalExclVat: '6000.00',
      vatAmount: '1080.00',
      status: 'parsed',
      source: 'photo',
    })
    .returning({ id: invoices.id });
  return row!.id;
}

describe('AU-08 vat.* attack', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    for (const t of [A, B]) {
      await db.update(restaurants).set({ settings: { features: { vatAtRisk: true } } as never }).where(eq(restaurants.id, t.restaurantId));
    }
    aInvoice = await atRiskInvoice(A);
    bInvoice = await atRiskInvoice(B);
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it("foreign invoiceId / supplierId → NOT_FOUND and B untouched", async () => {
    const a = vatAs(A);
    await expect(a.invoiceCase({ invoiceId: bInvoice })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(a.requestDraft({ supplierId: B.supplierId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      a.setAllocationNumber({ invoiceId: bInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      a.markRequested({ supplierId: B.supplierId, invoiceIds: [bInvoice], channel: 'copy', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Own supplier, foreign invoice mixed in → NOT_FOUND, nothing written.
    await expect(
      a.markRequested({ supplierId: A.supplierId, invoiceIds: [aInvoice, bInvoice], channel: 'copy', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [bRow] = await db.select({ a: invoices.allocationNumber }).from(invoices).where(eq(invoices.id, bInvoice));
    expect(bRow!.a).toBeNull();
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.restaurantId, B.restaurantId))).filter((r) => r.action.startsWith('vat.')),
    ).toHaveLength(0);
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.restaurantId, A.restaurantId))).filter((r) => r.action.startsWith('vat.')),
    ).toHaveLength(0);
  });

  it("A's draft never contains B's invoices", async () => {
    const d = await vatAs(A).requestDraft({ supplierId: A.supplierId });
    expect(d!.invoices.map((i) => i.invoiceId)).toEqual([aInvoice]);
    expect(JSON.stringify(d)).not.toContain(bInvoice);
  });

  it('receiver and chef → FORBIDDEN on every vat.*', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      const v = vatAs(A, role);
      await expect(v.invoiceCase({ invoiceId: aInvoice })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(v.requestDraft({ supplierId: A.supplierId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        v.setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        v.markRequested({ supplierId: A.supplierId, invoiceIds: [aInvoice], channel: 'copy', clientMutationId: cmid() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('manager reads but may not write (ALLOCATION_WRITE_ROLES default); bookkeeper writes', async () => {
    const m = vatAs(A, 'manager');
    expect((await m.invoiceCase({ invoiceId: aInvoice }))!.canWrite).toBe(false);
    expect(await m.requestDraft({ supplierId: A.supplierId })).toMatchObject({ canWrite: false });
    expect(await vatAs(A, 'bookkeeper').requestDraft({ supplierId: A.supplierId })).toMatchObject({ canWrite: true });
    await expect(
      m.setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      m.markRequested({ supplierId: A.supplierId, invoiceIds: [aInvoice], channel: 'copy', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const bk = vatAs(A, 'bookkeeper');
    await bk.markRequested({ supplierId: A.supplierId, invoiceIds: [aInvoice], channel: 'email', clientMutationId: cmid() });
    await bk.setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() });
  });

  it('a replayed clientMutationId from tenant B does not leak A’s recorded result', async () => {
    const id = cmid();
    await vatAs(A).setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: id });
    const r = await vatAs(B).setAllocationNumber({ invoiceId: bInvoice, allocationNumber: '987654321', source: 'typed', clientMutationId: id });
    expect(r).toEqual({ invoiceId: bInvoice, allocationNumber: '987654321', replayed: false });
  });

  it('a reused clientMutationId for a different invoice / request is a CONFLICT, never a false replay', async () => {
    const a = vatAs(A);
    const other = await atRiskInvoice(A);
    const id = cmid();
    await a.setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: id });
    await expect(
      a.setAllocationNumber({ invoiceId: other, allocationNumber: '123456789', source: 'typed', clientMutationId: id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [o] = await db.select({ a: invoices.allocationNumber }).from(invoices).where(eq(invoices.id, other));
    expect(o!.a).toBeNull();

    const rid = cmid();
    const first = await a.markRequested({ supplierId: A.supplierId, invoiceIds: [other], channel: 'copy', clientMutationId: rid });
    expect(first).toMatchObject({ replayed: false });
    const again = await a.markRequested({ supplierId: A.supplierId, invoiceIds: [other], channel: 'copy', clientMutationId: rid });
    expect(again).toMatchObject({ supplierId: A.supplierId, invoiceIds: [other], replayed: true });
    await expect(
      a.markRequested({ supplierId: A.supplierId, invoiceIds: [other, aInvoice], channel: 'copy', clientMutationId: rid }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("B's corrected copy pointing at A's invoice never becomes A's suggestion", async () => {
    await db.insert(invoices).values({
      restaurantId: B.restaurantId,
      supplierId: B.supplierId,
      invoiceNumber: null,
      invoiceDate: new Date(`${day}T10:00:00+03:00`),
      totalExclVat: '6000.00',
      vatAmount: '1080.00',
      allocationNumber: '555666777',
      status: 'parsed',
      source: 'photo',
      ocrPayload: { raw: { duplicateOf: { invoiceId: aInvoice, invoiceNumber: 'X' } } } as never,
    });
    const ic = await vatAs(A).invoiceCase({ invoiceId: aInvoice });
    expect(ic!.row!.suggestedNumber).toBeNull();
    await expect(
      vatAs(A).setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '555666777', source: 'corrected_copy', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('no notifications_outbox row targets a supplier after any vat.* call', async () => {
    const a = vatAs(A);
    await db.update(suppliers).set({ contactWhatsapp: '054-1234567', contactEmail: 'orders@supplier.co.il' }).where(eq(suppliers.id, A.supplierId));
    const before = (await db.select({ id: notificationsOutbox.id }).from(notificationsOutbox)).map((r) => r.id);
    await a.requestDraft({ supplierId: A.supplierId });
    await a.markRequested({ supplierId: A.supplierId, invoiceIds: [aInvoice], channel: 'whatsapp', clientMutationId: cmid() });
    await a.setAllocationNumber({ invoiceId: aInvoice, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() });
    const after = await db.select().from(notificationsOutbox);
    expect(after.map((r) => r.id).sort()).toEqual(before.sort());
    const blob = JSON.stringify(after);
    expect(blob).not.toContain('orders@supplier.co.il');
    expect(blob).not.toContain('541234567');
  });
});
