import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, invoiceLines, invoices, priceHistory, restaurants } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * H-11ʰ slice c · least-privilege money visibility (owner decision 6; binding
 * rule "the receiver sees no ₪"). Add-only attack block for the procedures the
 * slice-c audit found (docs/ux/wave4/H-11c-AUDIT.md):
 *   - receiving.priceContext: the receiver keeps the non-₪ signal (priceHigher,
 *     %, samples) and gets the prices null;
 *   - approvals.myQueue / queueSummary: FORBIDDEN for receiver and chef (no ₪,
 *     not ₪0);
 *   - consolidated.coverage: the receiver gets each note's received ₪ null;
 *   - pins: reads that carry no ₪ today keep carrying none for receiver / chef.
 * Owner / manager / bookkeeper values are unchanged. B's ids stay rejected.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

type Role = NonNullable<Session['role']>;
const MONEY_ROLES: Role[] = ['owner', 'manager', 'bookkeeper'];
const STAFF: Role[] = ['receiver', 'chef'];

function callerFor(t: Tenant, role: Role) {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

/** ₪-looking keys anywhere in a response whose value is not null. `allow` names keys known to be counts. */
const MONEY_KEY = /(price|amount|total|ils$|agorot|vat|cost|delta|expected|actual)/i;
/** Timestamps and dates are not money (expectedAt, expectedDeliveryAt, invoiceDate). */
const DATE_KEY = /(At|Date)$/;
function moneyValuedKeys(value: unknown, allow: ReadonlyArray<string> = [], path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyValuedKeys(v, allow, `${path}[${i}]`));
  if (!value || typeof value !== 'object' || value instanceof Date) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const here = `${path}.${k}`;
    const own = MONEY_KEY.test(k) && !DATE_KEY.test(k) && !allow.includes(k) && v !== null && typeof v !== 'object' ? [here] : [];
    return [...own, ...moneyValuedKeys(v, allow, here)];
  });
}

describe('H-11 slice c · receiver and chef get no ₪ (A own ids; B ids rejected)', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    for (const t of [A, B]) {
      await db
        .update(restaurants)
        .set({ settings: { features: { dockPriceContext: true, consolidatedMatch: true } } as never })
        .where(eq(restaurants.id, t.restaurantId));
    }
    // Three earlier prices for A's product from A's supplier, inside the 90-day window
    // before A's invoice, so priceContext has a usual price to compare against.
    const [inv] = await db.select({ invoiceDate: invoices.invoiceDate }).from(invoices).where(eq(invoices.id, A.invoiceId));
    const anchor = inv!.invoiceDate!.getTime();
    await db.update(invoiceLines).set({ productId: A.productId, unitPriceBilled: '12.0000' }).where(eq(invoiceLines.id, A.invoiceLineId));
    await db.insert(priceHistory).values(
      [10, 20, 30].map((daysBefore) => ({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        productId: A.productId,
        unitPrice: '10.0000',
        observedAt: new Date(anchor - daysBefore * 24 * 60 * 60 * 1000),
      })) as never,
    );
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('receiving.priceContext: the receiver gets the prices null and keeps priceHigher / % / samples', async () => {
    const owner = await callerFor(A, 'owner').receiving.priceContext({ invoiceId: A.invoiceId });
    expect(owner.enabled).toBe(true);
    expect(owner.lines.length).toBeGreaterThan(0);
    expect(owner.lines[0]?.usualUnitPrice).toBe(10);
    for (const role of MONEY_ROLES) {
      expect(await callerFor(A, role).receiving.priceContext({ invoiceId: A.invoiceId }), role).toEqual(owner);
    }
    const receiver = await callerFor(A, 'receiver').receiving.priceContext({ invoiceId: A.invoiceId });
    expect(receiver).toEqual({
      enabled: true,
      lines: owner.lines.map((l) => ({ ...l, billedUnitPrice: null, usualUnitPrice: null })),
    });
    // The chef is not an invoice reader: FORBIDDEN, as before.
    await expect(callerFor(A, 'chef').receiving.priceContext({ invoiceId: A.invoiceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // B's invoice never resolves for A's receiver.
    expect((await callerFor(A, 'receiver').receiving.priceContext({ invoiceId: B.invoiceId })).lines).toEqual([]);
  });

  it('approvals.myQueue / queueSummary: FORBIDDEN for receiver and chef; money roles unchanged', async () => {
    for (const role of STAFF) {
      await expect(callerFor(A, role).approvals.myQueue(), role).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A, role).approvals.queueSummary(), role).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    for (const role of MONEY_ROLES) {
      expect(Array.isArray(await callerFor(A, role).approvals.myQueue()), role).toBe(true);
      const s = await callerFor(A, role).approvals.queueSummary();
      expect(typeof s.claimableIls, role).toBe('number');
    }
  });

  it('consolidated.coverage: the receiver gets receivedValueIls null; the state and numbers stay', async () => {
    const range = { supplierId: A.supplierId, from: '2020-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' };
    const owner = await callerFor(A, 'owner').consolidated.coverage(range);
    expect(owner.length).toBeGreaterThan(0);
    expect(owner.every((n) => typeof n.receivedValueIls === 'number')).toBe(true);
    for (const role of MONEY_ROLES) {
      expect(await callerFor(A, role).consolidated.coverage(range), role).toEqual(owner);
    }
    const receiver = await callerFor(A, 'receiver').consolidated.coverage(range);
    expect(receiver).toEqual(owner.map((n) => ({ ...n, receivedValueIls: null })));
    expect(moneyValuedKeys(receiver)).toEqual([]);
    await expect(callerFor(A, 'chef').consolidated.coverage(range)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // B's supplier yields nothing for A's receiver.
    expect(await callerFor(A, 'receiver').consolidated.coverage({ ...range, supplierId: B.supplierId })).toEqual([]);
  });

  it('pins: reads with no ₪ today carry no ₪ value for receiver and chef', async () => {
    for (const role of STAFF) {
      const c = callerFor(A, role);
      expect(moneyValuedKeys(await c.receiving.todayExpectations()), `${role} todayExpectations`).toEqual([]);
      expect(moneyValuedKeys(await c.receiving.pendingInvoices()), `${role} pendingInvoices`).toEqual([]);
      expect(moneyValuedKeys(await c.search.global({ q: 'tomato' })), `${role} search.global`).toEqual([]);
      expect(moneyValuedKeys(await c.products.list(), ['total']), `${role} products.list`).toEqual([]);
      expect(moneyValuedKeys(await c.mapping.unmapped()), `${role} mapping.unmapped`).toEqual([]);
      expect(moneyValuedKeys(await c.mapping.searchProducts({ q: 'tomato' })), `${role} mapping.searchProducts`).toEqual([]);
    }
  });
});
