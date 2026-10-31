import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityEvents, createDb, eq, testDbUrl, users, type UserRole } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-07 (ia-nav-01, interim before H-11): activity.feed carries no ₪ for roles
 * without `money.view` (receiver, chef); owner / manager / bookkeeper unchanged.
 * The three money-bearing events mirror what the writers persist today:
 * match/persist.ts (invoice_matched), approvals approve / reject.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const MONEY_KEY = /(Ils|Agorot)$|amount|savings|total|price/i;

function caller(t: Tenant, role: UserRole) {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function seedMoneyEvents(t: Tenant, at: number) {
  await db.insert(activityEvents).values([
    {
      restaurantId: t.restaurantId,
      eventType: 'invoice_matched',
      title: `חשבונית ${t.invoiceNumber} הותאמה`,
      detail: `${t.supplierName} · 2 פערים · ‏₪296.00`,
      entityType: 'match_run',
      entityId: t.matchRunId,
      metadata: {
        invoiceId: t.invoiceId,
        invoiceNumber: t.invoiceNumber,
        supplierName: t.supplierName,
        discrepancyCount: 2,
        potentialLossIls: 296,
        leakCount: 2,
        leakIls: 296,
        status: 'discrepancies',
      },
      createdAt: new Date(at),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'discrepancy_approved',
      title: 'פער אושר',
      detail: '‏₪120.50',
      actorId: t.ownerUserId,
      entityType: 'discrepancy',
      entityId: t.discrepancyId,
      metadata: { discrepancyId: t.discrepancyId, savingsIls: 120.5, type: 'PRICE_INCREASE' },
      createdAt: new Date(at + 1000),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'discrepancy_rejected',
      title: 'פער נדחה',
      detail: 'הספק זיכה ₪45 בטלפון',
      entityType: 'discrepancy',
      entityId: t.discrepancyId,
      metadata: {
        discrepancyId: t.discrepancyId,
        amountIls: 45,
        reason: 'הספק זיכה ₪45 בטלפון',
        reasonCode: 'other',
        nested: { totalAgorot: 4500, note: 'בסדר', priceNote: 'x' },
      },
      createdAt: new Date(at + 2000),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'invoice_received',
      title: 'חשבונית התקבלה',
      detail: t.supplierName,
      metadata: { invoiceId: t.invoiceId },
      createdAt: new Date(at + 3000),
    },
  ]);
}

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'act-a');
  B = await seedTenant(db, 'act-b');
  // seedTenant writes its own marker event; this suite owns the feed contents.
  await db.delete(activityEvents);
  await db.update(users).set({ name: 'דנה כהן' }).where(eq(users.id, A.ownerUserId));
  await seedMoneyEvents(A, Date.parse('2026-10-20T08:00:00Z'));
  await db.insert(activityEvents).values({
    restaurantId: B.restaurantId,
    eventType: 'invoice_matched',
    title: 'B only',
    detail: '‏₪99,999.00',
    metadata: { leakIls: 99999 },
  });
});

afterAll(async () => {
  await resetDb(db);
});

describe('activity.feed — money scope by role (G-07)', () => {
  it('owner / manager / bookkeeper get the full rows, deep-equal to each other and to the stored rows', async () => {
    const owner = await caller(A, 'owner').activity.feed();
    expect(owner).toHaveLength(4);
    expect(owner.map((r) => r.eventType)).toEqual([
      'invoice_received',
      'discrepancy_rejected',
      'discrepancy_approved',
      'invoice_matched',
    ]);
    expect(owner.find((r) => r.eventType === 'invoice_matched')).toMatchObject({
      detail: `${A.supplierName} · 2 פערים · ‏₪296.00`,
      metadata: { potentialLossIls: 296, leakIls: 296 },
    });
    expect(owner.find((r) => r.eventType === 'discrepancy_approved')?.metadata).toEqual({
      discrepancyId: A.discrepancyId,
      savingsIls: 120.5,
      type: 'PRICE_INCREASE',
    });
    expect(await caller(A, 'manager').activity.feed()).toEqual(owner);
    expect(await caller(A, 'bookkeeper').activity.feed()).toEqual(owner);
  });

  for (const role of ['receiver', 'chef'] as const) {
    it(`${role}: no ₪ anywhere, no ₪ keys, detail null on money-bearing kinds`, async () => {
      const rows = await caller(A, role).activity.feed();
      expect(rows).toHaveLength(4);
      expect(JSON.stringify(rows)).not.toContain('₪');
      const walk = (v: unknown): void => {
        if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) {
            expect(k).not.toMatch(MONEY_KEY);
            walk(x);
          }
        }
      };
      for (const r of rows) walk(r.metadata);
      for (const kind of ['invoice_matched', 'discrepancy_approved', 'discrepancy_rejected']) {
        expect(rows.find((r) => r.eventType === kind)?.detail).toBeNull();
      }
      // Non-money context survives: counts, ids, supplier, a ₪-free detail.
      expect(rows.find((r) => r.eventType === 'invoice_matched')?.metadata).toEqual({
        invoiceId: A.invoiceId,
        invoiceNumber: A.invoiceNumber,
        supplierName: A.supplierName,
        discrepancyCount: 2,
        leakCount: 2,
        status: 'discrepancies',
      });
      expect(rows.find((r) => r.eventType === 'discrepancy_rejected')?.metadata).toEqual({
        discrepancyId: A.discrepancyId,
        reasonCode: 'other',
        nested: { note: 'בסדר' },
      });
      expect(rows.find((r) => r.eventType === 'invoice_received')?.detail).toBe(A.supplierName);
      expect(rows.map((r) => r.title)).toEqual([
        'חשבונית התקבלה',
        'פער נדחה',
        'פער אושר',
        `חשבונית ${A.invoiceNumber} הותאמה`,
      ]);
    });
  }

  it('actorId + actorName on every row, for every role (null for a system event)', async () => {
    for (const role of ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const) {
      const rows = await caller(A, role).activity.feed();
      const approved = rows.find((r) => r.eventType === 'discrepancy_approved');
      expect(approved, role).toMatchObject({ actorId: A.ownerUserId, actorName: 'דנה כהן' });
      for (const r of rows.filter((x) => x.eventType !== 'discrepancy_approved')) {
        expect(r, `${role}:${r.eventType}`).toMatchObject({ actorId: null, actorName: null });
      }
      // The name only — never the actor's e-mail.
      expect(JSON.stringify(rows)).not.toContain('@');
    }
  });

  it('A ≠ B: each tenant reads only its own events, for every role', async () => {
    for (const role of ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const) {
      const a = await caller(A, role).activity.feed();
      expect(a.some((r) => r.title === 'B only')).toBe(false);
      const b = await caller(B, role).activity.feed();
      expect(b.map((r) => r.title)).toEqual(['B only']);
    }
    // B's chef sees its own row without the ₪ (a bare "99" can occur in a uuid or timestamp).
    const bChef = await caller(B, 'chef').activity.feed();
    expect(JSON.stringify(bChef)).not.toContain('₪');
    expect(bChef[0]).toMatchObject({ title: 'B only', detail: null, metadata: {} });
  });
});
