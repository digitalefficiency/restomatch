import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { normalizeBusinessId, normalizeSupplierName } from '../routers/suppliers';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Pilot: a supplier carries its VAT rate (0% for fresh produce), and the
 * supplier setup refuses a second active supplier with the same ח.פ. / warns on
 * the same name. seedTenant gives A ח.פ. 512345671 "ספק A", B 512345672 "ספק B".
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(async () => {
  await resetDb(db);
});

describe('supplier VAT rate', () => {
  it('create persists 0 / 0.18 / null and get round-trips it', async () => {
    const caller = callerFor(A);
    const produce = await caller.suppliers.create({ name: 'ירקות השרון', vatRate: 0 });
    const regular = await caller.suppliers.create({ name: 'מאפיית הגליל', vatRate: 0.18 });
    const dflt = await caller.suppliers.create({ name: 'דגי הים' });
    expect(Number(produce.vatRate)).toBe(0);
    expect(produce.vatRate).not.toBeNull();
    expect(Number(regular.vatRate)).toBe(0.18);
    expect(dflt.vatRate).toBeNull();
    expect(Number((await caller.suppliers.get({ supplierId: produce.id })).vatRate)).toBe(0);
  });

  it('update sets, clears, and leaves the rate untouched when omitted', async () => {
    const caller = callerFor(A);
    const set = await caller.suppliers.update({ supplierId: A.supplierId, patch: { vatRate: 0 } });
    expect(Number(set.vatRate)).toBe(0);
    const untouched = await caller.suppliers.update({ supplierId: A.supplierId, patch: { paymentTerms: 'שוטף + 30' } });
    expect(Number(untouched.vatRate)).toBe(0);
    const cleared = await caller.suppliers.update({ supplierId: A.supplierId, patch: { vatRate: null } });
    expect(cleared.vatRate).toBeNull();
  });

  it('only 0% and 18% are accepted', async () => {
    await expect(
      callerFor(A).suppliers.update({ supplierId: A.supplierId, patch: { vatRate: 0.17 as never } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('the matcher uses the supplier rate, and null falls back to the restaurant rate', async () => {
    await db.update(restaurants).set({ vatRate: '0.18' }).where(eq(restaurants.id, A.restaurantId));
    await callerFor(A).suppliers.update({ supplierId: A.supplierId, patch: { vatRate: 0 } });
    expect((await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))?.input.vatRate).toBe(0);
    await callerFor(A).suppliers.update({ supplierId: A.supplierId, patch: { vatRate: null } });
    expect((await buildMatchInputForInvoice(db, A.restaurantId, A.invoiceId))?.input.vatRate).toBe(0.18);
  });

  it('a receiver cannot change the rate', async () => {
    await expect(
      callerFor(A, 'receiver').suppliers.update({ supplierId: A.supplierId, patch: { vatRate: 0 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('duplicate supplier guard', () => {
  it('normalises ח.פ. to digits and names without punctuation / legal suffix', () => {
    expect(normalizeBusinessId('51-234567-1')).toBe('512345671');
    expect(normalizeBusinessId(' ')).toBeNull();
    expect(normalizeSupplierName('ירקות השרון בע"מ')).toBe('ירקות השרון');
    expect(normalizeSupplierName('ירקות  השרון בע״מ')).toBe('ירקות השרון');
    expect(normalizeSupplierName('Sharon-Produce Ltd.')).toBe('sharon produce');
  });

  it('a second active supplier with the same ח.פ. is refused unless allowDuplicate', async () => {
    const caller = callerFor(A);
    await expect(caller.suppliers.create({ name: 'שם אחר לגמרי', businessId: '51-234567-1' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const forced = await caller.suppliers.create({ name: 'שם אחר לגמרי', businessId: '512345671', allowDuplicate: true });
    expect(forced.businessId).toBe('512345671');
  });

  it('the same normalised name is a confirmable warning', async () => {
    const caller = callerFor(A);
    await expect(caller.suppliers.create({ name: 'ספק  A בע"מ' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const confirmed = await caller.suppliers.create({ name: 'ספק  A בע"מ', allowDuplicate: true });
    expect(confirmed.name).toBe('ספק  A בע"מ');
  });

  it('an inactive supplier never blocks, but reactivating a duplicate ח.פ. is refused', async () => {
    const caller = callerFor(A);
    await caller.suppliers.setActive({ supplierId: A.supplierId, active: false });
    const fresh = await caller.suppliers.create({ name: 'ספק A', businessId: '512345671' });
    await expect(caller.suppliers.setActive({ supplierId: A.supplierId, active: true })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const back = await caller.suppliers.setActive({ supplierId: A.supplierId, active: true, allowDuplicate: true });
    expect(back.active).toBe(true);
    expect(fresh.active).toBe(true);
  });

  it('update refuses a changed ח.פ. that another active supplier holds, but re-saving its own is fine', async () => {
    const caller = callerFor(A);
    const other = await caller.suppliers.create({ name: 'מאפיית הגליל', businessId: '511111111' });
    await expect(
      caller.suppliers.update({ supplierId: other.id, patch: { businessId: '512345671' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const same = await caller.suppliers.update({
      supplierId: A.supplierId,
      patch: { name: 'ספק A', businessId: '512345671', paymentTerms: 'מזומן' },
    });
    expect(same.paymentTerms).toBe('מזומן');
    await expect(caller.suppliers.update({ supplierId: other.id, patch: { name: 'ספק A' } })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('another tenant\'s supplier never blocks (cross-tenant isolation of the check)', async () => {
    const created = await callerFor(A).suppliers.create({ name: 'ספק B', businessId: '512345672' });
    expect(created.restaurantId).toBe(A.restaurantId);
    const [bRow] = await db.select().from(suppliers).where(eq(suppliers.id, B.supplierId));
    expect(bRow?.restaurantId).toBe(B.restaurantId);
    // B is likewise not blocked by what A now holds.
    await expect(callerFor(B).suppliers.create({ name: 'ספק C', businessId: '512345671' })).resolves.toMatchObject({
      restaurantId: B.restaurantId,
    });
  });
});
