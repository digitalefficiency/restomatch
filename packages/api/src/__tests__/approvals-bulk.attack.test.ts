/**
 * W2-04 cross-tenant attack: the new bulk procedures and the queue's
 * `invoiceIds` / `scope` inputs. Tenant B's session aims at tenant A's ids.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, inArray, testDbUrl } from '@restomatch/db';
import { resetDb } from './fixtures';
import { addGap, addInvoice, callerAs, seedDesk, type Desk } from './approvals-desk.fixtures';

const db = createDb(testDbUrl());
let A: Desk;
let B: Desk;
let aExtra: string;

beforeAll(async () => {
  await resetDb(db);
  A = await seedDesk(db, 'BA');
  B = await seedDesk(db, 'BB');
  const { matchRunId } = await addInvoice(db, A, 'a2');
  aExtra = await addGap(db, A, matchRunId, { deltaAmount: '9.00' });
});
afterAll(async () => {
  await resetDb(db);
});

const aStatuses = async () =>
  (await db.select().from(discrepancies).where(inArray(discrepancies.id, [A.discrepancyId, aExtra]))).map(
    (r) => r.resolutionStatus,
  );

describe('approvals bulk (B → A)', () => {
  it("decideMany with one of A's ids inside B's batch → NOT_FOUND, nothing changes on either side", async () => {
    const err = await callerAs(db, B, 'manager')
      .approvals.decideMany({
        items: [
          { discrepancyId: B.discrepancyId, expectedStatus: 'open' },
          { discrepancyId: A.discrepancyId, expectedStatus: 'open' },
        ],
        decision: 'accepted',
        clientMutationId: 'cmid-attack-1',
      })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'NOT_FOUND' });
    expect(await aStatuses()).toEqual(['open', 'open']);
    const [b] = await db.select().from(discrepancies).where(eq(discrepancies.id, B.discrepancyId));
    expect(b!.resolutionStatus).toBe('open');
  });

  it("reopenMany with A's id → NOT_FOUND and A's decided row stays decided", async () => {
    await callerAs(db, A, 'manager').approvals.approve({ discrepancyId: aExtra });
    await expect(callerAs(db, B, 'manager').approvals.reopenMany({ discrepancyIds: [aExtra] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await db.select().from(discrepancies).where(eq(discrepancies.id, aExtra)))[0]!.resolutionStatus).toBe('accepted');
  });

  it("myQueue / queueSummary with A's invoiceIds → empty for B, in both scopes", async () => {
    const b = callerAs(db, B, 'owner');
    expect(await b.approvals.myQueue({ invoiceIds: [A.invoiceId] })).toEqual([]);
    expect(await b.approvals.myQueue({ scope: 'all', invoiceIds: [A.invoiceId] })).toEqual([]);
    const sum = await b.approvals.queueSummary({ invoiceIds: [A.invoiceId] });
    expect(sum.count).toBe(0);
    expect(sum.others.count).toBe(0);
  });

  it("myQueue scope 'all' never lists A's rows to B", async () => {
    const rows = await callerAs(db, B, 'owner').approvals.myQueue({ scope: 'all' });
    expect(rows.map((r) => r.id)).toEqual([B.discrepancyId]);
  });

  it("history of A's discrepancy → empty for B", async () => {
    expect(await callerAs(db, B, 'owner').approvals.history({ discrepancyId: A.discrepancyId, limit: 3 })).toEqual([]);
  });
});
