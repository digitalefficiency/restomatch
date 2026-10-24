import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  poLines,
  purchaseOrders,
  restaurants,
  supplierConfirmLinks,
  supplierResponses,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import {
  confirmationLink,
  createSupplierLink,
  hashSupplierToken,
  LINK_TTL_MS,
  loadSupplierOrder,
  mintToken,
  resolveSupplierToken,
  submitSupplierAnswer,
  supplierResponseDiff,
} from '../supplierConfirm/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function setFlag(t: Tenant, on: boolean) {
  await db
    .update(restaurants)
    .set({ settings: (on ? { features: { supplierConfirm: true } } : {}) as RestaurantSettings })
    .where(eq(restaurants.id, t.restaurantId));
}

async function resolveOk(token: string, now?: Date) {
  const r = await resolveSupplierToken(db, token, now);
  if (!r.ok) throw new Error(`expected a valid link, got ${r.error}`);
  return r.link;
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

beforeEach(async () => {
  await db.delete(supplierResponses);
  await db.delete(supplierConfirmLinks);
  await setFlag(A, true);
  await setFlag(B, true);
  for (const t of [A, B]) await db.update(purchaseOrders).set({ status: 'sent' }).where(eq(purchaseOrders.id, t.poId));
});

afterAll(async () => {
  await resetDb(db);
});

describe('tokens', () => {
  it('are 256-bit base64url and only their SHA-256 is stored', async () => {
    const link = await createSupplierLink(db, A.restaurantId, A.poId);
    expect(link!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await db.select().from(supplierConfirmLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashSupplierToken(link!.token));
    expect(JSON.stringify(rows)).not.toContain(link!.token);
    expect(rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime()).toBe(LINK_TTL_MS);
  });

  it('guessing: random, malformed, truncated and hash-as-token are all NOT_FOUND', async () => {
    const link = await createSupplierLink(db, A.restaurantId, A.poId);
    for (const guess of [mintToken(), 'x', '', 'a'.repeat(43), link!.token.slice(0, 42), `${link!.token}A`, hashSupplierToken(link!.token), "' or 1=1 --"]) {
      expect(await resolveSupplierToken(db, guess)).toEqual({ ok: false, error: 'NOT_FOUND' });
    }
  });

  it('expire after 72h; revoked links and a flag-off restaurant are NOT_FOUND', async () => {
    const now = new Date('2026-10-24T10:00:00Z');
    const link = await createSupplierLink(db, A.restaurantId, A.poId, { now });
    expect((await resolveSupplierToken(db, link!.token, new Date(now.getTime() + LINK_TTL_MS - 1000))).ok).toBe(true);
    expect(await resolveSupplierToken(db, link!.token, new Date(now.getTime() + LINK_TTL_MS))).toEqual({ ok: false, error: 'EXPIRED' });

    const fresh = await createSupplierLink(db, A.restaurantId, A.poId);
    await setFlag(A, false);
    expect(await resolveSupplierToken(db, fresh!.token)).toEqual({ ok: false, error: 'NOT_FOUND' });
    await setFlag(A, true);
    await db.update(supplierConfirmLinks).set({ revokedAt: new Date() }).where(eq(supplierConfirmLinks.tokenHash, hashSupplierToken(fresh!.token)));
    expect(await resolveSupplierToken(db, fresh!.token)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('only sent orders get a link (draft / cancelled / foreign → null)', async () => {
    await db.update(purchaseOrders).set({ status: 'draft' }).where(eq(purchaseOrders.id, A.poId));
    expect(await createSupplierLink(db, A.restaurantId, A.poId)).toBeNull();
    await db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, A.poId));
    expect(await createSupplierLink(db, A.restaurantId, A.poId)).toBeNull();
    expect(await createSupplierLink(db, A.restaurantId, B.poId)).toBeNull();
  });
});

describe('supplier view + answer', () => {
  it('shows the order lines with the agreed price', async () => {
    const link = await resolveOk((await createSupplierLink(db, A.restaurantId, A.poId))!.token);
    const view = await loadSupplierOrder(db, link);
    expect(view).toMatchObject({ restaurantName: 'Resto A', supplierName: 'ספק A', response: null });
    expect(view!.lines).toEqual([
      expect.objectContaining({ id: A.poLineId, qtyOrdered: 10, unit: 'kg', unitPrice: 8.5 }),
    ]);
  });

  it('an unchanged answer is "confirmed"; shortage + price → "changes"; the PO is never written', async () => {
    const before = await db.select().from(poLines).where(eq(poLines.id, A.poLineId));
    const link = await resolveOk((await createSupplierLink(db, A.restaurantId, A.poId))!.token);
    expect(
      await submitSupplierAnswer(db, link, { lines: [{ poLineId: A.poLineId, qtyAvailable: 6, proposedUnitPrice: 9.25 }], note: ' נגמרו העגבניות ' }),
    ).toEqual({ ok: true, status: 'changes' });
    const diff = await supplierResponseDiff(db, A.restaurantId, A.poId);
    expect(diff.response).toMatchObject({
      status: 'changes',
      note: 'נגמרו העגבניות',
      lines: [{ poLineId: A.poLineId, qtyOrdered: 10, qtyAvailable: 6, unitPriceAgreed: 8.5, proposedUnitPrice: 9.25 }],
    });
    expect(await db.select().from(poLines).where(eq(poLines.id, A.poLineId))).toEqual(before);

    await db.delete(supplierResponses);
    expect(
      await submitSupplierAnswer(db, link, { lines: [{ poLineId: A.poLineId, qtyAvailable: 10, proposedUnitPrice: 8.5 }] }),
    ).toEqual({ ok: true, status: 'confirmed' });
    expect((await supplierResponseDiff(db, A.restaurantId, A.poId)).response!.lines).toEqual([]);
  });

  it('replay: a second submit (same or another link of the same order) is refused', async () => {
    const t1 = (await createSupplierLink(db, A.restaurantId, A.poId))!.token;
    const t2 = (await createSupplierLink(db, A.restaurantId, A.poId))!.token;
    const l1 = await resolveOk(t1);
    expect((await submitSupplierAnswer(db, l1, { lines: [] })).ok).toBe(true);
    expect(await submitSupplierAnswer(db, l1, { lines: [] })).toEqual({ ok: false, error: 'ALREADY_ANSWERED' });
    expect(await submitSupplierAnswer(db, await resolveOk(t2), { lines: [{ poLineId: A.poLineId, qtyAvailable: 1 }] })).toEqual({
      ok: false,
      error: 'ALREADY_ANSWERED',
    });
    expect(await db.select().from(supplierResponses)).toHaveLength(1);
  });

  it('cross-order / cross-tenant: a line of another order is rejected and nothing is written', async () => {
    const link = await resolveOk((await createSupplierLink(db, A.restaurantId, A.poId))!.token);
    expect(await submitSupplierAnswer(db, link, { lines: [{ poLineId: B.poLineId, qtyAvailable: 0 }] })).toEqual({
      ok: false,
      error: 'BAD_LINE',
    });
    // a forged link object pointing at B's order under A's restaurant finds nothing
    expect(await submitSupplierAnswer(db, { ...link, poId: B.poId }, { lines: [] })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await loadSupplierOrder(db, { ...link, poId: B.poId })).toBeNull();
    expect(await db.select().from(supplierResponses)).toEqual([]);
  });

  it('rejects duplicate lines and out-of-range values', async () => {
    const link = await resolveOk((await createSupplierLink(db, A.restaurantId, A.poId))!.token);
    const bad = [
      [{ poLineId: A.poLineId, qtyAvailable: 1 }, { poLineId: A.poLineId, qtyAvailable: 2 }],
      [{ poLineId: A.poLineId, qtyAvailable: -1 }],
      [{ poLineId: A.poLineId, qtyAvailable: Number.NaN }],
      [{ poLineId: A.poLineId, proposedUnitPrice: 0 }],
      [{ poLineId: A.poLineId, proposedUnitPrice: 1e9 }],
    ];
    for (const lines of bad) expect((await submitSupplierAnswer(db, link, { lines })).ok).toBe(false);
    expect(await db.select().from(supplierResponses)).toEqual([]);
  });
});

describe('confirmationLink (for the order document, S5)', () => {
  it('returns an absolute 72h URL when the flag is on, null when off', async () => {
    const r = await confirmationLink(db, A.restaurantId, A.poId, { baseUrl: 'https://app.test/' });
    expect(r!.url).toMatch(/^https:\/\/app\.test\/s\/[A-Za-z0-9_-]{43}$/);
    expect((await resolveSupplierToken(db, r!.url.split('/s/')[1]!)).ok).toBe(true);
    await setFlag(A, false);
    expect(await confirmationLink(db, A.restaurantId, A.poId, { baseUrl: 'https://app.test' })).toBeNull();
  });
});

describe('supplierConfirm router', () => {
  it('createLink → path (manager), responses (member); feature + role gates', async () => {
    const { path } = await caller(A, 'manager').supplierConfirm.createLink({ poId: A.poId });
    expect(path).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
    expect(await caller(A, 'receiver').supplierConfirm.responses({ poId: A.poId })).toMatchObject({ response: null });
    await expect(caller(A, 'receiver').supplierConfirm.createLink({ poId: A.poId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setFlag(A, false);
    await expect(caller(A).supplierConfirm.createLink({ poId: A.poId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: expect.objectContaining({ appCode: 'FEATURE_DISABLED' }),
    });
  });

  it('createLink refuses a draft order with a stable code', async () => {
    await db.update(purchaseOrders).set({ status: 'draft' }).where(eq(purchaseOrders.id, A.poId));
    await expect(caller(A, 'manager').supplierConfirm.createLink({ poId: A.poId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/^SUPPLIER_CONFIRM_NOT_SENT/),
    });
  });
});
