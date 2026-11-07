import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditLog,
  createDb,
  discrepancies,
  eq,
  invoices,
  notificationsOutbox,
  recoveryClaims,
  restaurants,
  sql,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import { __setAskClient } from '../ask';
import { __resetAskBurst } from '../ask/budget';
import { OVERDUE_BOUNDARY_NOW } from '../lib/claims';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-06 golden set: Hebrew owner questions answered OFFLINE (no key, fixed
 * Israel clock) → the intent, the tool, and each expected figure. Plus the KPI
 * hook (one `ask.answered` row per question, no text, no ₪) and "no writes".
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const NOW = new Date(OVERDUE_BOUNDARY_NOW);

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, t.restaurantId));
  }
  // A owes: one overdue credit request (letter 10.10). B: a much bigger one.
  for (const [t, agorot] of [[A, 12_000], [B, 9_000_000]] as const) {
    const [d] = await db
      .insert(discrepancies)
      .values({ matchRunId: t.matchRunId, restaurantId: t.restaurantId, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '10.00', resolutionStatus: 'accepted' })
      .returning({ id: discrepancies.id });
    await db.insert(recoveryClaims).values({
      restaurantId: t.restaurantId,
      discrepancyId: d!.id,
      supplierId: t.supplierId,
      invoiceId: t.invoiceId,
      amountAgorot: agorot,
      status: 'letter_sent',
      claimedAt: new Date('2026-10-10T09:00:00Z'),
      letterSentAt: new Date('2026-10-10T09:00:00Z'),
    });
    await db
      .update(invoices)
      .set({ invoiceDate: new Date('2026-10-20T08:00:00Z'), totalExclVat: '12000.00', vatAmount: '2160.00', allocationNumber: null, status: 'matched' })
      .where(eq(invoices.id, t.invoiceId));
  }
});
beforeEach(() => {
  __resetAskBurst();
  __setAskClient(null);
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  __setAskClient(undefined);
});
afterAll(async () => {
  await resetDb(db);
});

type Row = [question: string, intent: string | null, expect: Record<string, unknown> | null];
const OWED = { available: true, outstandingIls: 120, overdueIls: 120, overdueSupplierCount: 1 };
const VAT = { available: true, label: 'vatAtRisk', count: 1, totalVatAtRiskIls: 2160 };
const NOT_LIVE = { available: false, reason: 'not_live' };
const NO_DUE = { available: false, reason: 'due_dates_not_live' };

const GOLDEN: Row[] = [
  // waiting
  ['מה מחכה לי?', 'waitingForMe', NOT_LIVE],
  ['מה מחכה להחלטה שלי?', 'waitingForMe', NOT_LIVE],
  ['כמה פערים פתוחים יש לאשר?', 'waitingForMe', NOT_LIVE],
  ['מה הכי דחוף לאשר?', 'waitingForMe', NOT_LIVE],
  // stuck
  ['מה תקוע בקליטה?', 'intakeStuck', NOT_LIVE],
  ['יש חשבוניות שלא נקלטו?', 'intakeStuck', NOT_LIVE],
  ['למה החשבונית לא פוענחה?', 'intakeStuck', NOT_LIVE],
  ['מה בתיבת הקליטה?', 'intakeStuck', NOT_LIVE],
  // owed
  ['מי חייב לי כסף?', 'whoOwesMe', OWED],
  ['מי חייב לי זיכויים?', 'whoOwesMe', OWED],
  ['איזה ספק לא ענה על בקשת זיכוי?', 'whoOwesMe', OWED],
  ['כמה זיכויים באיחור?', 'whoOwesMe', OWED],
  // to pay
  ['מה לשלם השבוע?', 'toPayThisWeek', NO_DUE],
  ['מה בפיגור תשלום?', 'toPayThisWeek', NO_DUE],
  ['כמה מחכה לתשלום השבוע?', 'toPayThisWeek', NO_DUE],
  // VAT
  ['כמה מע״מ בסיכון?', 'vatAtRisk', VAT],
  ['איזה חשבוניות בלי מספר הקצאה?', 'vatAtRisk', VAT],
  ['מתי נגמר הזמן לקזז מע״מ?', 'vatAtRisk', VAT],
  ['כמה מע"מ בסיכון?', 'vatAtRisk', VAT],
  // regression: the five existing chips
  ['למה הדליפה עלתה החודש?', 'leakChange', null],
  ['איזה ספק העלה מחירים?', 'priceRaise', null],
  ['מה כדאי לתבוע השבוע?', 'claimWeek', null],
  ['כמה כסף דלף החודש?', 'leakTotal', null],
  ['איזה ספק הכי דולף?', 'topSupplier', null],
  // negatives
  ['כמה הזמנות היו?', null, null],
  ['מה מזג האוויר?', null, null],
];

describe('golden set (he, offline, no key)', () => {
  it.each(GOLDEN)('"%s" → %s', async (question, intent, facts) => {
    const r = await caller(A).ask.ask({ question, locale: 'he' });
    expect(r.mode).toBe('offline');
    expect(r.intent).toBe(intent);
    if (facts) expect(r.facts).toMatchObject(facts);
    // Tenant B's bigger numbers never surface.
    expect(JSON.stringify(r)).not.toContain('90000');
    expect(JSON.stringify(r)).not.toContain(B.supplierId);
  });

  it('the manager gets the same answers', async () => {
    const r = await caller(A, 'manager').ask.ask({ question: 'מי חייב לי זיכויים?', locale: 'he' });
    expect(r.facts).toMatchObject(OWED);
  });
});

describe('KPI hook + no writes', () => {
  async function counts() {
    const [r] = (await db.execute(sql`
      select
        (select count(*) from discrepancies)::int as d,
        (select count(*) from recovery_claims)::int as c,
        (select count(*) from invoices)::int as i,
        (select count(*) from notifications_outbox)::int as o,
        (select count(*) from audit_log where action <> 'ask.answered')::int as a,
        (select count(*) from audit_log where action = 'ask.answered')::int as k
    `)) as unknown as Array<Record<string, number>>;
    return r!;
  }

  it('20 questions change no business row; each writes exactly one ask.answered row (A11, no text, no ₪)', async () => {
    const before = await counts();
    const qs = GOLDEN.slice(0, 20).map((g) => g[0]);
    for (const question of qs) {
      __resetAskBurst();
      await caller(A).ask.ask({ question, locale: 'he' });
    }
    const after = await counts();
    expect({ ...after, k: 0 }).toEqual({ ...before, k: 0 });
    expect(after.k! - before.k!).toBe(20);

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'ask.answered'));
    const last = rows.find((r) => (r.after as { intent?: string }).intent === 'whoOwesMe')!;
    expect(last.restaurantId).toBe(A.restaurantId);
    expect(last.after).toEqual({ automationId: 'A11', intent: 'whoOwesMe', tools: ['who_owes_me'], mode: 'offline', grounded: true });
    const blob = JSON.stringify(rows.map((r) => r.after));
    for (const q of qs) expect(blob).not.toContain(q);
    expect(blob).not.toMatch(/Ils|₪/);
    // unused-import guard for the tables named in the brief
    expect([notificationsOutbox, invoices].length).toBe(2);
  });
});
