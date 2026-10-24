/**
 * Worker runtime smoke — EVERY queue once, against a running worker (local QA).
 *
 *   1. DB: a disposable, seeded database (restomatch_e2e after a Playwright run,
 *      or any *_test / *_e2e / *_smoke DB). The script writes rows.
 *   2. Worker (with the local email sink so outbox email is observable):
 *        EMAIL_SINK_FILE=/tmp/sink.jsonl RESEND_API_KEY=re_local EMAIL_FROM=qa@example.invalid \
 *        NODE_OPTIONS="--import ./scripts/local-email-sink.mjs" \
 *        DATABASE_URL=…/restomatch_e2e pnpm --filter @restomatch/worker start
 *   3. DATABASE_URL=…/restomatch_e2e EMAIL_SINK_FILE=/tmp/sink.jsonl \
 *        pnpm --filter @restomatch/worker exec tsx scripts/smoke-all-jobs.ts
 *
 * Covers the 7 scheduled jobs (enqueued by hand with the scheduler's payload),
 * the OCR(stub) → match chain, a small catalog import, the outbox email path
 * (queued row → Resend call captured by the sink → row 'sent'), and
 * sync-platforms without credentials (must FAIL CLEANLY, not hang). Exit 0 when
 * every step matches its expectation. Jobs go through the Postgres job_queue
 * (0061) exactly as producers enqueue them; the script polls each row.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  and,
  catalogImports,
  createDb,
  desc,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  notificationsOutbox,
  restaurants,
  suppliers,
} from '@restomatch/db';
import type { InvoiceOcrResult } from '@restomatch/types';
import { getJob, insertJob, queueSql } from '@restomatch/queue';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const SINK = process.env.EMAIL_SINK_FILE;
const TIMEOUT_MS = 60_000;

const db = new URL(DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(db.hostname) || !/_(e2e|test|smoke)$/.test(db.pathname)) {
  throw new Error(`[smoke-all] needs a local *_e2e/*_test/*_smoke DATABASE_URL (got ${db.hostname}${db.pathname})`);
}

type Outcome = { step: string; ok: boolean; detail: string; ms: number };
const outcomes: Outcome[] = [];
const sql = queueSql(DATABASE_URL);

/** Enqueue (as a producer would) and wait for the running worker to finish it. */
async function waitForJob(queue: string, data: unknown): Promise<{ status: string; result: unknown; error: string | null }> {
  const inserted = await insertJob(sql, queue, data, { maxAttempts: 1 });
  if (!inserted) throw new Error(`[smoke-all] could not enqueue ${queue}`);
  const t0 = Date.now();
  for (;;) {
    const job = await getJob(sql, inserted.id);
    if (job && (job.status === 'done' || job.status === 'failed')) return { status: job.status, result: job.result, error: job.lastError };
    if (Date.now() - t0 > TIMEOUT_MS) return { status: 'timeout', result: null, error: `not finished after ${TIMEOUT_MS}ms` };
    await new Promise((res) => setTimeout(res, 200));
  }
}

async function runJob(queue: string, data: unknown, expect: 'completed' | 'failed' = 'completed') {
  const t0 = Date.now();
  const r = await waitForJob(queue, data);
  const ok = expect === 'completed' ? r.status === 'done' : r.status === 'failed';
  const detail = r.status === 'done' ? (JSON.stringify(r.result)?.slice(0, 160) ?? 'null') : `${r.status}: ${(r.error ?? '').slice(0, 160)}`;
  outcomes.push({ step: `${queue}${expect === 'failed' ? ' (expected clean failure)' : ''}`, ok, detail, ms: Date.now() - t0 });
}

