import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeLeakHero, HELD_FOR_RECEIPTS_KEY } from '@restomatch/charts';
import {
  applyAuditImmutableRls,
  applyCoreTenantRls,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  invoices,
  matchRuns,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import { countStates, INVOICE_STATES, invoiceStateOf, invoiceStatesForMonth, invoiceStatesOf, type InvoiceState } from '../invoices';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-05 invoices/state.ts: one canonical state per invoice, derived from facts
 * (match runs, findings, the hero's per-invoice CTE), never from
 * `invoices.status = 'matched'`. Read-only: no ₪ moves.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;

function asTenant<T>(t: Tenant, fn: (tx: Database) => Promise<T>): Promise<T> {
  return withRestaurant(appDb, t.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${t.ownerUserId}, true)`);
    return fn(tx);
  });
}
const stateOfA = async () => (await asTenant(A, (tx) => invoiceStateOf(tx, A.restaurantId, A.invoiceId)))?.state;
const setInvoice = (v: Partial<typeof invoices.$inferInsert>) => ownerDb.update(invoices).set(v).where(eq(invoices.id, A.invoiceId));
const setFinding = (v: Partial<typeof discrepancies.$inferInsert>) =>
  ownerDb.update(discrepancies).set(v).where(eq(discrepancies.id, A.discrepancyId));
const unlinkRun = () => ownerDb.update(matchRuns).set({ invoiceId: null }).where(eq(matchRuns.id, A.matchRunId));

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});
beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'SA'); // matched invoice, one open ₪100 PRICE_HIGHER (warn)
  B = await seedTenant(ownerDb, 'SB');
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('invoice state (fixtures, RLS app role)', () => {
  it('an open real finding → flagged_open; accepted → claim_open; rejected → clean', async () => {
    expect(await stateOfA()).toBe('flagged_open');
    await setFinding({ resolutionStatus: 'accepted' });
    expect(await stateOfA()).toBe('claim_open');
    await setFinding({ resolutionStatus: 'rejected' });
    expect(await stateOfA()).toBe('clean');
  });

  it('the stored status never decides: disputed with everything decided is clean; matched with no run waits for its link', async () => {
    await setFinding({ resolutionStatus: 'rejected' });
    await setInvoice({ status: 'disputed' });
    expect(await stateOfA()).toBe('clean');
    await unlinkRun();
    await setInvoice({ status: 'matched' });
    expect(await stateOfA()).toBe('awaiting_link');
  });

  it('an open UNORDERED_ARRIVAL waits for its PO link (T4), not flagged', async () => {
    await setFinding({ type: 'UNORDERED_ARRIVAL' });
    expect(await stateOfA()).toBe('awaiting_link');
  });

  it('approved and paid are payment decisions; an approved invoice with an open finding still shows it', async () => {
    await setInvoice({ status: 'approved' });
    expect(await stateOfA()).toBe('flagged_open');
    await setFinding({ resolutionStatus: 'rejected' });
    expect(await stateOfA()).toBe('approved');
    await setFinding({ resolutionStatus: 'open' });
    await setInvoice({ status: 'paid' });
    expect(await stateOfA()).toBe('paid'); // a paid invoice keeps its finding; the state is the payment
  });

  it('in OCR, and a scan held for its receipt count (#94) waits for the count', async () => {
    await unlinkRun();
    await setInvoice({ status: 'ocr_pending' });
    expect(await stateOfA()).toBe('in_ocr');
    await setInvoice({ status: 'parsed', ocrPayload: { raw: { [HELD_FOR_RECEIPTS_KEY]: [A.grId] } } as never });
    expect(await stateOfA()).toBe('awaiting_count');
  });

  it('a live duplicate finding holds the copy (held_duplicate) until it is waived', async () => {
    await setFinding({ type: 'DUPLICATE_INVOICE' });
    expect(await stateOfA()).toBe('held_duplicate');
    await setFinding({ resolutionStatus: 'accepted' });
    expect(await stateOfA()).toBe('held_duplicate');
    await setFinding({ resolutionStatus: 'rejected' }); // "not a duplicate"
    expect(await stateOfA()).toBe('clean');
  });

  it('is tenant-scoped: another restaurant\'s id is absent; the month list holds only own invoices', async () => {
    const m = await asTenant(A, (tx) => invoiceStatesOf(tx, A.restaurantId, [A.invoiceId, B.invoiceId]));
    expect([...m.keys()]).toEqual([A.invoiceId]);
    const month = await asTenant(A, (tx) => invoiceStatesForMonth(tx, A.restaurantId));
    expect(month.map((r) => r.invoiceId)).toEqual([A.invoiceId]);
    expect(countStates(month)).toMatchObject({ flagged_open: 1 });
    expect(Object.keys(countStates([])).sort()).toEqual([...INVOICE_STATES].sort());
  });

  it('reads only: the hero is identical before and after', async () => {
    const before = await computeLeakHero(ownerDb, A.restaurantId);
    await asTenant(A, (tx) => invoiceStatesForMonth(tx, A.restaurantId));
    expect(await computeLeakHero(ownerDb, A.restaurantId)).toEqual(before);
  });
});

// ── lab-month parity (DEMO_TODAY=2026-10-25) ──────────────────────────────

const LAB = process.env.LAB_DATABASE_URL;
const NOW = new Date('2026-10-25T12:00:00+03:00');

/** The pay-run bucket each state maps to (unpaid, not in OCR). */
const PAY_RUN_BUCKET: Partial<Record<InvoiceState, string>> = {
  clean: 'pay',
  approved: 'pay',
  claim_open: 'claim',
  awaiting_count: 'hold',
  held_duplicate: 'hold',
  flagged_open: 'hold',
  awaiting_link: 'link',
};

describe.skipIf(!LAB)('lab demo parity (W2-09a CTE + match_runs + findings; no ₪ change)', () => {
  it('the lab month: counts equal the hero, Σ leak = the hero, and every unpaid invoice sits in its pay-run bucket', async () => {
    const db = createDb(LAB!);
    const owners = (await db.execute(sql`
      SELECT r.id, m.user_id FROM restaurants r
      JOIN memberships m ON m.restaurant_id = r.id AND m.role = 'owner'
      WHERE r.name = 'כפר הזיתים' ORDER BY r.created_at LIMIT 1`)) as unknown as Array<{ id: string; user_id: string }>;
    const rid = owners[0]!.id;
    const hero = await computeLeakHero(db, rid, { now: NOW });
    expect(hero.leakIls).toBe(759.54); // W2-09a's pin: unchanged
    expect(hero.caughtBeforePaymentIls).toBe(296);

    const rows = await invoiceStatesForMonth(db, rid, { now: NOW });
    const c = countStates(rows);
    expect(rows).toHaveLength(hero.invoiceCount);
    expect(c.awaiting_count).toBe(hero.awaitingCountCount);
    expect(rows.filter((r) => r.pendingLink && !r.awaitingCount)).toHaveLength(hero.pendingLinkCount);
    expect(c.awaiting_link + c.in_ocr).toBe(hero.pendingLinkCount);
    expect(rows.reduce((a, r) => a + Math.round(r.leakIls * 100), 0)).toBe(Math.round(hero.leakIls * 100));
    expect(rows.filter((r) => r.state !== 'paid').reduce((a, r) => a + Math.round(r.leakIls * 100), 0)).toBe(
      Math.round(hero.caughtBeforePaymentIls * 100),
    );
    expect(c).toEqual({
      in_ocr: 0,
      awaiting_count: 0,
      awaiting_link: 2,
      clean: 8,
      flagged_open: 4,
      claim_open: 0,
      held_duplicate: 0,
      approved: 0,
      paid: 23,
    });

    // The pay run reads the CURRENT month (new Date()); compare when the lab month is this or last month.
    const today = new Date();
    const offset = (NOW.getUTCFullYear() - today.getUTCFullYear()) * 12 + (NOW.getUTCMonth() - today.getUTCMonth());
    if (offset !== 0 && offset !== -1) return;
    const caller = appRouter.createCaller({ db, session: { userId: owners[0]!.user_id, restaurantId: rid, role: 'owner' } });
    const run = await caller.payRun.month({ monthOffset: offset });
    const byId = new Map(rows.map((r) => [r.invoiceId, r]));
    const seen = new Set<string>();
    for (const s of run.suppliers) {
      for (const inv of s.invoices) {
        const bucket = inv.pendingLink && !inv.duplicate ? 'link' : inv.status;
        const st = byId.get(inv.invoiceId)?.state;
        expect(st && PAY_RUN_BUCKET[st], `${inv.invoiceId} ${bucket} vs ${st}`).toBe(bucket);
        seen.add(inv.invoiceId);
      }
    }
    // …and the pay run lists exactly the unpaid invoices that are out of OCR.
    expect([...seen].sort()).toEqual(rows.filter((r) => r.state !== 'paid' && r.state !== 'in_ocr').map((r) => r.invoiceId).sort());
    expect(run.totals.linkCount).toBe(c.awaiting_link);
  });
});
