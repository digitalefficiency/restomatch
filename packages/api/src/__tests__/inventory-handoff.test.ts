import { beforeAll, describe, expect, it } from 'vitest';
import { and, auditLog, eq, notificationsOutbox, sql } from '@restomatch/db';
import { callerAs, count, db, freshLab, price, product, type Lab } from './inventory-w207-helpers';

/** W2-07 · foodcost-07: the chef hands the count off ("שלחו לסגירה") — one audit row, one e-mail per manager/owner. */
let A: Lab;
let B: Lab;
let draft: string;

beforeAll(async () => {
  [A, B] = (await freshLab(['HA', 'HB'])) as [Lab, Lab];
  const beef = await product(A!.t, 'אנטריקוט', 'ק״ג', 'בשר');
  await price(A!.t, beef, 40, '100.0000');
  draft = await count(A!, 1, { [beef]: '3' }, false, 'chef');
});

describe('inventory.submitForClose', () => {
  it('1 audit row, ≥1 outbox row per owner/manager at a concrete address, 0 role: targets, no ₪', async () => {
    const r = await callerAs(A, 'chef').inventory.submitForClose({ countId: draft });
    expect(r).toMatchObject({ replay: false, notified: 2 });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, draft), eq(auditLog.action, 'inventory.count_submitted')));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.userId).toBe(A.users.chef);
    const rows = await db.select().from(notificationsOutbox).where(and(eq(notificationsOutbox.restaurantId, A.t.restaurantId), eq(notificationsOutbox.relatedEntityId, draft)));
    expect(rows.map((x) => x.target).sort()).toEqual(['manager-HA@w207.test', 'owner-HA@attack.test']);
    expect(rows.every((x) => x.channel === 'email' && !x.target.startsWith('role:'))).toBe(true);
    for (const x of rows) expect(`${x.subject} ${x.body}`).not.toMatch(/₪/);
  });

  it('a replay adds no second audit row and no second notification', async () => {
    const r = await callerAs(A, 'chef').inventory.submitForClose({ countId: draft });
    expect(r).toMatchObject({ replay: true, notified: 0 });
    const res = (await db.execute(sql`select count(*)::int as n from audit_log where entity_id = ${draft} and action = 'inventory.count_submitted'`)) as unknown as Array<{ n: number }>;
    expect(res[0]!.n).toBe(1);
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, draft));
    expect(rows).toHaveLength(2);
  });

  it('current exposes submittedAt / submittedBy for the Needs-you card', async () => {
    const v = await callerAs(A, 'manager').inventory.current();
    expect(v).toMatchObject({ submittedBy: 'chef HA' });
    expect(typeof v!.submittedAt).toBe('string');
  });

  it("tenant B can't submit A's count (NOT_FOUND, nothing written for A)", async () => {
    await expect(callerAs(B, 'chef').inventory.submitForClose({ countId: draft })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, draft), eq(auditLog.action, 'inventory.count_submitted')));
    expect(audits).toHaveLength(1);
  });

  it("an unnamed member never shows as an e-mail: submittedBy is null (the UI says 'חבר/ת צוות'), no '@' in the chef's JSON", async () => {
    const { users, eq: eq2 } = await import('@restomatch/db');
    await db.update(users).set({ name: '' }).where(eq2(users.id, A.users.chef));
    const v = await callerAs(A, 'chef').inventory.current();
    expect(v!.submittedBy).toBeNull();
    expect(JSON.stringify(v)).not.toContain('@');
    const p = await callerAs(A, 'chef').inventory.foodCostPercent();
    expect(JSON.stringify(p)).not.toContain('@');
  });
});
