import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityEvents, createDb, testDbUrl, type UserRole } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * PILOT (train B): activity.feed carries no ₪ for the receiver or the chef —
 * structured v2 rows (match/persist.ts, approvals) AND legacy v1 rows whose ₪
 * sits in free text ("הפסד פוטנציאלי ₪12"). Owner / manager / bookkeeper unchanged.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const MONEY_KEY = /(Ils|Agorot)$|amount|savings|total|price/i;
const SHEKEL = /₪|ש["״'׳]ח/;

function caller(t: Tenant, role: UserRole) {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

const at = (n: number) => new Date(Date.parse('2026-10-20T08:00:00Z') + n * 1000);

async function seed(t: Tenant) {
  await db.insert(activityEvents).values([
    // v2 structured rows, as written today.
    {
      restaurantId: t.restaurantId,
      eventType: 'invoice_matched',
      title: `חשבונית ${t.invoiceNumber} הותאמה`,
      detail: `${t.supplierName} · 2 פערים · ‏₪296.00`,
      metadata: { invoiceId: t.invoiceId, discrepancyCount: 2, potentialLossIls: 296, leakIls: 296, leakCount: 2 },
      createdAt: at(0),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'discrepancy_approved',
      title: 'פער אושר',
      detail: '‏₪120.50',
      metadata: { discrepancyId: t.discrepancyId, savingsIls: 120.5 },
      createdAt: at(1),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'discrepancy_rejected',
      title: 'פער נדחה',
      detail: 'הספק זיכה ₪45 בטלפון',
      metadata: { amountIls: 45, reason: 'הספק זיכה ₪45 בטלפון', nested: { totalAgorot: 4500, note: 'בסדר' } },
      createdAt: at(2),
    },
    // Legacy v1 rows: ₪ only in free text, in the title, in ש"ח spelling, in a non-money kind.
    {
      restaurantId: t.restaurantId,
      eventType: 'invoice_matched',
      title: 'חשבונית 1001 הותאמה · הפסד פוטנציאלי ₪12',
      detail: 'הפסד פוטנציאלי ₪12',
      metadata: {},
      createdAt: at(3),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'invoice_received',
      title: 'חשבונית התקבלה: 1,234.50 ש"ח',
      detail: 'סה"כ כולל מע"מ 1,234.50 ש״ח',
      metadata: { notes: ['₪1,234.50', 'נסרקה'] },
      createdAt: at(4),
    },
    {
      restaurantId: t.restaurantId,
      eventType: 'sync_completed',
      title: 'סנכרון הסתיים',
      detail: '12 שורות',
      metadata: { rows: 12 },
      createdAt: at(5),
    },
  ]);
}

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'pilot-act-a');
  B = await seedTenant(db, 'pilot-act-b');
  await db.delete(activityEvents); // seedTenant writes its own marker event
  await seed(A);
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

describe('PILOT activity.feed — no ₪ for receiver / chef', () => {
  for (const role of ['receiver', 'chef'] as const) {
    it(`${role}: no ₪ (any spelling) and no amount key anywhere in the JSON; detail null; same shape`, async () => {
      const rows = await caller(A, role).activity.feed();
      expect(rows).toHaveLength(6);
      const json = JSON.stringify(rows);
      expect(json).not.toMatch(SHEKEL);
      const walk = (v: unknown): void => {
        if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) {
            if (k !== 'detail') expect(k).not.toMatch(MONEY_KEY);
            walk(x);
          }
        }
      };
      for (const r of rows) {
        expect(Object.keys(r).sort()).toEqual(['createdAt', 'detail', 'eventType', 'id', 'metadata', 'title']);
        expect(r.detail).toBeNull();
        walk(r.metadata);
      }
      // Money-free context survives.
      const titles = rows.map((r) => r.title);
      expect(titles).toContain('חשבונית 1001 הותאמה · הפסד פוטנציאלי');
      expect(titles).toContain('חשבונית התקבלה');
      expect(titles).toContain('סנכרון הסתיים');
      expect(rows.find((r) => r.title === 'סנכרון הסתיים')?.metadata).toEqual({ rows: 12 });
      expect(rows.find((r) => r.title === 'חשבונית התקבלה')?.metadata).toEqual({ notes: ['נסרקה'] });
      expect(rows.find((r) => r.title === 'פער נדחה')?.metadata).toEqual({ nested: { note: 'בסדר' } });
    });
  }

  it('owner / manager / bookkeeper: unchanged (₪ in title, detail and metadata as stored)', async () => {
    const owner = await caller(A, 'owner').activity.feed();
    expect(owner).toHaveLength(6);
    expect(owner.find((r) => r.eventType === 'discrepancy_approved')).toMatchObject({
      detail: '‏₪120.50',
      metadata: { savingsIls: 120.5 },
    });
    expect(owner.map((r) => r.title)).toContain('חשבונית 1001 הותאמה · הפסד פוטנציאלי ₪12');
    expect(owner.find((r) => r.eventType === 'invoice_received')?.detail).toBe('סה"כ כולל מע"מ 1,234.50 ש״ח');
    expect(await caller(A, 'manager').activity.feed()).toEqual(owner);
    expect(await caller(A, 'bookkeeper').activity.feed()).toEqual(owner);
  });

  it('A ≠ B for every role', async () => {
    for (const role of ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const) {
      expect((await caller(A, role).activity.feed()).some((r) => r.title === 'B only')).toBe(false);
      expect((await caller(B, role).activity.feed()).map((r) => r.title)).toEqual(['B only']);
    }
    expect(JSON.stringify(await caller(B, 'chef').activity.feed())).not.toMatch(/99|₪/);
  });
});
