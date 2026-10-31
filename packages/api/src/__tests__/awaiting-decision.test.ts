import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  memberships,
  restaurants,
  testDbUrl,
  users,
  type UserRole,
} from '@restomatch/db';
import { computeInvoiceLeak } from '@restomatch/charts';
import { awaitingDecision, type AwaitingScope } from '../approvals/awaiting';
import { claimableLines } from '../lib/claims';
import { isClaimableRow } from '../routers/approvals';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedTenant } from './fixtures';

/**
 * G-12a — `awaitingDecision`: ONE definition of "how many gaps and how much ₪
 * wait for a decision, and for whom". Independent of paging, the letters' ₪
 * rule per VAT basis, the role matrix, tenant isolation, and parity with
 * today's `approvals.queueSummary` on the demo seed.
 */
const db = createDb(testDbUrl());
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

type Seeded = { restaurantId: string; users: Record<UserRole, string> };

const ctxOf = (s: Seeded, role: UserRole) => ({ session: { restaurantId: s.restaurantId, role } });
const callerOf = (s: Seeded, role: UserRole) =>
  appRouter.createCaller({
    db,
    session: { userId: s.users[role], restaurantId: s.restaurantId, role },
  } as AppContext);
const run = (
  s: Seeded,
  role: UserRole,
  scope: AwaitingScope,
  filters?: Parameters<typeof awaitingDecision>[2]['filters'],
) => awaitingDecision(db, ctxOf(s, role), { scope, filters });

/* ─────────────── the 120-findings fixture ─────────────── */

async function seed120(): Promise<Seeded & { pendingInvoiceId: string; tenantBInvoiceId: string }> {
  const [r] = await db.insert(restaurants).values({ name: 'Awaiting Bistro' }).returning();
  const rid = r!.id;
  const roles: UserRole[] = ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'];
  const ids = {} as Record<UserRole, string>;
  for (const role of roles) {
    const [u] = await db
      .insert(users)
      .values({ email: `${role}@await.test` })
      .returning();
    ids[role] = u!.id;
    await db.insert(memberships).values({ userId: u!.id, restaurantId: rid, role });
  }

  async function invoice(total: string) {
    const [i] = await db
      .insert(invoices)
      .values({ restaurantId: rid, source: 'manual', status: 'matched', totalInclVat: total })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({
        restaurantId: rid,
        invoiceId: i!.id,
        overallStatus: 'major',
        totalDiscrepancyAmount: '0',
      })
      .returning();
    return { invoiceId: i!.id, matchRunId: mr!.id };
  }
  type Row = Partial<typeof discrepancies.$inferInsert>;
  async function rows(mr: string, n: number, v: Row) {
    await db.insert(discrepancies).values(
      Array.from({ length: n }, () => ({
        restaurantId: rid,
        matchRunId: mr,
        type: 'PRICE_HIGHER' as const,
        severity: 'warn' as const,
        deltaAmount: '0',
        requiresRole: 'owner' as const,
        resolutionStatus: 'open' as const,
        ...v,
      })),
    );
  }

  // I1 — a big invoice: no cap binds.
  const i1 = await invoice('100000.00');
  await rows(i1.matchRunId, 40, { deltaAmount: '10.00' }); // owner, claimable, excl
  await rows(i1.matchRunId, 20, {
    type: 'QTY_SHORT',
    severity: 'info',
    deltaAmount: '5.00',
    requiresRole: 'manager',
  });
  await rows(i1.matchRunId, 10, {
    type: 'PRICE_LOWER',
    deltaAmount: '-3.00',
    requiresRole: 'manager',
  });
  await rows(i1.matchRunId, 10, {
    type: 'MISSING_ON_INVOICE',
    deltaAmount: '6.00',
    requiresRole: 'manager',
  });
  await rows(i1.matchRunId, 5, { type: 'TOTAL_MISMATCH', deltaAmount: '2.00', requiresRole: null }); // unrouted
  // Not counted: a ₀ QTY_SHORT twin, and a decided row.
  await rows(i1.matchRunId, 1, { type: 'QTY_SHORT', deltaAmount: '0' });
  await rows(i1.matchRunId, 1, { deltaAmount: '11.00', resolutionStatus: 'accepted' });
  // I2 — the cap binds: 10 × ₪20 on a ₪50 invoice → ₪50.
  const i2 = await invoice('50.00');
  await rows(i2.matchRunId, 10, { deltaAmount: '20.00' });
  // I3 — a duplicate (incl. VAT, blocking) + info rows.
  const i3 = await invoice('1170.00');
  await rows(i3.matchRunId, 1, {
    type: 'DUPLICATE_INVOICE',
    severity: 'block',
    deltaAmount: '1170.00',
    requiresRole: 'bookkeeper',
  });
  await rows(i3.matchRunId, 3, { type: 'DATE_ANOMALY', severity: 'info', deltaAmount: '0' });
  // I4 — a VAT mismatch (a VAT amount) + before-VAT rows.
  const i4 = await invoice('2000.00');
  await rows(i4.matchRunId, 1, { type: 'VAT_MISMATCH', deltaAmount: '34.00' });
  await rows(i4.matchRunId, 9, { type: 'QTY_OVER', deltaAmount: '7.50', requiresRole: 'manager' });
  // I5 — waiting for a PO link: claims nothing yet.
  const i5 = await invoice('3000.00');
  await rows(i5.matchRunId, 1, {
    type: 'UNORDERED_ARRIVAL',
    deltaAmount: '3000.00',
    requiresRole: 'manager',
  });
  await rows(i5.matchRunId, 10, { deltaAmount: '4.00' });

  // Tenant B: a big owner row that must never be counted for A.
  const b = await seedTenant(db, 'awaiting-b');
  await db.insert(discrepancies).values({
    restaurantId: b.restaurantId,
    matchRunId: b.matchRunId,
    type: 'PRICE_HIGHER',
    severity: 'block',
    deltaAmount: '999.00',
    requiresRole: 'owner',
    resolutionStatus: 'open',
  });
  return {
    restaurantId: rid,
    users: ids,
    pendingInvoiceId: i5.invoiceId,
    tenantBInvoiceId: b.invoiceId,
  };
}

