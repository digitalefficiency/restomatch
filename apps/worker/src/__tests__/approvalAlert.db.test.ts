import { beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  restaurants,
  suppliers,
  testDbUrl,
  users,
} from '@restomatch/db';
import { appRouter, approvalNeededEmail, formatIlsAgorot, type AppContext } from '@restomatch/api';
import { approvalSummary, invoiceAlert } from '../jobs/matchInvoice';
import { openCreditsFigure, processEndOfDayReport } from '../jobs/endOfDayReport';

/**
 * Train C B1 / B2 (pilot-UX HIGH + money M1). The approval alert (push, WhatsApp,
 * e-mail) counts and prices ONE invoice exactly like its `?invoice=` queue: no
 * auto-approved info row, no ₪0 QTY_SHORT twin; ₪ per VAT basis; a review-only
 * or pending-link invoice names no ₪. The 19:00 digest skips a day with no ₪.
 */
const db = createDb(testDbUrl());
let n = 0;

async function tenant(tag: string) {
  const [r] = await db.insert(restaurants).values({ name: `alert-${tag}`, settings: { features: { all: true } } as never }).returning();
  const [u] = await db.insert(users).values({ email: `owner-${tag}-${Date.now()}@alert.test`, name: 'בעלים' }).returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: r!.id, role: 'owner' });
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק בדיקה' }).returning();
  return { restaurantId: r!.id, userId: u!.id, supplierId: s!.id };
}
type T = Awaited<ReturnType<typeof tenant>>;

async function invoiceWith(
  t: T,
  gaps: Array<{ type: (typeof discrepancies.$inferInsert)['type']; severity: 'info' | 'warn' | 'block'; delta: string; status?: 'open' | 'accepted' }>,
) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceNumber: `AL-${++n}`,
      invoiceDate: new Date(),
      totalExclVat: '1000.00',
      vatAmount: '180.00',
      totalInclVat: '1180.00',
      status: 'matched',
      source: 'photo',
      createdBy: t.userId,
    })
    .returning();
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: t.restaurantId, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
    .returning();
  for (const g of gaps) {
    await db.insert(discrepancies).values({
      restaurantId: t.restaurantId,
      matchRunId: mr!.id,
      type: g.type,
      severity: g.severity,
      deltaAmount: g.delta,
      requiresRole: 'manager',
      resolutionStatus: g.status ?? 'open',
    });
  }
  return inv!.id;
}

const queueCount = async (t: T, invoiceId: string) => {
  const caller = appRouter.createCaller({ db, session: { userId: t.userId, restaurantId: t.restaurantId, role: 'owner' } } as unknown as AppContext);
  const rows = await caller.approvals.myQueue({ scope: 'all', invoiceIds: [invoiceId], limit: 100 });
  return rows.length;
};

const render = async (t: T, invoiceId: string) => {
  const a = await invoiceAlert(db, t.restaurantId, invoiceId);
  const email = approvalNeededEmail({
    supplierName: 'ספק בדיקה',
    discrepancyCount: a.count,
    atRiskIls: null,
    claimableIls: a.figure,
    pendingLink: a.pendingLink,
    invoiceUrl: 'https://app.test/x',
  });
  return { a, email, push: approvalSummary(a.count, a.figure, 'https://app.test/x', { pendingLink: a.pendingLink }) };
};

const ils = (agorot: number) => formatIlsAgorot(agorot, { maximumFractionDigits: 2 });

