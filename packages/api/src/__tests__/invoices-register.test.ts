import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeLeakHero } from '@restomatch/charts';
import {
  applyAuditImmutableRls,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  invoices,
  matchRuns,
  sql,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import { invoiceStatesForMonth } from '../invoices';
import { REGISTER_TABS, TAB_STATES, tabOfState } from '../routers/invoices';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * W2-02 register: tabs read G-05's canonical state (no derivation of our own),
 * partition every invoice into exactly one tab, and line up with the hero and
 * the pay-run buckets. "matched" = a match run exists — an OCR-written
 * `status='matched'` without a run is never in the matched tab.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
const callerOf = (t: Tenant, role: 'owner' | 'manager' | 'bookkeeper' | 'receiver' | 'chef' = 'owner') =>
  appRouter.createCaller({ db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } });

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});
beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'RA'); // matched invoice, one open ₪100 PRICE_HIGHER
  B = await seedTenant(ownerDb, 'RB');
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('tab partition', () => {
  it('every one of the 9 states sits in exactly one state tab', () => {
    const all = Object.values(TAB_STATES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(
      ['approved', 'awaiting_count', 'awaiting_link', 'claim_open', 'clean', 'flagged_open', 'held_duplicate', 'in_ocr', 'paid'].sort(),
    );
    expect(tabOfState('flagged_open')).toBe('review');
    expect(tabOfState('awaiting_link')).toBe('awaiting');
  });
});

describe('invoices.list / counts', () => {
  it("lists only the caller's invoices; the open-gap invoice is in לבדיקה with its ₪ gap", async () => {
    const r = await callerOf(A).invoices.list({});
    expect(r.rows.map((x) => x.id)).toEqual([A.invoiceId]);
    expect(r.rows.some((x) => x.id === B.invoiceId)).toBe(false);
    expect(r.rows[0]!.state).toBe('flagged_open');
    expect(r.rows[0]!.tab).toBe('review');
    expect(r.rows[0]!.gapAgorot).toBe(10000);
    expect(r.counts.review).toBe(1);
    expect(r.counts.matched).toBe(0);
  });

  it('the five state tabs sum to the month total (a partition) and ממתינות לשיוך = the hero pendingLinkCount', async () => {
    // Make one invoice of A unmatched (awaiting link) next to the flagged one.
    await ownerDb.update(matchRuns).set({ invoiceId: null }).where(eq(matchRuns.id, A.matchRunId));
    const r = await callerOf(A).invoices.list({});
    const c = r.counts;
    expect(c.review + c.awaiting + c.matched + c.held + c.paid).toBe(r.rows.length);
    const hero = await computeLeakHero(ownerDb, A.restaurantId, { now: new Date() });
    expect(c.awaiting).toBe(hero.pendingLinkCount);
  });

  it('visible total = Σ visible rows', async () => {
    const r = await callerOf(A).invoices.list({ tab: 'review' });
    expect(r.totals.totalInclVatAgorot).toBe(r.rows.reduce((s, x) => s + x.totalInclVatAgorot, 0));
    expect(r.totals.gapAgorot).toBe(r.rows.reduce((s, x) => s + x.gapAgorot, 0));
  });

  it("an OCR-written status 'matched' with no match run is NOT in הותאמו", async () => {
    await ownerDb.update(matchRuns).set({ invoiceId: null }).where(eq(matchRuns.id, A.matchRunId));
    await ownerDb.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, A.invoiceId));
    const r = await callerOf(A).invoices.list({});
    expect(r.rows[0]!.tab).toBe('awaiting');
    expect(r.counts.matched).toBe(0);
    expect(r.counts.awaiting).toBe(1);
  });

  it('counts equals list.counts; the bookkeeper may read, receiver and chef may not', async () => {
    const c = await callerOf(A, 'bookkeeper').invoices.counts({});
    expect(c).toEqual((await callerOf(A).invoices.list({})).counts);
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerOf(A, role).invoices.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerOf(A, role).invoices.counts({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('no allocation number → counted in ללא מספר הקצאה', async () => {
    await ownerDb.update(invoices).set({ allocationNumber: null }).where(eq(invoices.id, A.invoiceId));
    expect((await callerOf(A).invoices.counts({})).noAllocation).toBe(1);
    await ownerDb.update(invoices).set({ allocationNumber: '123456789' }).where(eq(invoices.id, A.invoiceId));
    expect((await callerOf(A).invoices.counts({})).noAllocation).toBe(0);
  });
});

const LAB = process.env.LAB_DATABASE_URL;
const NOW = new Date('2026-10-25T12:00:00+03:00');

describe.skipIf(!LAB)('lab parity (G-05 state = hero = pay-run buckets)', () => {
  it('tab counts on the lab month equal the hero and the pay-run buckets', async () => {
    const db = createDb(LAB!);
    const [o] = (await db.execute(sql`
      SELECT r.id FROM restaurants r WHERE r.name = 'כפר הזיתים' ORDER BY r.created_at LIMIT 1`)) as unknown as Array<{ id: string }>;
    const rid = o!.id;
    const hero = await computeLeakHero(db, rid, { now: NOW });
    expect(hero.leakIls).toBe(759.54); // unchanged: W2-02 moves no ₪
    const rows = await invoiceStatesForMonth(db, rid, { now: NOW });
    const tabs = Object.fromEntries(REGISTER_TABS.map((t) => [t, 0])) as Record<string, number>;
    for (const r of rows) tabs[tabOfState(r.state)]! += 1;
    expect(tabs.awaiting).toBe(hero.pendingLinkCount);
    expect(rows.length).toBe(hero.invoiceCount);
    expect({ review: tabs.review, awaiting: tabs.awaiting, matched: tabs.matched, held: tabs.held, paid: tabs.paid }).toEqual({
      review: 4,
      awaiting: 2,
      matched: 8,
      held: 0,
      paid: 23,
    });
  });
});