describe('awaitingDecision — 120 findings', () => {
  let s: Awaited<ReturnType<typeof seed120>>;
  beforeAll(async () => {
    await resetDb(db);
    s = await seed120();
  }, 60_000);

  it('owner · all: every open row, ₪ per basis never summed, review rows carry no ₪', async () => {
    const a = await run(s, 'owner', 'all');
    expect(a.count).toBe(120);
    expect(a.blockers).toBe(1);
    expect(a.toDecide.count).toBe(76);
    expect(a.reviewOnly.count).toBe(44); // 20 info + 10 PRICE_LOWER + 10 MISSING + 1 UNORDERED + 3 info
    expect(a.ils).toEqual({ excl: 527.5, incl: 1170, vat: 34, mixedBasis: true });
    expect(a.pendingLink).toEqual({ count: 1, inclVatIls: 3000 });
    expect(a.byRole).toEqual([
      { role: 'owner', count: 64, ils: { excl: 450, incl: 0, vat: 34, mixedBasis: true } },
      { role: 'manager', count: 50, ils: { excl: 67.5, incl: 0, vat: 0, mixedBasis: false } },
      { role: 'bookkeeper', count: 1, ils: { excl: 0, incl: 1170, vat: 0, mixedBasis: false } },
      { role: 'unrouted', count: 5, ils: { excl: 10, incl: 0, vat: 0, mixedBasis: false } },
    ]);
    expect(a.oldestAt).toBeInstanceOf(Date);
  });

  it('Σ per basis = Σ claimableLines over the per-invoice leak (the letters), to the agora', async () => {
    const open = await db
      .select({
        id: discrepancies.id,
        invoiceId: matchRuns.invoiceId,
        type: discrepancies.type,
        severity: discrepancies.severity,
        deltaAmount: discrepancies.deltaAmount,
        status: discrepancies.resolutionStatus,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(discrepancies.restaurantId, s.restaurantId));
    const want = new Set(
      open
        .filter((r) => (r.status === 'open' || r.status === 'escalated') && isClaimableRow(r))
        .map((r) => r.id),
    );
    const sums = { excl: 0, incl: 0, vat: 0 };
    for (const id of new Set(open.map((r) => r.invoiceId!))) {
      const inv = await computeInvoiceLeak(db, s.restaurantId, id);
      for (const c of claimableLines(inv!))
        if (want.has(c.line.discrepancyId)) sums[c.basis] += Math.round(c.amount * 100);
    }
    const a = await run(s, 'owner', 'all');
    expect(Math.round(a.ils!.excl * 100)).toBe(sums.excl);
    expect(Math.round(a.ils!.incl * 100)).toBe(sums.incl);
    expect(Math.round(a.ils!.vat * 100)).toBe(sums.vat);
  });

  it('the cap binds: 10 × ₪20 on a ₪50 invoice counts ₪50', async () => {
    const [i2] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, s.restaurantId), eq(invoices.totalInclVat, '50.00')));
    const a = await run(s, 'owner', 'all', { invoiceIds: [i2!.id] });
    expect(a.count).toBe(10);
    expect(a.ils).toEqual({ excl: 50, incl: 0, vat: 0, mixedBasis: false });
  });

  it('independent of paging: myQueue paged 50 at a time covers exactly the owner’s "mine" set', async () => {
    const mine = await run(s, 'owner', 'mine');
    const seen = new Set<string>();
    let afterId: string | undefined;
    for (let page = 0; page < 10; page++) {
      const rows = await callerOf(s, 'owner').approvals.myQueue({ limit: 50, afterId });
      rows.forEach((r) => seen.add(r.id));
      if (rows.length < 50) break;
      afterId = rows.at(-1)!.id;
    }
    expect(seen.size).toBe(115);
    expect(mine.count).toBe(seen.size);
    expect(mine.ils).toEqual({ excl: 517.5, incl: 1170, vat: 34, mixedBasis: true });
  });

  it('filters narrow rows and ₪ together', async () => {
    const a = await run(s, 'owner', 'all', { types: ['DUPLICATE_INVOICE', 'VAT_MISMATCH'] });
    expect(a.count).toBe(2);
    expect(a.ils).toEqual({ excl: 0, incl: 1170, vat: 34, mixedBasis: true });
    const b = await run(s, 'owner', 'all', { severities: ['info'] });
    expect(b).toMatchObject({ count: 23, toDecide: { count: 0 }, reviewOnly: { count: 23 } });
    expect(b.ils).toEqual({ excl: 0, incl: 0, vat: 0, mixedBasis: false });
  });

  it('scope × role matrix', async () => {
    const mgrMine = await run(s, 'manager', 'mine');
    expect(mgrMine.count).toBe(50);
    expect(mgrMine.ils).toEqual({ excl: 67.5, incl: 0, vat: 0, mixedBasis: false });
    expect((await run(s, 'manager', 'all')).count).toBe(120);

    const bkMine = await run(s, 'bookkeeper', 'mine');
    expect(bkMine.count).toBe(1);
    expect(bkMine.ils).toEqual({ excl: 0, incl: 1170, vat: 0, mixedBasis: false });
    const bkAll = await run(s, 'bookkeeper', 'all');
    expect(bkAll.count).toBe(120);
    expect(bkAll.byRole.find((e) => e.role === 'owner')).toEqual({
      role: 'owner',
      count: 64,
      ils: { excl: 450, incl: 0, vat: 34, mixedBasis: true },
    });

    // Receiver / chef: no purchase or leak ₪ (owner decision) — every ₪ field null.
    for (const role of ['receiver', 'chef'] as const) {
      for (const scope of ['mine', 'all'] as const) {
        const a = await run(s, role, scope);
        expect(a.ils).toBeNull();
        expect(a.pendingLink.inclVatIls).toBeNull();
        expect(a.byRole.every((e) => e.ils === null)).toBe(true);
      }
    }
  });

  it('tenant isolation: tenant B’s rows are never counted, and B never sees A', async () => {
    const a = await run(s, 'owner', 'all');
    expect(a.count).toBe(120);
    const foreign = await run(s, 'owner', 'all', { invoiceIds: [s.tenantBInvoiceId] });
    expect(foreign.count).toBe(0);
    expect(foreign.ils).toEqual({ excl: 0, incl: 0, vat: 0, mixedBasis: false });
    const [bOwner] = await db
      .select({ rid: memberships.restaurantId })
      .from(memberships)
      .innerJoin(invoices, eq(invoices.restaurantId, memberships.restaurantId))
      .where(eq(invoices.id, s.tenantBInvoiceId));
    const b = await awaitingDecision(
      db,
      { session: { restaurantId: bOwner!.rid, role: 'owner' } },
      { scope: 'all' },
    );
    expect(b.count).toBeGreaterThan(0);
    expect(b.count).toBeLessThan(5);
  });
});

