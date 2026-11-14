import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { startOfIlDay } from '../lib/notifyHelpers';

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

describe('R4-1: nothing open on the invoice → no alert at all', () => {
  it('only an auto-approved row and the ₪0 twin: invoiceAlert counts 0, as the queue does', async () => {
    const t = await tenant(`r41-${Date.now()}`);
    const id = await invoiceWith(t, [
      { type: 'PRICE_HIGHER', severity: 'warn', delta: '10.00', status: 'accepted' },
      { type: 'QTY_SHORT', severity: 'warn', delta: '0' },
    ]);
    const a = await invoiceAlert(db, t.restaurantId, id);
    expect(a.count).toBe(0);
    expect(await queueCount(t, id)).toBe(0);
    expect(a.figure).toBeNull();
  });

  it('the push / WhatsApp / e-mail block runs only when the alert counts > 0 (never "0 פערים")', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'jobs', 'matchInvoice.ts'), 'utf8');
    const gate = src.indexOf('if (alert && alert.count > 0) {');
    expect(gate).toBeGreaterThan(0);
    for (const send of ['push.send(', 'whatsapp.send(', 'approvalNeededEmail(']) {
      expect(src.indexOf(send), send).toBeGreaterThan(gate);
    }
  });
});

describe('end-of-day digest (Train C B2)', () => {
  // The 19:00 run of TODAY (Israel), whatever the wall clock: rows inserted now are "caught
  // today" even when the suite runs in the 00:00–06:00 catch-up window (which reports yesterday).
  const eod = (restaurantId: string) =>
    processEndOfDayReport({
      id: `eod-${restaurantId}`,
      name: 'end-of-day-report',
      data: { restaurantId, forDate: new Date(startOfIlDay(new Date()).getTime() + 19 * 3600_000).toISOString() },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
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

  it('openCreditsFigure: each VAT basis on its own, null (never ₪0) when all are zero', () => {
    const f = (a: number) => formatIlsAgorot(a, { maximumFractionDigits: 0 });
    expect(openCreditsFigure({ excl: 100, incl: 0, vat: 0 })).toBe(f(10_000));
    expect(openCreditsFigure({ excl: 0, incl: 1170, vat: 50 })).toBe(`${f(117_000)} כולל מע״מ (חשבוניות כפולות) + ${f(5000)} מע״מ (הפרשי מע״מ)`);
    expect(openCreditsFigure(null)).toBeNull();
    expect(openCreditsFigure({ excl: 0, incl: 0, vat: 0 })).toBeNull();
  });

  it('R4-2: claimables only on invoices waiting for an order link → no ₪0 anywhere, a pending-link count instead', async () => {
    process.env.DATABASE_URL = testDbUrl();
    const t = await tenant(`r42-${Date.now()}`);
    await invoiceWith(t, [
      { type: 'UNORDERED_ARRIVAL', severity: 'warn', delta: '1180.00' },
      { type: 'PRICE_HIGHER', severity: 'warn', delta: '25.00' },
    ]);
    await eod(t.restaurantId);
    const rows = await digests(t.restaurantId);
    expect(rows.length).toBeGreaterThan(0);
    const zero = formatIlsAgorot(0, { maximumFractionDigits: 0 });
    for (const r of rows) {
      for (const s of [r.subject ?? '', r.body, (r.payload as { __html?: string } | null)?.__html ?? '']) {
        expect(s).not.toContain(zero);
        expect(s).not.toMatch(/\(\s*‏?0\s*‏?₪\s*\)|\(₪0\)/);
      }
      expect(r.body).toContain('ממתינות לקישור להזמנה');
    }
  });
});

describe('R6 (M-2): the 19:00 digest never prints ₪0 and its count matches its ₪', () => {
  // Today's 19:00 run in Israel, whatever the wall clock (see the B2 helper above).
  const eod = (restaurantId: string) =>
    processEndOfDayReport({
      id: `eod-r6-${restaurantId}`,
      name: 'end-of-day-report',
      data: { restaurantId, forDate: new Date(startOfIlDay(new Date()).getTime() + 19 * 3600_000).toISOString() },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
  const digests = (restaurantId: string) =>
    db
      .select()
      .from(notificationsOutbox)
      .where(and(eq(notificationsOutbox.restaurantId, restaurantId), eq(notificationsOutbox.relatedEntityType, 'restaurant')));
  const htmlOf = (r: { payload: unknown }) => (r.payload as { __html?: string } | null)?.__html ?? '';
  /** Move an invoice's findings to yesterday (Israel): nothing on it is "caught today". */
  const yesterday = async (invoiceId: string) => {
    const [mr] = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
    await db
      .update(discrepancies)
      .set({ createdAt: new Date(startOfIlDay(new Date()).getTime() - 3600_000) })
      .where(eq(discrepancies.matchRunId, mr!.id));
  };
  const f0 = (agorot: number) => formatIlsAgorot(agorot, { maximumFractionDigits: 0 });
  const PENDING_LINK = [
    { type: 'UNORDERED_ARRIVAL' as const, severity: 'warn' as const, delta: '1180.00' },
    { type: 'PRICE_HIGHER' as const, severity: 'warn' as const, delta: '25.00' },
  ];
  const noZero = (s: string) => {
    expect(s).not.toContain(f0(0));
    expect(s).not.toMatch(/(?<![\d,.])0[\s\u200f]*₪|₪[\s\u200f]*0(?![\d,.])/);
  };
  const GOLD_RULE = 'width:44px;background:#b45309';

  beforeAll(() => {
    process.env.DATABASE_URL = testDbUrl();
  });

  it('pending-link only, found yesterday → NO digest (a quiet day, like review-only), the skip is counted', async () => {
    const t = await tenant(`r6q-${Date.now()}`);
    await yesterday(await invoiceWith(t, PENDING_LINK));
    const res = await eod(t.restaurantId);
    expect(await digests(t.restaurantId)).toHaveLength(0);
    expect(res).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('pending-link only, found today → a digest with no ₪0, no "nothing open" subject and no gold clean line', async () => {
    const t = await tenant(`r6p-${Date.now()}`);
    await invoiceWith(t, PENDING_LINK);
    await eod(t.restaurantId);
    const rows = await digests(t.restaurantId);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const html = htmlOf(r);
      for (const s of [r.subject ?? '', r.body, html]) {
        noZero(s);
        expect(s).not.toContain('אין זיכויים פתוחים');
      }
      expect(html).not.toContain(GOLD_RULE);
      expect(r.subject).toContain('ממתינות לקישור להזמנה');
      expect(r.body).toContain('ממתינות לקישור להזמנה: 1');
      expect(r.body).toContain('פערים שנמצאו היום'); // the ₪25 caught today is real
      expect(r.body).not.toContain('זיכויים פתוחים:'); // no ₪ → no open-credits row
    }
  });

  it('mixed priced + pending-link → the count beside the ₪ is 1 (the priced row), plus the pending-link line', async () => {
    const t = await tenant(`r6m-${Date.now()}`);
    await invoiceWith(t, [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '40.00' }]);
    await invoiceWith(t, PENDING_LINK);
    await eod(t.restaurantId);
    const rows = await digests(t.restaurantId);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const html = htmlOf(r);
      expect(r.subject).toContain('זיכוי פתוח אחד');
      expect(r.subject).toContain(f0(4000));
      expect(r.subject).not.toMatch(/שני זיכויים|# זיכויים/);
      expect(r.body).toContain(`זיכויים פתוחים: ${f0(4000)} (1)`);
      expect(r.body).toContain('ממתינות לקישור להזמנה: 1');
      expect(html).toContain('זיכוי פתוח אחד'); // the preview line
      expect(html).not.toContain('שני זיכויים');
      for (const s of [r.subject ?? '', r.body, html]) noZero(s);
    }
  });

  it('nothing caught today but open credits → a digest without the caught-today row (html + text), no ₪0', async () => {
    const t = await tenant(`r6o-${Date.now()}`);
    await yesterday(await invoiceWith(t, [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '40.00' }]));
    await eod(t.restaurantId);
    const rows = await digests(t.restaurantId);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const html = htmlOf(r);
      expect(r.subject).toContain(f0(4000));
      expect(r.body).toContain(`זיכויים פתוחים: ${f0(4000)} (1)`);
      for (const s of [r.body, html]) {
        expect(s).not.toContain('פערים שנמצאו היום');
        expect(s).not.toMatch(/(?<!\d)0 פערים/);
      }
      for (const s of [r.subject ?? '', r.body, html]) noZero(s);
    }
  });

  it('a gap under ₪1 shows its agorot (open credit and caught today), never "0 ₪"', async () => {
    const t = await tenant(`r6s-${Date.now()}`);
    await invoiceWith(t, [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '0.40' }]);
    await eod(t.restaurantId);
    const rows = await digests(t.restaurantId);
    expect(rows.length).toBeGreaterThan(0);
    const cents = formatIlsAgorot(40, { maximumFractionDigits: 2 });
    for (const r of rows) {
      expect(r.subject).toContain(cents);
      expect(r.body).toContain(`זיכויים פתוחים: ${cents} (1)`);
      expect(r.body).toContain(`פערים שנמצאו היום: ${cents} (1)`);
      for (const s of [r.subject ?? '', r.body, htmlOf(r)]) noZero(s);
    }
  });
});
