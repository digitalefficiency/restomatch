import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  auditLog,
  createDb,
  ensureRlsAppRole,
  eq,
  invoices,
  notificationsOutbox,
  restaurants,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import type { AppContext, Session } from '../context';
import { router } from '../trpc';
import { assertPreflightClear, makePreflightProcedures } from '../payRun/procedures';
import { runPreflight, type BankChangeSource } from '../payRun/preflightData';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * AU-14 · the pre-flight against Postgres on the RLS-enforced app role (`restomatch_app`).
 * The procedures are mounted on a LOCAL router until W2-03 (#248) merges and
 * `routers/payRun.ts` spreads them (then these cases move, add-only, into payrun.attack.test.ts).
 *
 *   A — flag payRun on; B — another tenant, never visible to A.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;

const NOW = new Date('2026-12-10T08:00:00Z');
/** The guard runs inside markPaid's tenant transaction; tests open one the same way. */
const guard = (rid: string, ...rest: Parameters<typeof assertPreflightClear> extends [unknown, unknown, ...infer R] ? R : never) =>
  withRestaurant(appDb, rid, (tx) => assertPreflightClear(tx, rid, ...rest));
const procs = makePreflightProcedures({ now: () => NOW });
const local = router({ payRun: router(procs) });

function caller(t: Tenant, role: Session['role'] = 'owner', db: Database = appDb) {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return local.createCaller(ctx);
}
const setSettings = (t: Tenant, settings: Record<string, unknown>) =>
  ownerDb
    .update(restaurants)
    .set({ settings: settings as typeof restaurants.$inferInsert['settings'] })
    .where(eq(restaurants.id, t.restaurantId));
const ON = { features: { payRun: true } };

/** Counts every statement the reader sends (execute / select / insert / update). */
function countingDb(db: Database): { db: Database; count: () => number } {
  let n = 0;
  const wrapped = new Proxy(db, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v === 'function' && ['execute', 'select', 'insert', 'update', 'delete'].includes(String(prop))) {
        return (...args: unknown[]) => {
          n += 1;
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return v;
    },
  });
  return { db: wrapped, count: () => n };
}

