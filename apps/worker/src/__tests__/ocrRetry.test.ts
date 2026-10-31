import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, invoiceLines, invoices, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { insertJob, queueSql, recoverStalled, MAX_STALLED, TERMINAL_JOB_ERROR } from '@restomatch/queue';
import type { InvoiceOcrResult } from '@restomatch/types';

/**
 * OCR-A / PR-OCR-3: headroom, retries, error classes, stall recovery. The
 * Claude provider and the meter are spies — no real Anthropic call.
 */
const h = vi.hoisted(() => ({
  calls: 0,
  /** What each successive extract() does: an Error to throw, else the result. */
  script: [] as unknown[],
  meter: vi.fn(async () => ({ metered: true, used: 1, limit: null })),
}));

vi.mock('@restomatch/ocr', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/ocr')>();
  class FakeClaudeVision {
    readonly id = 'claude_vision' as const;
    async extract() {
      const step = h.script[h.calls++];
      if (step instanceof Error) throw step;
      return step as InvoiceOcrResult;
    }
  }
  return { ...real, ClaudeVision: FakeClaudeVision };
});
vi.mock('@restomatch/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/api')>();
  return { ...real, meterOcrScan: h.meter };
});

const { classifyOcrError, OcrDeadlineError, withOcrDeadline } = await import('../jobs/ocrInvoice');
const { NOT_FOUND_REFUSAL } = await import('../jobs/ocrSweep');
const { runQueuedJobs } = await import('../serverless');

const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const SCAN_PREFIX = 'https://scans.test/storage/v1/object/sign/invoice-scans/';
const apiError = (status: number, message = `${status} error`) => Object.assign(new Error(message), { name: 'APIError', status });

const extraction: InvoiceOcrResult = {
  supplier: { name: 'ספק' },
  invoiceNumber: 'R-1',
  invoiceDate: '2026-10-30',
  allocationNumber: null,
  lines: [{ rawDescription: 'גזר', qty: 1, unit: 'kg', unitPrice: 5, lineTotal: 5, vatRate: 0.18, confidence: 0.99 }],
  totals: { subtotal: 5, vat: 0.9, total: 5.9 },
  confidence: 0.99,
};

describe('classifyOcrError', () => {
  it.each([
    ['429', apiError(429), true],
    ['500', apiError(500), true],
    ['529 overloaded', apiError(529, 'Overloaded'), true],
    ['scan fetch 503', new Error('Anthropic: failed to fetch document (503) from https://…'), true],
    ['timeout', new Error('Anthropic: fetching the document timed out after 20000ms (https://…)'), true],
    ['SDK timeout', Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }), true],
    ['dropped connection', Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }), true],
    ['parse: no JSON', new Error('Anthropic: no JSON object found in response: sorry'), true],
    ['parse: schema', Object.assign(new Error('invalid'), { name: 'ZodError' }), true],
  ])('%s → retryable', (_l, err, retryable) => {
    expect(classifyOcrError(err).retryable).toBe(retryable);
  });

  it('the per-job deadline (review #10): a read that outlives it rejects with a RETRYABLE timeout', async () => {
    const never = new Promise<never>(() => {});
    await expect(withOcrDeadline(never, 20)).rejects.toBeInstanceOf(OcrDeadlineError);
    expect(classifyOcrError(new OcrDeadlineError(20)).retryable).toBe(true);
    await expect(withOcrDeadline(Promise.resolve(7), 1_000)).resolves.toBe(7);
  });

  it.each([
    ['quota', Object.assign(new Error('over cap'), { name: 'QuotaExceededError' }), 'quota_exceeded'],
    ['Anthropic 400 on the document', apiError(400, 'Could not process image'), 'unsupported_format'],
    ['expired signed URL (403)', new Error('Anthropic: failed to fetch document (403) from https://…'), 'unsupported_format'],
    ['unknown → spend-safe terminal', new Error('something odd'), 'extraction_failed'],
  ])('%s → terminal (%s)', (_l, err, reason) => {
    expect(classifyOcrError(err)).toEqual({ retryable: false, reason });
  });
});