async function main() {
  const d = createDb(DATABASE_URL);
  const [r] = await d.select({ id: restaurants.id }).from(restaurants).limit(1);
  if (!r) throw new Error('[smoke-all] no restaurant — seed the DB first');

  // 1) Scheduled jobs, exactly as the schedulers enqueue them.
  for (const q of ['daily-expectations', 'baselines', 'order-reminders', 'supplier-delays', 'end-of-day-report', 'retention', 'health-digest', 'ocr-sweep']) {
    await runJob(q, {});
  }

  // 2) Outbox: a queued email row must reach the provider (sink) and flip to 'sent'.
  const before = SINK && existsSync(SINK) ? readFileSync(SINK, 'utf8').split('\n').filter(Boolean).length : 0;
  const [row] = await d
    .insert(notificationsOutbox)
    .values({ restaurantId: r.id, channel: 'email', target: 'qa-sink@example.invalid', subject: 'QA outbox', body: 'outbox smoke' })
    .returning({ id: notificationsOutbox.id });
  await runJob('outbox-dispatch', {});
  const [after] = await d.select({ status: notificationsOutbox.status, err: notificationsOutbox.lastError }).from(notificationsOutbox).where(eq(notificationsOutbox.id, row!.id));
  const sunk = SINK && existsSync(SINK) ? readFileSync(SINK, 'utf8').split('\n').filter(Boolean).slice(before) : [];
  const delivered = sunk.some((l) => (JSON.parse(l) as { to?: string }).to === 'qa-sink@example.invalid');
  outcomes.push({ step: 'outbox email → sink → sent', ok: after?.status === 'sent' && delivered, detail: `status=${after?.status} sink=${delivered} ${after?.err ?? ''}`, ms: 0 });

  // 3) OCR (stub providers) → chained match-invoice → match_run.
  const [src] = await d.select().from(invoices).where(eq(invoices.status, 'matched')).orderBy(desc(invoices.createdAt)).limit(1);
  if (src) {
    const lines = await d.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, src.id));
    const ocr: InvoiceOcrResult = {
      supplier: {},
      invoiceNumber: `SMOKE-ALL-${Date.now()}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      lines: lines.map((l) => ({ sku: l.supplierSku, rawDescription: l.rawDescription ?? 'item', qty: Number(l.qtyBilled), unit: l.unit, unitPrice: Number(l.unitPriceBilled), lineTotal: Number(l.lineTotal), confidence: 0.99 })),
      totals: { subtotal: Number(src.totalExclVat ?? 0), vat: Number(src.vatAmount ?? 0), total: Number(src.totalInclVat ?? 0) },
      confidence: 0.99,
    };
    const [inv] = await d.insert(invoices).values({ restaurantId: src.restaurantId, supplierId: src.supplierId, source: 'manual', status: 'ocr_pending', rawImageUrl: 'smoke://all' }).returning({ id: invoices.id });
    await runJob('ocr-invoice', { restaurantId: src.restaurantId, invoiceId: inv!.id, supplierId: src.supplierId, imageUrl: 'smoke://all', mockProviders: { docAi: ocr, claude: ocr } });
    const t0 = Date.now();
    let run: { status: string } | undefined;
    while (!run && Date.now() - t0 < TIMEOUT_MS) {
      [run] = await d.select({ status: matchRuns.overallStatus }).from(matchRuns).where(and(eq(matchRuns.invoiceId, inv!.id), eq(matchRuns.restaurantId, src.restaurantId))).limit(1);
      if (!run) await new Promise((res) => setTimeout(res, 500));
    }
    outcomes.push({ step: 'ocr-invoice → match-invoice chain', ok: !!run, detail: `match_run status=${run?.status ?? 'none'}`, ms: Date.now() - t0 });
  } else {
    outcomes.push({ step: 'ocr-invoice → match-invoice chain', ok: false, detail: 'no matched invoice in seed', ms: 0 });
  }

  // 4) import-catalog: a 2-row CSV for the first supplier.
  const [sup] = await d.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.restaurantId, r.id)).limit(1);
  const mapping = { sku: 'sku', name: 'name', unit: 'unit', price: 'price' };
  const [imp] = await d.insert(catalogImports).values({ restaurantId: r.id, supplierId: sup!.id, filename: 'smoke.csv', status: 'pending', rowCount: 2, columnMapping: mapping }).returning({ id: catalogImports.id });
  await runJob('import-catalog', { restaurantId: r.id, supplierId: sup!.id, importId: imp!.id, file: { filename: 'smoke.csv', text: 'sku,name,unit,price\nSMK-1,QA tomato,kg,9.90\nSMK-2,QA onion,kg,4.50\n' }, mapping });
  const [impAfter] = await d.select({ status: catalogImports.status, created: catalogImports.createdItems, err: catalogImports.error }).from(catalogImports).where(eq(catalogImports.id, imp!.id));
  outcomes.push({ step: 'import-catalog row state', ok: impAfter?.status === 'committed', detail: JSON.stringify(impAfter), ms: 0 });

  // 4b) A late duplicate of the same import (timed-out producer, QA D7) must be a no-op.
  const dup = await waitForJob('import-catalog', { restaurantId: r.id, supplierId: sup!.id, importId: imp!.id, file: { filename: 'smoke.csv', text: 'sku,name,unit,price\nSMK-1,QA tomato,kg,9.90\n' }, mapping });
  const dupRes = dup.result as { skipped?: string } | null;
  outcomes.push({ step: 'import-catalog duplicate is skipped', ok: dup.status === 'done' && dupRes?.skipped === 'already committed', detail: JSON.stringify(dup), ms: 0 });

  // 5) sync-platforms without credentials must fail cleanly (no hang, no crash).
  await runJob('sync-platforms', { restaurantId: r.id, platform: 'marketman' }, 'failed');

  for (const o of outcomes) console.log(`${o.ok ? 'PASS' : 'FAIL'}  ${o.step.padEnd(48)} ${String(o.ms).padStart(6)}ms  ${o.detail}`);
  const failed = outcomes.filter((o) => !o.ok).length;
  console.log(failed ? `[smoke-all] ${failed} step(s) failed` : '[smoke-all] OK — every queue processed by the running worker');
  await sql.end({ timeout: 5 });
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
