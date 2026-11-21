import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityEvents,
  and,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
  users,
  type Database,
} from '@restomatch/db';
import { runMatch } from '@restomatch/matching';
import {
  appRouter,
  buildMatchInputForInvoice,
  buildRules,
  persistMatchRun,
  resolveApprovalThresholds,
  type AppContext,
} from '@restomatch/api';
import { processMatchInvoice, type MatchInvoiceJob } from '../jobs/matchInvoice';
import type { WorkerJob } from '../queue';

/**
 * The seam for S3: the job's first step after its prior-run read is
 * buildMatchInputForInvoice. Wrapping that export (the same vi.mock pattern the
 * OCR job tests use for meterOcrScan) lets a test commit a concurrent
 * match.runForInvoice exactly between the job's read and its persist — no
 * production hook. match.runForInvoice itself imports the assembler relatively,
 * so only the worker job goes through the wrapper.
 */
const h = vi.hoisted(() => ({ afterPriorRead: null as null | (() => Promise<void>) }));
vi.mock('@restomatch/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/api')>();
  return {
    ...real,
    buildMatchInputForInvoice: async (...args: Parameters<typeof real.buildMatchInputForInvoice>) => {
      const hook = h.afterPriorRead;
      h.afterPriorRead = null; // one shot
      if (hook) await hook();
      return real.buildMatchInputForInvoice(...args);
    },
  };
});

/**
 * Hotfix: the match-invoice job reads the invoice's prior run BEFORE its persist
 * transaction. If match.runForInvoice (a manager's Re-run) commits a run in
 * between, the job used to persist a SECOND run (match_runs has no unique key on
 * invoice_id): the leak hero doubled, the approvals queue showed every finding
 * twice and the owner was notified for the duplicate. The persist step now
 * takes the invoice row lock in its own statement, re-reads has_run on a fresh
 * snapshot, and skips ('already_matched') when a run appeared meanwhile.
 *
 * Driven through processMatchInvoice — the production entry point that sends
 * the notifications — so "no notification for the skipped job" is asserted on
 * the real outbox.
 */
const db = createDb(testDbUrl());
let restaurantId = '';
let userId = '';
let supplierId = '';
let poId = '';
let invoiceId = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
  for (const i of await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId)))
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, i.id));
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  for (const g of await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId)))
    await db.delete(grLines).where(eq(grLines.grId, g.id));
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  for (const p of await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId)))
    await db.delete(poLines).where(eq(poLines.poId, p.id));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId));
  await db.delete(products).where(eq(products.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  await db.delete(memberships).where(eq(memberships.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId)); // outbox + activity cascade
  if (userId) await db.delete(users).where(eq(users.id, userId));
  restaurantId = '';
  userId = '';
}

const savedDatabaseUrl = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = testDbUrl(); // processMatchInvoice opens its own pool on it
});

/**
 * A scanned invoice the OCR job just released ('matched', no run yet) for an
 * order whose receipt is counted and closed: 10 × ₪132 billed vs ₪125 ordered →
 * one PRICE_HIGHER of ₪70.00 that needs a manager (so a persisted run notifies).
 */
beforeEach(async () => {
  await cleanup();
  h.afterPriorRead = null;
  const [r] = await db.insert(restaurants).values({ name: 'Match-run race test', vatRate: '0.18' }).returning();
  restaurantId = r!.id;
  const [u] = await db
    .insert(users)
    .values({ email: `race-${restaurantId.slice(0, 8)}@test.local`, name: 'Owner', emailVerified: new Date() })
    .returning();
  userId = u!.id;
  await db.insert(memberships).values({ userId, restaurantId, role: 'owner' });
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ספק שמן', vatRate: '0.18' }).returning();
  supplierId = s!.id;
  const [p] = await db
    .insert(products)
    .values({ restaurantId, canonicalName: 'שמן זית', category: 'שמנים', defaultUnit: 'ליטר' })
    .returning();
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
    .returning();
  poId = po!.id;
  const [pl] = await db
    .insert(poLines)
    .values({ poId, productId: p!.id, rawDescription: 'שמן זית 1 ליטר', qtyOrdered: '10', unit: 'ליטר', unitPriceExpected: '125' })
    .returning();
  const [gr] = await db
    .insert(goodsReceipts)
    .values({ restaurantId, poId, receivedBy: userId, status: 'completed' })
    .returning();
  await db.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId: p!.id, qtyReceived: '10' });
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId,
      supplierId,
      status: 'matched',
      source: 'photo',
      rawImageUrl: 'https://example.com/scans/race.jpg',
      totalExclVat: '1320.00',
      vatAmount: '237.60',
      totalInclVat: '1557.60',
      ocrPayload: { provider: 'claude_vision', raw: { scanGrId: gr!.id } },
    })
    .returning();
  invoiceId = inv!.id;
  await db.insert(invoiceLines).values({
    invoiceId,
    productId: p!.id,
    rawDescription: 'שמן זית 1 ליטר',
    qtyBilled: '10',
    unit: 'ליטר',
    unitPriceBilled: '132',
    lineTotal: '1320.00',
  });
});

afterAll(async () => {
  await cleanup();
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
});

const owner = () => appRouter.createCaller({ db, session: { userId, restaurantId, role: 'owner' } } as unknown as AppContext);

