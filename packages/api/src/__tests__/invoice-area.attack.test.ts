import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@restomatch/db';
import { resetDb } from './fixtures';
import type { Desk } from './approvals-desk.fixtures';
import { areaDbs, callerOn, deepKeys, IDENTITY_KEY, seedTwo } from './invoice-area.fixtures';

/**
 * INV-00 · the invoices area's new reads (`invoices.holding`, `invoices.history`,
 * `approvals.decided`) are role-gated and tenant-scoped, on the RLS app role. Declared in
 * `coverage/IA-04.ts`.
 */
let ownerDb: Database;
let appDb: Database;
let A: Desk;
let B: Desk;

beforeAll(async () => {
  ({ ownerDb, appDb } = await areaDbs());
  ({ A, B } = await seedTwo(ownerDb, 'IA'));
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('role gate', () => {
  for (const role of ['receiver', 'chef'] as const) {
    it(`${role}: FORBIDDEN on invoices.holding, invoices.history and approvals.decided`, async () => {
      const c = callerOn(appDb, A, role);
      await expect(c.invoices.holding({ invoiceIds: [A.invoiceId] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(c.invoices.history({ invoiceId: A.invoiceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(c.approvals.decided({ period: 'today' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  }

  for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
    it(`${role}: may read all three`, async () => {
      const c = callerOn(appDb, A, role);
      await expect(c.invoices.holding({ invoiceIds: [A.invoiceId] })).resolves.toBeInstanceOf(Array);
      await expect(c.invoices.history({ invoiceId: A.invoiceId })).resolves.toMatchObject({ events: expect.any(Array) });
      await expect(c.approvals.decided({ period: 'today' })).resolves.toMatchObject({ rows: expect.any(Array) });
    });
  }
});

describe('tenant scope', () => {
  it("invoices.holding: B's invoice ids give A no entry", async () => {
    const out = await callerOn(appDb, A, 'owner').invoices.holding({ invoiceIds: [B.invoiceId] });
    expect(out.map((e) => e.invoiceId)).not.toContain(B.invoiceId);
    expect(out).toEqual([]);
  });

  it("invoices.history: A reading B's invoice → NOT_FOUND", async () => {
    await expect(callerOn(appDb, A, 'owner').invoices.history({ invoiceId: B.invoiceId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("approvals.decided: A's list never holds one of B's gaps", async () => {
    const { rows } = await callerOn(appDb, A, 'owner').approvals.decided({ period: 'week' });
    expect(rows.map((r) => r.id)).not.toContain(B.discrepancyId);
  });

  it('no new read carries a userId, name or e-mail key', async () => {
    const c = callerOn(appDb, A, 'owner');
    const payloads = [
      await c.invoices.holding({ invoiceIds: [A.invoiceId] }),
      await c.invoices.history({ invoiceId: A.invoiceId }),
      await c.approvals.decided({ period: 'week' }),
    ];
    for (const p of payloads) expect([...deepKeys(p)].filter((k) => IDENTITY_KEY.test(k))).toEqual([]);
  });
});
