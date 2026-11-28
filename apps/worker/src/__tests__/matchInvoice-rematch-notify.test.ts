import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  and,
  asc,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  inArray,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  poLines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
  users,
} from '@restomatch/db';
import { matchInvoiceForJob, processMatchInvoice } from '../jobs/matchInvoice';
import type { WorkerJob } from '../queue';

/**
 * AU-04 A1 · a RE-match notifies only when it finds something NEW:
 *  - new = finding identities absent from the replaced run (open AND decided there),
 *    never `rolesNeedingNotification` (which re-lists every undecided carry-over);
 *  - one row per (invoice, new identity set, person); a replay or a re-match that
 *    adds nothing sends nothing; deciders only (never receiver / chef); no `role:` targets;
 *  - a NEW send → behind `rematchAlerts`, default OFF: `{}` settings send nothing;
 *  - enqueued INSIDE the match transaction (atomic with the run): a retry after the
 *    commit sees no new identity, so the send cannot wait for post-commit code.
 */
process.env.DATABASE_URL ??= testDbUrl();
process.env.APP_BASE_URL = 'https://app.example.test';
const db = createDb(testDbUrl());
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const NOW = new Date('2026-10-25T09:00:00Z');
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });

let restaurantId = '';
let supplierId = '';
let poId = '';
let invoiceId = '';
let lines: Array<{ id: string; productId: string | null; desc: string | null; qty: number; unit: string; price: number }> = [];
let invLineIds: string[] = [];

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const [pkg, script] of [
    ['@restomatch/db', 'scripts/seed.ts'],
    ['@restomatch/worker', 'scripts/seed-demo.ts'],
  ] as const) {
    const run = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsx', script], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: testDbUrl(), DEMO_TODAY: '2026-10-25' },
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`demo seed (${script}) failed:\n${run.stdout}\n${run.stderr}`);
  }
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  restaurantId = r!.id;
  const [sup] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.nameEn, 'HaSharon Produce')))
    .limit(1);
  supplierId = sup!.id;
  const [po] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, restaurantId),
        eq(purchaseOrders.supplierId, supplierId),
        inArray(purchaseOrders.status, ['sent', 'confirmed']),
        sql`not exists (select 1 from goods_receipts g where g.po_id = ${purchaseOrders.id})`,
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${purchaseOrders.expectedDeliveryAt} - ${NOW.toISOString()}::timestamptz)))`)
    .limit(1);
  poId = po!.id;
  lines = (
    await db
      .select({ id: poLines.id, productId: poLines.productId, desc: poLines.rawDescription, qty: poLines.qtyOrdered, unit: poLines.unit, price: poLines.unitPriceExpected })
      .from(poLines)
      .where(eq(poLines.poId, poId))
      .orderBy(asc(poLines.id))
  ).map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price) }));
  expect(lines.length).toBeGreaterThan(1);

  // Received exactly as ordered; the invoice billed exactly as ordered → a clean first match.
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId, status: 'completed' }).returning();
  await db.insert(grLines).values(lines.map((l) => ({ grId: gr!.id, poLineId: l.id, productId: l.productId, qtyReceived: String(l.qty) })));
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.price * 100), 0) / 100;
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId, supplierId, status: 'matched', source: 'photo', rawImageUrl: `https://x/${gr!.id}.jpg`,
      invoiceNumber: 'RM-A1-0001', invoiceDate: NOW,
      totalExclVat: total.toFixed(2), vatAmount: '0.00', totalInclVat: total.toFixed(2),
    })
    .returning();
  invoiceId = inv!.id;
  invLineIds = (
    await db
      .insert(invoiceLines)
      .values(lines.map((l) => ({
        invoiceId, productId: l.productId, rawDescription: l.desc ?? '—', qtyBilled: String(l.qty), unit: l.unit,
        unitPriceBilled: String(l.price), lineTotal: (Math.round(l.qty * l.price * 100) / 100).toFixed(2),
      })))
      .returning({ id: invoiceLines.id })
  ).map((x) => x.id);
}, 240_000);

afterAll(async () => {
  await db.execute(sql`TRUNCATE restaurants, users RESTART IDENTITY CASCADE`);
});