describe('approval alert = the ?invoice= queue (Train C B1)', () => {
  let t: T;
  beforeAll(async () => {
    t = await tenant(`b1-${Date.now()}`);
  });

  it('₪: counts the open decidable rows only (no info row, no ₪0 twin, no decided row) and names the claim', async () => {
    const id = await invoiceWith(t, [
      { type: 'PRICE_HIGHER', severity: 'warn', delta: '40.00' },
      { type: 'QTY_SHORT', severity: 'info', delta: '0' }, // the ₪0 twin
      { type: 'PRICE_HIGHER', severity: 'warn', delta: '10.00', status: 'accepted' }, // auto-approved
    ]);
    const { a, email, push } = await render(t, id);
    expect(a.count).toBe(await queueCount(t, id));
    expect(a.count).toBe(1);
    expect(a.figure).toBe(ils(4000));
    expect(email.text).toContain('אפשר לבקש זיכוי');
    expect(email.text).toContain(ils(4000));
    expect(email.text).not.toMatch(/ללא סכום|סכום בפערים/);
    expect(push).toContain(`${ils(4000)} לבקשת זיכוי`);
  });

  it('review-only: no ₪ anywhere, the review wording renders', async () => {
    const id = await invoiceWith(t, [{ type: 'QTY_SHORT', severity: 'info', delta: '3.00' }]);
    const { a, email, push } = await render(t, id);
    expect(a.count).toBe(await queueCount(t, id));
    expect(a.figure).toBeNull();
    expect(email.subject).toContain('לבדיקה');
    expect(email.text).not.toMatch(/₪|ללא סכום|בסך/);
    expect(push).toContain('לבדיקה');
    expect(push).not.toMatch(/₪/);
  });

  it('pending link: its own wording, no ₪ and never "no amount to claim"', async () => {
    const id = await invoiceWith(t, [
      { type: 'UNORDERED_ARRIVAL', severity: 'warn', delta: '1180.00' },
      { type: 'PRICE_HIGHER', severity: 'warn', delta: '25.00' },
    ]);
    const { a, email, push } = await render(t, id);
    expect(a.count).toBe(await queueCount(t, id));
    expect(a.figure).toBeNull();
    expect(a.pendingLink).toBe(true);
    expect(email.subject).toContain('ממתינה לקישור להזמנה');
    expect(email.text).not.toMatch(/ללא סכום|בסך|₪/);
    expect(push).toContain('ממתינה לקישור להזמנה');
  });

  it('VAT_MISMATCH only: the VAT ₪ is its own labelled figure, never "no amount"', async () => {
    const id = await invoiceWith(t, [{ type: 'VAT_MISMATCH', severity: 'warn', delta: '50.00' }]);
    const { a, email } = await render(t, id);
    expect(a.count).toBe(await queueCount(t, id));
    expect(a.figure).toBe(`${ils(5000)} מע״מ (הפרש מע״מ)`);
    expect(email.text).toContain('אפשר לבקש זיכוי');
    expect(email.text).not.toMatch(/ללא סכום/);
  });
});

describe('end-of-day digest (Train C B2)', () => {
  const eod = (restaurantId: string) =>
    processEndOfDayReport({ id: `eod-${restaurantId}`, name: 'end-of-day-report', data: { restaurantId }, attemptsMade: 0, opts: { attempts: 1 } });
  const digests = (restaurantId: string) =>
    db
      .select()
      .from(notificationsOutbox)
      .where(and(eq(notificationsOutbox.restaurantId, restaurantId), eq(notificationsOutbox.relatedEntityType, 'restaurant')));

  it('a review-only tenant gets NO digest (no ₪ open, nothing caught)', async () => {
    process.env.DATABASE_URL = testDbUrl();
    const t = await tenant(`b2r-${Date.now()}`);
    await invoiceWith(t, [{ type: 'QTY_SHORT', severity: 'info', delta: '3.00' }]);
    await eod(t.restaurantId);
    expect(await digests(t.restaurantId)).toHaveLength(0);
  });

  it('a VAT_MISMATCH-only tenant: the digest names the VAT ₪ (never ₪0)', async () => {
    process.env.DATABASE_URL = testDbUrl();
    const t = await tenant(`b2v-${Date.now()}`);
    await invoiceWith(t, [{ type: 'VAT_MISMATCH', severity: 'warn', delta: '50.00' }]);
    await eod(t.restaurantId);
    const rows = await digests(t.restaurantId);
    expect(rows.length).toBeGreaterThan(0);
    const vat = formatIlsAgorot(5000, { maximumFractionDigits: 0 });
    expect(rows[0]!.body).toContain(vat);
    expect(rows[0]!.subject).not.toContain(formatIlsAgorot(0, { maximumFractionDigits: 0 }));
  });

  it('openCreditsFigure: each VAT basis on its own, ₪0 only when all are zero', () => {
    const f = (a: number) => formatIlsAgorot(a, { maximumFractionDigits: 0 });
    expect(openCreditsFigure({ excl: 100, incl: 0, vat: 0 })).toBe(f(10_000));
    expect(openCreditsFigure({ excl: 0, incl: 1170, vat: 50 })).toBe(`${f(117_000)} כולל מע״מ (חשבוניות כפולות) + ${f(5000)} מע״מ (הפרשי מע״מ)`);
    expect(openCreditsFigure(null)).toBe(f(0));
  });
});
