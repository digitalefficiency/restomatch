import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  and,
  asc,
  createDb,
  desc,
  eq,
  goodsReceipts,
  grLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '@restomatch/api';
import { computeLeakHero } from '@restomatch/charts';
import { queueSql } from '@restomatch/queue';
import { startJobListener, workerSql } from '../queue';
import { startMatchInvoiceWorker } from '../jobs/matchInvoice';
import { startOcrInvoiceWorker } from '../jobs/ocrInvoice';
import { runOcrSweep } from '../jobs/ocrSweep';

/**
 * The OCR sweep (wave 1) × "hold the match until the receipt is counted" (#94),
 * end to end: real receiver tRPC calls → real job_queue rows → the real
 * ocr-invoice / match-invoice workers. Demo seed (DEMO_TODAY 2026-10-25).
 *
 * The receipt link of a receiving scan lives ONLY in its ocr-invoice job
 * (payload.grId — invoices has no receipt column). A sweep retry that drops it
 * lets the OCR job auto-match blind: discovery prefers a same-supplier sibling
 * PO whose receipt is already completed (PO1, counted this morning), the run
 * lands on PO1/GR1 while the scan's own receipt (GR2) is still being counted,
 * and the later count + submit never repairs it (an invoice with a run on
 * another receipt is not "waiting" any more) — a false leak in the hero.
 */
const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let restaurantId = '';
let receiverId = '';
let hakerem = '';
type Closeable = { close: () => Promise<void> };
let ocrWorker: Closeable | null = null;
let matchWorker: Closeable | null = null;
let stopListen: () => Promise<void> = async () => {};

const caller = () =>
  appRouter.createCaller({ db, session: { userId: receiverId, restaurantId, role: 'receiver' } } as never);

/** A fresh HaKerem PO due `hoursAgo` ago, with the lines of the supplier's latest PO (× qtyFactor). */
async function freshPo(hoursAgo: number, qtyFactor = 1): Promise<string> {
  const [src] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), eq(purchaseOrders.supplierId, hakerem)))
    .orderBy(desc(purchaseOrders.expectedDeliveryAt))
    .limit(1);
  const lines = await db.select().from(poLines).where(eq(poLines.poId, src!.id)).orderBy(asc(poLines.id));
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId,
      supplierId: hakerem,
      expectedDeliveryAt: new Date(Date.now() - hoursAgo * 3600_000),
      status: 'sent',
      source: 'manual',
      notes: 'ocr-sweep × receipt test',
    })
    .returning();
  await db.insert(poLines).values(
    lines.map((l) => ({
      poId: po!.id,
      productId: l.productId,
      rawDescription: l.rawDescription,
      rawDescriptionEn: l.rawDescriptionEn,
      qtyOrdered: (Math.round(Number(l.qtyOrdered) * qtyFactor * 1000) / 1000).toString(),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected,
    })),
  );
  return po!.id;
}

async function drain(ms = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const [r] = await qsql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM job_queue
       WHERE restaurant_id = ${restaurantId} AND status IN ('queued', 'active') AND queue IN ('ocr-invoice', 'match-invoice')`;
    if (r!.n === 0) return;
    if (Date.now() - t0 > ms) throw new Error('queue did not drain');
    await new Promise((res) => setTimeout(res, 100));
  }
}

async function countAsOrdered(grId: string) {
  const rows = await db
    .select({ id: grLines.id, qty: poLines.qtyOrdered })
    .from(grLines)
    .innerJoin(poLines, eq(poLines.id, grLines.poLineId))
    .where(eq(grLines.grId, grId));
  for (const r of rows) await caller().receiving.markGrLine({ grLineId: r.id, qtyReceived: Number(r.qty) });
}

const runsOf = (invoiceId: string) =>
  db.select({ poId: matchRuns.poId, grId: matchRuns.grId }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
const grStatus = async (grId: string) =>
  (await db.select({ status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.id, grId)))[0]!.status;
const hero = async () => {
  const h = await computeLeakHero(db, restaurantId, { now: new Date() });
  return { leak: Math.round(h.leakIls * 100), caught: Math.round(h.caughtBeforePaymentIls * 100) };
};

/** PO1 counted + submitted 3 h ago (half the quantities), PO2 being counted now — same supplier, same day. */
async function siblings() {
  const po1 = await freshPo(3, 0.5);
  const gr1 = (await caller().receiving.startReceipt({ poId: po1 })).receiptId;
  await countAsOrdered(gr1);
  await caller().receiving.submitReceipt({ grId: gr1 });
  await drain();
  const po2 = await freshPo(0);
  const gr2 = (await caller().receiving.startReceipt({ poId: po2 })).receiptId;
  return { po1, gr1, po2, gr2 };
}

/** The receiver photographs the invoice on GR2 while no OCR consumer runs: the job stays queued. */
async function scanWithoutOcr(grId: string) {
  await ocrWorker?.close();
  ocrWorker = null;
  const res = await caller().receiving.registerInvoice({
    grId,
    supplierId: hakerem,
    imageUrl: `https://local.test/invoice-scans/${grId}-sweep.jpg`,
  });
  const [orig] = await qsql<Array<{ id: string; payload: Record<string, unknown> }>>`
    SELECT id::text, payload FROM job_queue WHERE queue = 'ocr-invoice' AND payload->>'invoiceId' = ${res.invoiceId}`;
  expect(orig!.payload.grId).toBe(grId);
  return { invoiceId: res.invoiceId, original: orig! };
}

