import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, purchaseOrders, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { ORDER_WRITE_ROLES, PRICE_KEY } from '../orders/access';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-06 role × procedure matrix for the new orders procedures (extends W1-11's).
 * Writes: ORDER_WRITE_ROLES (owner, manager; + chef when train A / G-07 is on the
 * base — owner 31.10: the chef orders freely). Receiver: FORBIDDEN on writes and
 * the guide; reads carry no ₪. Bookkeeper: read-only, with ₪.
 */
const db = createDb(testDbUrl());
let A: Tenant;
const ROLES: Session['role'][] = ['owner', 'manager', 'chef', 'receiver', 'bookkeeper'];
const callerFor = (role: Session['role']) =>
  appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role } } as AppContext);

/** Every key path in a payload that looks like ₪. */
function priceKeys(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => priceKeys(x, `${path}[${i}]`));
  if (v === null || typeof v !== 'object' || v instanceof Date) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
    PRICE_KEY.test(k) ? [`${path}.${k}`] : priceKeys(x, `${path}.${k}`),
  );
}

describe('orders W2-06 role matrix', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db.update(suppliers).set({ contactWhatsapp: '0525551234' }).where(eq(suppliers.id, A.supplierId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  for (const role of ROLES) {
    const writes = ORDER_WRITE_ROLES.includes(role);
    it(`${role}: order writes ${writes ? 'allowed' : 'FORBIDDEN'}`, async () => {
      const c = callerFor(role);
      const calls = [
        () => c.orders.orderGuide({ supplierId: A.supplierId }),
        () => c.orders.openDraft({ supplierId: A.supplierId }),
        // owner/manager share one user here, so save onto that user's open draft.
        async () => {
          const open = writes ? await c.orders.openDraft({ supplierId: A.supplierId }) : null;
          return c.orders.saveDraft({
            draftId: open?.draftId ?? null,
            version: open?.version ?? null,
            supplierId: A.supplierId,
            lines: [{ rawDescription: `x-${role}`, qty: 1, unit: 'kg' }],
            clientMutationId: `matrix-${role}`,
          });
        },
      ];
      for (const call of calls) {
        if (writes) await expect(call()).resolves.toBeDefined();
        else await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      // These need a draft id; FORBIDDEN must come before any lookup.
      if (!writes) {
        const poId = A.poId;
        await expect(c.orders.markSentManually({ poId, clientMutationId: 'matrix-0001' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(c.orders.prepareManualSend({ poId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(c.orders.addOrderLine({ poId, line: { rawDescription: 'x', qty: 1, unit: 'kg' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(c.orders.sendMany({ items: [{ poId, expectedStatus: 'draft' }], channel: 'none' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(c.orders.amendSent({ poId, changes: [{ qtyDelta: 1, unit: 'kg', rawDescription: 'x' }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });
  }

  it('the chef sees prices on the orders screens [owner 31.10]; the receiver sees no ₪ key anywhere', async () => {
    for (const role of ['owner', 'manager', 'chef', 'bookkeeper'] as const) {
      const list = await callerFor(role).orders.list();
      expect(priceKeys(list).length, role).toBeGreaterThan(0);
    }
    const r = callerFor('receiver');
    const payloads = [await r.orders.list(), await r.orders.get({ poId: A.poId }), await r.orders.supplierBoard()];
    for (const p of payloads) expect(priceKeys(p)).toEqual([]);
  });

  it('the receiver never drafts (owner 31.10): createDraft / captureFromText / saveDraft → FORBIDDEN, nothing written', async () => {
    const r = callerFor('receiver');
    const before = await db.select().from(purchaseOrders).where(eq(purchaseOrders.restaurantId, A.restaurantId));
    await expect(
      r.orders.createDraft({ supplierId: A.supplierId, lines: [{ rawDescription: 'x', qty: 1, unit: 'kg' }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(r.orders.captureFromText({ text: '2 ק״ג עגבניות' } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      r.orders.saveDraft({ supplierId: A.supplierId, lines: [{ rawDescription: 'x', qty: 1, unit: 'kg' }], clientMutationId: 'rcv-00001' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const after = await db.select().from(purchaseOrders).where(eq(purchaseOrders.restaurantId, A.restaurantId));
    expect(after).toHaveLength(before.length);
  });

  it('the board is readable by every member', async () => {
    for (const role of ROLES) {
      const b = await callerFor(role).orders.supplierBoard();
      expect(b.rows.map((x) => x.supplierId)).toContain(A.supplierId);
    }
  });
});