/** The job as the OCR job enqueues it (plain) or as receiving.submitReceipt does (rematch + the counted PO). */
const plainJob = (): WorkerJob<MatchInvoiceJob> => ({ data: { restaurantId, invoiceId } }) as WorkerJob<MatchInvoiceJob>;
const receiptJob = (): WorkerJob<MatchInvoiceJob> =>
  ({ data: { restaurantId, invoiceId, rematch: true, poId } }) as WorkerJob<MatchInvoiceJob>;

/** Runs the job, returning the skip it logged ("nothing to do (<skip>)"), or null when it persisted. */
async function runJob(job: WorkerJob<MatchInvoiceJob>): Promise<string | null> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
  try {
    await processMatchInvoice(job);
  } finally {
    spy.mockRestore();
  }
  const skip = logs.map((l) => /nothing to do \((\w+)\)/.exec(l)?.[1]).find(Boolean);
  return skip ?? null;
}

async function runsOfInvoice() {
  return db
    .select({ id: matchRuns.id })
    .from(matchRuns)
    .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
}
async function notificationCount() {
  const rows = await db.select({ id: notificationsOutbox.id }).from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
  return rows.length;
}
async function matchedFeedCount() {
  const rows = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(and(eq(activityEvents.restaurantId, restaurantId), eq(activityEvents.eventType, 'invoice_matched')));
  return rows.length;
}
async function findingsOfInvoice() {
  return db
    .select({ type: discrepancies.type, delta: discrepancies.deltaAmount })
    .from(discrepancies)
    .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
    .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
}

/** Everything a duplicate run would show: runs, approval-queue findings, outbox rows, feed rows. */
async function observe(skip: string | null) {
  return {
    skip,
    runIds: (await runsOfInvoice()).map((r) => r.id),
    findings: await findingsOfInvoice(),
    notifications: await notificationCount(),
    feedRows: await matchedFeedCount(),
  };
}

/** Until some backend of this database is blocked BY the holder (pg_blocking_pids) — no sleep, no unrelated waits. */
async function waitForBlockedBy(holderPid: number, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const rows = (await db.execute(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and ${holderPid}::int = any(pg_blocking_pids(pid))`,
    )) as unknown as Array<{ n: number }>;
    if (rows[0]!.n > 0) return;
    if (Date.now() > until) throw new Error(`nothing waited on backend ${holderPid}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('control: with no concurrent run the job persists ONE run and notifies', () => {
  it('first match → 1 run, PRICE_HIGHER ₪70, an owner notification and one feed row', async () => {
    expect(await runJob(plainJob())).toBeNull();
    expect(await runsOfInvoice()).toHaveLength(1);
    expect(await findingsOfInvoice()).toEqual([{ type: 'PRICE_HIGHER', delta: '70.00' }]);
    expect(await notificationCount()).toBeGreaterThan(0); // so the "0" below is meaningful
    expect(await matchedFeedCount()).toBe(1);
  });
});

describe('hotfix: match-invoice never persists a second run when match.runForInvoice committed concurrently', () => {
  it('S3: runForInvoice commits after the job read "no prior run" → the job skips (already_matched), one run, no notification', async () => {
    let rerun: Awaited<ReturnType<ReturnType<typeof owner>['match']['runForInvoice']>> | undefined;
    h.afterPriorRead = async () => {
      rerun = await owner().match.runForInvoice({ invoiceId }); // its own member tx: committed on return
    };

    const skip = await runJob(plainJob());

    expect(rerun?.matchRunId).toBeTruthy(); // the hook really ran between the read and the persist
    expect(await observe(skip)).toEqual({
      skip: 'already_matched',
      runIds: [rerun!.matchRunId], // ONE run: the manager's stands
      findings: [{ type: 'PRICE_HIGHER', delta: '70.00' }], // ₪70 once in approvals — not twice
      notifications: 0, // runForInvoice never notifies; the skipped job must not either
      feedRows: 1, // only the manager's run in the feed
    });
  });

  it('S1: the job waits on the invoice row lock while another tx inserts a run, then commits → skip, one run, no notification', async () => {
    const other = createDb(testDbUrl()); // a runForInvoice-equivalent writer on its own connection
    let job: Promise<string | null> | undefined;
    let concurrentRunId = '';
    await other.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      const holder = ((await tx.execute(sql`select pg_backend_pid()::int as pid`)) as unknown as Array<{ pid: number }>)[0]!.pid;
      // match.runForInvoice's lock: FOR NO KEY UPDATE on the invoice row.
      await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
        .for('no key update');
      job = runJob(receiptJob());
      await waitForBlockedBy(holder); // the job read "no prior run", built, and now waits in its persist step
      // …and, under that lock, the same write runForInvoice makes: one run for the invoice.
      const built = await buildMatchInputForInvoice(tx, restaurantId, invoiceId, { pinnedPoId: poId, strictPin: true });
      const persisted = await persistMatchRun(
        tx,
        { restaurantId, invoiceId, poId: built!.poId, grId: built!.grId },
        built!.input,
        runMatch(built!.input),
        buildRules(resolveApprovalThresholds(undefined)),
      );
      concurrentRunId = persisted.matchRunId;
    });
    const skip = await job!;

    expect(await observe(skip)).toEqual({
      skip: 'already_matched',
      runIds: [concurrentRunId],
      findings: [{ type: 'PRICE_HIGHER', delta: '70.00' }],
      notifications: 0,
      feedRows: 1,
    });
  });
});
