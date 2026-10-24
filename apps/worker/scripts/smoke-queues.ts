/**
 * Worker runtime smoke test (local only): proves a RUNNING worker consumes the
 * OCR → match chain end-to-end against local Postgres (the job queue, 0061)
 * with stub OCR. No Redis.
 *
 *   1. start the worker:   DATABASE_URL=… pnpm --filter @restomatch/worker start
 *   2. in another shell:   DATABASE_URL=… pnpm --filter @restomatch/worker exec tsx scripts/smoke-queues.ts
 *
 * It clones one already-matched demo invoice (same restaurant + supplier) into a
 * fresh `ocr_pending` invoice, enqueues an `ocr-invoice` job whose mockProviders
 * replay the original lines, then waits for the worker to finish OCR and for the
 * chained `match-invoice` job to write a match_run. Exit 0 = both queues work.
 * The cloned invoice + its match_run are deleted afterwards (SMOKE_KEEP=1 keeps them).
 *
 * Refuses to run against anything but localhost — it inserts rows.
 */
import { and, createDb, desc, eq, invoiceLines, invoices, matchRuns } from '@restomatch/db';
import { getJob, insertJob, OCR_INVOICE_QUEUE, queueSql } from '@restomatch/queue';
import type { InvoiceOcrResult, OcrInvoiceJob } from '@restomatch/types';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000);

function assertLocal(url: string, name: string): void {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`[smoke] ${name} must point at localhost (got ${url.replace(/:[^:@/]*@/, ':***@')})`);
  }
}

async function main(): Promise<void> {
  assertLocal(DATABASE_URL, 'DATABASE_URL');
  const db = createDb(DATABASE_URL);

  const [source] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.status, 'matched'))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  if (!source) throw new Error('[smoke] no matched invoice to clone — run scripts/dev-setup.sh (seeds demo data)');
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, source.id));

  const invoiceNumber = `SMOKE-${Date.now()}`;
  const ocr: InvoiceOcrResult = {
    supplier: {},
    invoiceNumber,
    invoiceDate: new Date().toISOString().slice(0, 10),
    lines: lines.map((l) => ({
      sku: l.supplierSku,
      rawDescription: l.rawDescription ?? 'פריט',
      qty: Number(l.qtyBilled),
      unit: l.unit,
      unitPrice: Number(l.unitPriceBilled),
      lineTotal: Number(l.lineTotal),
      confidence: 0.99,
    })),
    totals: {
      subtotal: source.totalExclVat ? Number(source.totalExclVat) : undefined,
      vat: source.vatAmount ? Number(source.vatAmount) : undefined,
      total: source.totalInclVat ? Number(source.totalInclVat) : undefined,
    },
    confidence: 0.99,
  };

  const [created] = await db
    .insert(invoices)
    .values({
      restaurantId: source.restaurantId,
      supplierId: source.supplierId,
      source: 'manual',
      status: 'ocr_pending',
      rawImageUrl: 'smoke://fixture',
    })
    .returning({ id: invoices.id });
  if (!created) throw new Error('[smoke] insert failed');
  console.log(`[smoke] cloned invoice ${source.id} → ${created.id} (${lines.length} lines)`);

  const sql = queueSql(DATABASE_URL);
  const payload: OcrInvoiceJob = {
    restaurantId: source.restaurantId,
    invoiceId: created.id,
    supplierId: source.supplierId,
    imageUrl: 'smoke://fixture',
    mockProviders: { docAi: ocr, claude: ocr },
  };
  const job = await insertJob(sql, OCR_INVOICE_QUEUE, payload, { restaurantId: source.restaurantId });
  if (!job) throw new Error('[smoke] enqueue failed');
  const t0 = Date.now();
  let ocrResult: unknown = null;
  for (;;) {
    const row = await getJob(sql, job.id);
    if (row?.status === 'done') {
      ocrResult = row.result;
      break;
    }
    if (row?.status === 'failed') throw new Error(`[smoke] ocr-invoice failed: ${row.lastError}`);
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error(`[smoke] ocr-invoice not finished within ${TIMEOUT_MS}ms — is the worker running?`);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`[smoke] ocr-invoice done in ${Date.now() - t0}ms →`, ocrResult);

  // The match job is chained by the worker; poll for its match_run row.
  let run: { id: string; status: string } | undefined;
  while (!run && Date.now() - t0 < TIMEOUT_MS) {
    [run] = await db
      .select({ id: matchRuns.id, status: matchRuns.overallStatus })
      .from(matchRuns)
      .where(and(eq(matchRuns.invoiceId, created.id), eq(matchRuns.restaurantId, source.restaurantId)))
      .limit(1);
    if (!run) await new Promise((r) => setTimeout(r, 500));
  }
  if (!run) {
    throw new Error(
      `[smoke] no match_run for ${created.id} within ${TIMEOUT_MS}ms — is the worker running? ` +
        `(needsHumanReview=${String((ocrResult as { needsHumanReview?: boolean })?.needsHumanReview)})`,
    );
  }
  console.log(`[smoke] match-invoice done in ${Date.now() - t0}ms → match_run ${run.id} status=${run.status}`);
  console.log('[smoke] OK — OCR and match queues are consumed by the running worker');

  // Leave the demo dataset as we found it (match_runs → discrepancies cascade).
  if (process.env.SMOKE_KEEP !== '1') {
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, created.id));
    await db.delete(invoices).where(eq(invoices.id, created.id));
    console.log(`[smoke] cleaned up ${created.id} (SMOKE_KEEP=1 to keep it)`);
  }

  await sql.end({ timeout: 5 });
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