/**
 * The sweep 12 minutes later. The retry gets the original job's dev-stub read as a
 * stand-in for the real Claude read (no API key in tests); grId stays exactly as
 * the sweep wrote it. Then the OCR consumer is back and the queue drains.
 */
async function sweepAndRead(invoiceId: string, mockProviders: unknown) {
  const swept = await runOcrSweep(qsql, new Date(Date.now() + 12 * 60_000));
  expect(swept.requeued).toEqual([invoiceId]);
  const [retry] = await qsql<Array<{ id: string; payload: Record<string, unknown> }>>`
    SELECT id::text, payload FROM job_queue WHERE dedupe_key = ${`ocr-sweep-${invoiceId}`}`;
  await qsql`UPDATE job_queue SET payload = payload || jsonb_build_object('mockProviders', ${qsql.json(mockProviders as never)}::jsonb)
              WHERE id = ${retry!.id}`;
  ocrWorker = startOcrInvoiceWorker();
  await drain();
  return retry!.payload;
}

beforeAll(async () => {
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
  await qsql`DELETE FROM job_queue`;
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  restaurantId = r!.id;
  const [m] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.restaurantId, restaurantId), eq(memberships.role, 'receiver')))
    .limit(1);
  receiverId = m!.userId;
  const [s] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.nameEn, 'HaKerem Butchery')))
    .limit(1);
  hakerem = s!.id;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ocrWorker = startOcrInvoiceWorker();
  matchWorker = startMatchInvoiceWorker();
  stopListen = await startJobListener(workerSql());
}, 300_000);

afterAll(async () => {
  await ocrWorker?.close();
  await matchWorker?.close();
  await stopListen();
  vi.restoreAllMocks();
  await db.execute(sql`TRUNCATE restaurants, users RESTART IDENTITY CASCADE`);
  await qsql`DELETE FROM job_queue`;
});

describe('OCR sweep retry of a receiving scan, with a same-day sibling PO', () => {
  it('commit-race refusal: the retry keeps the receipt — no run while GR2 is counted, then exactly 1 run on PO2/GR2', async () => {
    const { po2, gr2 } = await siblings();
    const { invoiceId, original } = await scanWithoutOcr(gr2);
    // The sweep's documented rescue case: the tenant guard refused the original job (commit race).
    await qsql`UPDATE job_queue SET status = 'failed', attempts = 1, finished_at = now(),
      last_error = ${`[ocr-invoice] invoice=${invoiceId} not found in restaurant=${restaurantId} — refusing to process`}
      WHERE id = ${original.id}`;
    const h0 = await hero();

    const retry = await sweepAndRead(invoiceId, original.payload.mockProviders);
    expect(retry.grId).toBe(gr2);
    expect(await grStatus(gr2)).toBe('pending');
    expect(await runsOf(invoiceId)).toEqual([]); // held: the count is not in
    expect(await hero()).toEqual(h0); // no false leak

    await countAsOrdered(gr2);
    await caller().receiving.submitReceipt({ grId: gr2, invoiceIds: [invoiceId] });
    await drain();
    expect(await runsOf(invoiceId)).toEqual([{ poId: po2, grId: gr2 }]);
  });

  it('lost enqueue (no original job on record): the retry has no receipt — still no run while GR2 is counted, then exactly 1 run on PO2/GR2', async () => {
    const { po2, gr2 } = await siblings();
    const { invoiceId, original } = await scanWithoutOcr(gr2);
    await qsql`DELETE FROM job_queue WHERE id = ${original.id}`; // EN-7: the enqueue never landed
    const h0 = await hero();

    const retry = await sweepAndRead(invoiceId, original.payload.mockProviders);
    expect(retry).not.toHaveProperty('grId'); // nothing to carry over
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv!.status).toBe('matched'); // read confidently…
    expect(await grStatus(gr2)).toBe('pending');
    expect(await runsOf(invoiceId)).toEqual([]); // …but held: HaKerem's receipt is still being counted
    expect(await hero()).toEqual(h0);

    // The wizard lost its ids (reload): the submit finds the waiting scan server-side.
    await countAsOrdered(gr2);
    await caller().receiving.submitReceipt({ grId: gr2 });
    await drain();
    expect(await runsOf(invoiceId)).toEqual([{ poId: po2, grId: gr2 }]);
  });
});