describe('ocr-invoice through the serverless runner (Postgres queue)', () => {
  const saved = { ...process.env };
  let rid = '';
  let supplierId = '';

  async function queued(opts: { restaurantId?: string } = {}) {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: rid, supplierId, status: 'ocr_pending', source: 'photo', rawImageUrl: `${SCAN_PREFIX}${rid}/a.jpg?token=t` })
      .returning();
    const restaurantId = opts.restaurantId ?? rid;
    const job = await insertJob(
      qsql,
      'ocr-invoice',
      { restaurantId, invoiceId: inv!.id, supplierId: null, imageUrl: 'ignored' },
      { restaurantId, maxAttempts: 2 },
    );
    return { invoiceId: inv!.id, jobId: job!.id };
  }
  const jobRow = async (id: string) =>
    (await qsql<Array<{ status: string; attempts: number; last_error: string | null }>>`
      SELECT status, attempts, last_error FROM job_queue WHERE id = ${id}`)[0]!;
  const invoice = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
  const run = (o: { ocrHeadroomMs?: number; budgetMs?: number; endsAt?: number } = {}) =>
    runQueuedJobs({ budgetMs: o.budgetMs ?? 20_000, queues: ['ocr-invoice'], ocrHeadroomMs: o.ocrHeadroomMs ?? 0, sql: qsql, ...(o.endsAt ? { endsAt: o.endsAt } : {}) });

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.DATABASE_URL = testDbUrl();
    process.env.INVOICE_SCAN_URL_PREFIX = SCAN_PREFIX;
    h.calls = 0;
    h.script = [];
    h.meter.mockClear();
    const [r] = await db.insert(restaurants).values({ name: 'OCR retry QA' }).returning();
    rid = r!.id;
    const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ספק' }).returning();
    supplierId = s!.id;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.OCR_REAL_RESTAURANT_IDS = rid;
    await qsql`DELETE FROM job_queue WHERE queue = 'ocr-invoice'`;
  });
  afterEach(async () => {
    await qsql`DELETE FROM job_queue WHERE queue IN ('ocr-invoice', 'match-invoice')`;
    await db.delete(restaurants).where(eq(restaurants.id, rid));
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('a transient failure is retried once — metered once; the retry reads the scan', async () => {
    h.script = [apiError(529, 'Overloaded'), extraction];
    const { invoiceId, jobId } = await queued();
    expect(await run()).toMatchObject({ ran: 1, retried: 1 });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'ocr_pending' }); // not failed yet
    await qsql`UPDATE job_queue SET run_at = now() WHERE id = ${jobId}`;
    expect(await run()).toMatchObject({ ran: 1, done: 1 });
    expect(h.calls).toBe(2);
    expect(h.meter).toHaveBeenCalledTimes(1);
    expect((await invoice(invoiceId)).invoiceNumber).toBe('R-1');
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId))).toHaveLength(1);
  });

  it('two transient failures: dead-lettered after attempt 2 and the invoice is marked OCR-failed', async () => {
    h.script = [apiError(429), new Error('Anthropic: no JSON object found in response: …')];
    const { invoiceId, jobId } = await queued();
    await run();
    await qsql`UPDATE job_queue SET run_at = now() WHERE id = ${jobId}`;
    expect(await run()).toMatchObject({ ran: 1, failed: 1 });
    expect(await jobRow(jobId)).toMatchObject({ status: 'failed', attempts: 2 });
    expect(h.meter).toHaveBeenCalledTimes(1);
    expect((await invoice(invoiceId)).ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'extraction_failed' });
  });

  it('a terminal failure is final at attempt 1: no second paid call', async () => {
    h.script = [apiError(400, 'Could not process image'), extraction];
    const { invoiceId, jobId } = await queued();
    expect(await run()).toMatchObject({ ran: 1, failed: 1, retried: 0 });
    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row.last_error!.startsWith(TERMINAL_JOB_ERROR)).toBe(true);
    expect(h.calls).toBe(1);
    expect((await invoice(invoiceId)).ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'unsupported_format' });
  });

  it('quota exceeded is terminal: no read, no retry', async () => {
    h.meter.mockImplementationOnce(async () => {
      throw Object.assign(new Error('monthly OCR cap reached'), { name: 'QuotaExceededError' });
    });
    const { invoiceId, jobId } = await queued();
    expect(await run()).toMatchObject({ failed: 1, retried: 0 });
    expect(await jobRow(jobId)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(h.calls).toBe(0);
    expect((await invoice(invoiceId)).ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'quota_exceeded' });
  });

  it("the tenant guard is terminal, and the sweep still recognises its refusal", async () => {
    const [other] = await db.insert(restaurants).values({ name: 'OCR retry other' }).returning();
    try {
      process.env.OCR_REAL_RESTAURANT_IDS = `${rid},${other!.id}`;
      const { jobId } = await queued({ restaurantId: other!.id });
      expect(await run()).toMatchObject({ failed: 1, retried: 0 });
      const row = await jobRow(jobId);
      expect(row).toMatchObject({ status: 'failed', attempts: 1 });
      expect(row.last_error!.startsWith(TERMINAL_JOB_ERROR)).toBe(true);
      expect(NOT_FOUND_REFUSAL.test(row.last_error!)).toBe(true);
      expect(h.meter).not.toHaveBeenCalled();
    } finally {
      await qsql`DELETE FROM job_queue WHERE restaurant_id = ${other!.id}`;
      await db.delete(restaurants).where(eq(restaurants.id, other!.id));
    }
  }, 30_000);

  it('headroom: with less than OCR_JOB_HEADROOM_MS left, an OCR job is not claimed (it waits for the next run)', async () => {
    h.script = [extraction];
    const { jobId } = await queued();
    expect(await run({ budgetMs: 10_000, ocrHeadroomMs: 120_000 })).toMatchObject({ ran: 0, stoppedBy: 'budget' });
    expect(await jobRow(jobId)).toMatchObject({ status: 'queued', attempts: 0 });
    // The kick passes the invocation's real end (endsAt): with 200 s left the read fits.
    expect(await run({ budgetMs: 10_000, ocrHeadroomMs: 120_000, endsAt: Date.now() + 200_000 })).toMatchObject({ ran: 1, done: 1 });
  });

  it('headroom gates only OCR: other queues in the same run are still claimed', async () => {
    const { JOB_HANDLERS } = await import('../handlers');
    const handlers = JOB_HANDLERS as Record<string, unknown>;
    const Q = 'ocr-headroom-other';
    handlers[Q] = async () => ({ ok: true });
    try {
      await queued();
      await insertJob(qsql, Q, {});
      const r = await runQueuedJobs({ budgetMs: 10_000, queues: ['ocr-invoice', Q], ocrHeadroomMs: 120_000, sql: qsql });
      expect(r.byQueue).toEqual({ [Q]: 1 });
    } finally {
      delete handlers[Q];
      await qsql`DELETE FROM job_queue WHERE queue = ${Q}`;
    }
  });

  it('stall recovery that dead-letters an OCR job marks its invoice OCR-failed (only that tenant, only while pending)', async () => {
    const { invoiceId, jobId } = await queued();
    await qsql`UPDATE job_queue SET status = 'active', locked_by = 'dead-runner', locked_at = now() - interval '10 minutes',
                 stalled_count = ${MAX_STALLED}, attempts = 1 WHERE id = ${jobId}`;
    // A second, already-read invoice whose (stale) job also dies: left alone.
    const done = await queued();
    await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, done.invoiceId));
    await qsql`UPDATE job_queue SET status = 'active', locked_by = 'dead-runner', locked_at = now() - interval '10 minutes',
                 stalled_count = ${MAX_STALLED}, attempts = 1 WHERE id = ${done.jobId}`;
    const res = await recoverStalled(qsql, 2 * 60_000);
    expect(res.failed).toBeGreaterThanOrEqual(2);
    expect(await jobRow(jobId)).toMatchObject({ status: 'failed' });
    const inv = await invoice(invoiceId);
    expect(inv.status).toBe('parsed');
    expect(Number(inv.ocrConfidence)).toBe(0);
    expect(inv.ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'stalled' });
    expect((await invoice(done.invoiceId)).status).toBe('matched');
  });

  it('a stalled OCR job that is only re-queued leaves its invoice pending', async () => {
    const { invoiceId, jobId } = await queued();
    await qsql`UPDATE job_queue SET status = 'active', locked_by = 'dead-runner', locked_at = now() - interval '10 minutes',
                 stalled_count = 0, attempts = 1 WHERE id = ${jobId}`;
    await recoverStalled(qsql, 2 * 60_000);
    expect(await jobRow(jobId)).toMatchObject({ status: 'queued' });
    expect((await invoice(invoiceId)).status).toBe('ocr_pending');
  });
});