/* ─────────────── parity on the demo seed (lab, 25.10) ─────────────── */

describe('awaitingDecision — parity with approvals.queueSummary on the demo seed', () => {
  let s: Seeded;
  beforeAll(async () => {
    await resetDb(db);
    for (const [pkg, script] of [
      ['@restomatch/db', 'scripts/seed.ts'],
      ['@restomatch/worker', 'scripts/seed-demo.ts'],
    ] as const) {
      const r = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsx', script], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: testDbUrl(), DEMO_TODAY: '2026-10-25' },
        encoding: 'utf8',
      });
      if (r.status !== 0)
        throw new Error(`demo seed (${script}) failed:\n${r.stdout}\n${r.stderr}`);
    }
    const [r] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.name, 'כפר הזיתים'))
      .limit(1);
    const members = await db
      .select({ id: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.restaurantId, r!.id));
    s = {
      restaurantId: r!.id,
      users: Object.fromEntries(members.map((m) => [m.role, m.id])) as Record<UserRole, string>,
    };
  }, 180_000);

  afterAll(async () => {
    await resetDb(db);
  });

  it.each(['owner', 'manager', 'bookkeeper'] as const)(
    '%s · mine = queueSummary (count, blockers, oldest, ₪ per basis, split)',
    async (role) => {
      const q = await callerOf(s, role).approvals.queueSummary();
      const a = await run(s, role, 'mine');
      expect(a.count).toBe(q.count);
      expect(a.blockers).toBe(q.blockers);
      expect(a.oldestAt?.toISOString()).toBe(q.oldestAt?.toISOString());
      expect(a.toDecide.count).toBe(q.toDecide.count);
      expect(a.reviewOnly.count).toBe(q.toReview.count);
      expect(a.ils).toMatchObject({ excl: q.claimableIls, incl: q.duplicateIls, vat: q.vatIls });
    },
  );

  it('bookkeeper · all: byRole names the ₪ waiting on the owner (never "inbox zero")', async () => {
    const owner = await run(s, 'owner', 'mine');
    const ownerOnly = await callerOf(s, 'owner').approvals.queueSummary();
    const bk = await run(s, 'bookkeeper', 'all');
    const byOwner = bk.byRole.find((e) => e.role === 'owner')!;
    expect(byOwner.count).toBeGreaterThan(0);
    expect(byOwner.ils!.excl).toBeGreaterThan(0);
    // all = Σ byRole, per basis
    const sum = (k: 'excl' | 'incl' | 'vat') =>
      Math.round(bk.byRole.reduce((t, e) => t + e.ils![k] * 100, 0));
    expect(sum('excl')).toBe(Math.round(bk.ils!.excl * 100));
    expect(bk.byRole.reduce((t, e) => t + e.count, 0)).toBe(bk.count);
    // The owner sees the owner+manager+bookkeeper routings as "mine": Σ of those byRole lanes.
    expect(owner.count).toBe(ownerOnly.count);
    // Lab invariant (brief §5.2 / the orchestrator's check layer): owner 4 / ₪296.00.
    expect(owner).toMatchObject({
      count: 4,
      ils: { excl: 296, incl: 0, vat: 0, mixedBasis: false },
    });
    expect(bk).toMatchObject({ count: 4, ils: { excl: 296 } });
    // Routed as stored: 2 wait on the owner, 2 on the manager (the owner may act on both).
    expect(bk.byRole).toEqual([
      { role: 'owner', count: 2, ils: { excl: 143.5, incl: 0, vat: 0, mixedBasis: false } },
      { role: 'manager', count: 2, ils: { excl: 152.5, incl: 0, vat: 0, mixedBasis: false } },
    ]);
    console.info(
      `[G-12 demo] owner mine ${owner.count} · ₪${owner.ils!.excl}; bookkeeper all byRole ${JSON.stringify(bk.byRole)}`,
    );
  });
});