/** Bill line `i` at 3× its price (a clear PRICE_HIGHER that a decider must look at). */
async function overbill(i: number) {
  const l = lines[i]!;
  const price = l.price * 3;
  await db
    .update(invoiceLines)
    .set({ unitPriceBilled: String(price), lineTotal: (Math.round(l.qty * price * 100) / 100).toFixed(2) })
    .where(eq(invoiceLines.id, invLineIds[i]!));
}

const a1Rows = () =>
  db
    .select({ target: notificationsOutbox.target, key: notificationsOutbox.dedupeKey, payload: notificationsOutbox.payload })
    .from(notificationsOutbox)
    .where(and(eq(notificationsOutbox.restaurantId, restaurantId), sql`${notificationsOutbox.dedupeKey} like 'au:A1:%'`));

const rematch = () => processMatchInvoice(job({ restaurantId, invoiceId, rematch: true }));

describe('A1 match alert on re-match (DB)', () => {
  it('first match (clean) → no A1 alert', async () => {
    await processMatchInvoice(job({ restaurantId, invoiceId }));
    expect(await a1Rows()).toHaveLength(0);
  });

  it('default OFF: `{}` settings → a re-match with a NEW finding writes no au:A1 row', async () => {
    // No stored automations option (the seed's other settings kept).
    await db.execute(sql`update restaurants set settings = coalesce(settings, '{}'::jsonb) - 'automations' where id = ${restaurantId}`);
    await overbill(0);
    await rematch();
    expect(await a1Rows()).toHaveLength(0);
    // Back to the clean bill for the cases below.
    await db
      .update(invoiceLines)
      .set({ unitPriceBilled: String(lines[0]!.price), lineTotal: (Math.round(lines[0]!.qty * lines[0]!.price * 100) / 100).toFixed(2) })
      .where(eq(invoiceLines.id, invLineIds[0]!));
    await rematch();
  });

  it('a re-match with a NEW finding → one alert per decider, deciders only, no role: targets', async () => {
    await db.execute(sql`update restaurants
      set settings = coalesce(settings, '{}'::jsonb) || '{"automations":{"rematchAlerts":true}}'::jsonb where id = ${restaurantId}`);
    await overbill(0);
    await rematch();
    const rows = await a1Rows();
    expect(rows.length).toBeGreaterThan(0);
    const roles = await db
      .select({ email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.restaurantId, restaurantId));
    const roleOf = new Map(roles.map((r) => [r.email, r.role]));
    for (const r of rows) {
      expect(r.target.startsWith('role:')).toBe(false);
      expect(['owner', 'manager', 'bookkeeper']).toContain(roleOf.get(r.target));
      expect((r.payload as { automationId?: string }).automationId).toBe('A1');
      expect((r.payload as { invoiceId?: string }).invoiceId).toBe(invoiceId);
    }
    expect(new Set(rows.map((r) => r.target)).size).toBe(rows.length); // once per person
  });

  it('a re-match that only carries the same OPEN finding over → nothing new (twice in a row)', async () => {
    const before = (await a1Rows()).length;
    await rematch();
    await rematch();
    expect((await a1Rows()).length).toBe(before);
  });

  it('a carried-over DECIDED finding is not new either', async () => {
    const before = (await a1Rows()).length;
    await db
      .update(discrepancies)
      .set({ resolutionStatus: 'accepted', resolvedAt: new Date() })
      .where(
        and(
          eq(discrepancies.restaurantId, restaurantId),
          sql`${discrepancies.matchRunId} in (select id from match_runs where invoice_id = ${invoiceId})`,
        ),
      );
    await rematch();
    expect((await a1Rows()).length).toBe(before);
  });

  it('a second, different new finding → one more alert per decider', async () => {
    const before = await a1Rows();
    await overbill(1);
    await rematch();
    const after = await a1Rows();
    expect(after.length).toBeGreaterThan(before.length);
    const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
    expect(runs).toHaveLength(1);
  });

  it('the alert is written with the run (matchInvoiceForJob alone, no post-commit step) and counts only open new findings', async () => {
    const before = (await a1Rows()).length;
    await overbill(2);
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true });
    expect(out.newFindings?.keys.length).toBe(1);
    const after = await a1Rows();
    expect(after.length).toBeGreaterThan(before);
    // A retry after that commit: same identities → nothing more.
    await rematch();
    expect((await a1Rows()).length).toBe(after.length);
  });
});