async function addInvoice(t: Tenant, p: Partial<typeof invoices.$inferInsert>) {
  const [row] = await ownerDb
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceDate: new Date('2026-12-08T10:00:00Z'),
      totalExclVat: '100.00',
      vatAmount: '17.00',
      totalInclVat: '117.00',
      status: 'matched',
      source: 'email',
      ...p,
    })
    .returning();
  return row!;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'FA');
  B = await seedTenant(ownerDb, 'FB');
  await setSettings(A, ON);
  await setSettings(B, ON);
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('payRun.preflight (read)', () => {
  it('flag payRun off → enabled:false, no flags', async () => {
    await setSettings(A, {});
    try {
      expect(await caller(A).payRun.preflight()).toMatchObject({ enabled: false, invoices: [] });
    } finally {
      await setSettings(A, ON);
    }
  });

  it('flags A’s invoices: first payment, a cross-channel twin, an AU-10 copy; never B’s', async () => {
    const [seeded] = await ownerDb.select({ at: invoices.invoiceDate }).from(invoices).where(eq(invoices.id, A.invoiceId));
    const twinAt = new Date(seeded!.at!.getTime() + 86_400_000); // the next day, another channel
    const twin = await addInvoice(A, { invoiceNumber: 'FA-TWIN', totalInclVat: '117.50', source: 'whatsapp', invoiceDate: twinAt });
    const copy = await addInvoice(A, {
      invoiceNumber: 'FA-COPY',
      totalInclVat: '900.00',
      ocrPayload: { duplicateOf: { invoiceId: twin.id, invoiceNumber: 'FA-TWIN', basis: 'cross_channel' } } as never,
    });
    const res = await caller(A, 'bookkeeper').payRun.preflight();
    expect(res.enabled).toBe(true);
    const byId = new Map(res.invoices.map((i) => [i.invoiceId, i.flags.map((f) => f.kind)]));
    expect(byId.get(copy.id)).toContain('confirmed_copy');
    expect(byId.get(twin.id)).toEqual(expect.arrayContaining(['possible_duplicate', 'first_payment']));
    // The hold row sorts first.
    expect(res.invoices[0]!.invoiceId).toBe(copy.id);
    expect(res.summary!.blocked).toBe(1);
    // B's rows never reach A.
    const bIds = (await ownerDb.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, B.restaurantId))).map((r) => r.id);
    for (const id of bIds) expect(byId.has(id)).toBe(false);
    expect(JSON.stringify(res)).not.toContain(B.supplierName);
    // Hebrew reason text rides along.
    const twinFlag = res.invoices.find((i) => i.invoiceId === twin.id)!.flags.find((f) => f.kind === 'possible_duplicate')!;
    expect(twinFlag.text.he).toMatch(/^ייתכן כפל: דומה ל-/);
    await ownerDb.delete(invoices).where(eq(invoices.id, copy.id));
    await ownerDb.delete(invoices).where(eq(invoices.id, twin.id));
  });

  it('receiver and chef → FORBIDDEN', async () => {
    await expect(caller(A, 'receiver').payRun.preflight()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(A, 'chef').payRun.preflight()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('500 invoices → ≤ 3 queries (no N+1) and read-only (no audit row, no update)', async () => {
    const values = Array.from({ length: 500 }, (_, i) => ({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: `BULK-${i}`,
      invoiceDate: new Date(Date.UTC(2026, 10, 1 + (i % 28), 10)),
      totalInclVat: (100 + i * 7).toFixed(2),
      status: 'matched' as const,
      source: 'photo' as const,
    }));
    await ownerDb.insert(invoices).values(values);
    const auditBefore = (await ownerDb.select({ n: sql<number>`count(*)::int` }).from(auditLog))[0]!.n;
    const stampBefore = (await ownerDb.execute(sql`SELECT max(updated_at)::text AS m FROM invoices`)) as unknown as { m: string }[] | { rows: { m: string }[] };

    // The reader runs inside the tenant transaction (RLS GUC set), exactly as the procedure does.
    let counted = 0;
    const pre = await withRestaurant(appDb, A.restaurantId, async (tx) => {
      const c = countingDb(tx);
      const r = await runPreflight(c.db, A.restaurantId, { now: NOW });
      counted = c.count();
      return r;
    });
    expect(pre.candidates.length).toBeGreaterThanOrEqual(500);
    expect(pre.queries).toBeLessThanOrEqual(3);
    expect(counted).toBeLessThanOrEqual(3);
    // And the procedure returns them all.
    expect((await caller(A).payRun.preflight()).summary!.invoices).toBeGreaterThanOrEqual(1);

    const auditAfter = (await ownerDb.select({ n: sql<number>`count(*)::int` }).from(auditLog))[0]!.n;
    expect(auditAfter).toBe(auditBefore);
    const stampAfter = (await ownerDb.execute(sql`SELECT max(updated_at)::text AS m FROM invoices`)) as unknown as typeof stampBefore;
    expect(stampAfter).toEqual(stampBefore);
    await ownerDb.execute(sql`DELETE FROM invoices WHERE invoice_number LIKE 'BULK-%'`);
  });
});

describe('the markPaid guard (assertPreflightClear)', () => {
  const bankFor = (supplierId: string, confirmed: string[] = []): BankChangeSource => ({
    async read(_db, _rid, supplierIds) {
      return {
        changes: supplierIds.includes(supplierId)
          ? [{ id: 'chg-1', supplierId, changedAt: '2026-12-03T09:00:00Z', accountLast4: '4821' }]
          : [],
        confirmedChangeIds: new Set(confirmed),
      };
    },
  });

  it('an unconfirmed bank change → PRECONDITION_FAILED preflight_hold, even with the option off (AD12)', async () => {
    await setSettings(A, { features: { payRun: true }, automations: { payRunPreflight: false } });
    try {
      await expect(
        guard(A.restaurantId, [A.invoiceId], [{ invoiceId: A.invoiceId, kinds: ['bank_changed'] }], {
          bank: bankFor(A.supplierId),
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'preflight_hold' });
    } finally {
      await setSettings(A, ON);
    }
  });

  it('owner-confirmed change → only the soft flags remain, and they need acknowledging', async () => {
    const bank = bankFor(A.supplierId, ['chg-1']);
    await expect(guard(A.restaurantId, [A.invoiceId], [], { bank, now: NOW })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'preflight_unacknowledged',
    });
    const ack = await guard(A.restaurantId, [A.invoiceId], [{ invoiceId: A.invoiceId, kinds: ['first_payment'] }], { bank, now: NOW });
    expect(ack.get(A.invoiceId)).toEqual(['first_payment']);
  });

  it('fails closed: a foreign id, or a call without the tenant transaction → NOT_FOUND', async () => {
    await expect(guard(A.restaurantId, [B.invoiceId], [], { now: NOW })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      guard(A.restaurantId, [A.invoiceId, B.invoiceId], [{ invoiceId: A.invoiceId, kinds: ['first_payment'] }], { now: NOW }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // No GUC → RLS hides every row → refused, never "clear".
    await expect(
      assertPreflightClear(appDb, A.restaurantId, [A.invoiceId], [{ invoiceId: A.invoiceId, kinds: ['first_payment'] }], { now: NOW }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('bank account numbers are cut to last4 whatever the source passes', async () => {
    const leaky: BankChangeSource = {
      async read(_db, _rid, supplierIds) {
        return {
          changes: [{ id: 'chg-x', supplierId: supplierIds[0]!, changedAt: '2026-12-03T09:00:00Z', accountLast4: '12-345-678904821' }],
          confirmedChangeIds: new Set(),
        };
      },
    };
    const pre = await withRestaurant(appDb, A.restaurantId, (tx) => runPreflight(tx, A.restaurantId, { bank: leaky, now: NOW }));
    const f = pre.flags.get(A.invoiceId)!.find((x) => x.kind === 'bank_changed')!;
    expect(f.vars.accountLast4).toBe('4821');
    expect(JSON.stringify([...pre.flags.values()])).not.toContain('678904821');
  });
});

describe('payRun.remittanceText', () => {
  it('a draft for A’s supplier; nothing is sent (0 outbox rows)', async () => {
    const outboxBefore = (await ownerDb.select({ n: sql<number>`count(*)::int` }).from(notificationsOutbox))[0]!.n;
    const r = await caller(A, 'bookkeeper').payRun.remittanceText({
      supplierId: A.supplierId,
      invoiceIds: [A.invoiceId],
      paidOn: '2026-12-10',
    });
    expect(r.he).toContain(A.invoiceNumber);
    expect(r.he).toContain('ביום 10.12.2026');
    expect(r.netIls).toBe(117);
    expect(r.he).not.toMatch(/דרישה|תביעה|מחלוקת|חוב|באיחור/);
    const outboxAfter = (await ownerDb.select({ n: sql<number>`count(*)::int` }).from(notificationsOutbox))[0]!.n;
    expect(outboxAfter).toBe(outboxBefore);
  });

  it('another A invoice held on an undecided finding is "בבדיקה" with no ₪', async () => {
    const extra = await addInvoice(A, { invoiceNumber: 'FA-PAYME', totalInclVat: '50.00' });
    try {
      const r = await caller(A).payRun.remittanceText({ supplierId: A.supplierId, invoiceIds: [extra.id], paidOn: '2026-12-10' });
      const held = r.he.split('\n').filter((l) => l.includes('בבדיקה'));
      // The seeded invoice carries an open finding → named in review, no amount.
      expect(held.some((l) => l.includes(A.invoiceNumber))).toBe(true);
      for (const l of held) expect(l).not.toMatch(/₪|\d+[.,]\d{2}/);
    } finally {
      await ownerDb.delete(invoices).where(eq(invoices.id, extra.id));
    }
  });

  it('a foreign supplierId or invoiceId → NOT_FOUND; receiver → FORBIDDEN', async () => {
    await expect(
      caller(A).payRun.remittanceText({ supplierId: B.supplierId, invoiceIds: [B.invoiceId] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller(A).payRun.remittanceText({ supplierId: A.supplierId, invoiceIds: [B.invoiceId] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller(A, 'receiver').payRun.remittanceText({ supplierId: A.supplierId, invoiceIds: [A.invoiceId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller(A, 'chef').payRun.remittanceText({ supplierId: A.supplierId, invoiceIds: [A.invoiceId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A mixed A+B batch → NOT_FOUND, with the same message as a random uuid (no oracle).
    const mixed = caller(A).payRun.remittanceText({ supplierId: A.supplierId, invoiceIds: [A.invoiceId, B.invoiceId] });
    await expect(mixed).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'invoice not found' });
    await expect(
      caller(A).payRun.remittanceText({ supplierId: A.supplierId, invoiceIds: ['00000000-0000-4000-8000-000000000999'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'invoice not found' });
  });
});
