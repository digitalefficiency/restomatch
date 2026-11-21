import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, invoiceLines, invoices, matchRuns, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';

/**
 * OCR-A / PR-OCR-2b review item 1: a consolidated invoice (חשבונית ריכוז) through
 * the REAL packages/ocr read path — ClaudeVision.extract → JSON parse →
 * InvoiceExtractionV2 → runOcrPipeline (documentKind / deliveryNotes / period
 * copied onto `reconciled`) → the worker's persistence. Only the Anthropic SDK's
 * messages.create and the scan download are faked: no network, no paid call.
 */
const h = vi.hoisted(() => {
  // packages/ocr imports the SDK lazily from ITS node_modules (the worker does
  // not depend on it), so mock that resolved file, not the bare specifier.
  const { createRequire: cr } = require('node:module') as typeof import('node:module');
  const { dirname: dn, join: jn } = require('node:path') as typeof import('node:path');
  const ocrPkg = jn(dn(__filename), '..', '..', '..', '..', 'packages', 'ocr', 'package.json');
  const cjs = cr(ocrPkg).resolve('@anthropic-ai/sdk');
  const state = {
    sdkPath: cjs,
    /** `import()` resolves the package's ESM entry (exports["."].default). */
    sdkEsmPath: cjs.replace(/index\.js$/, 'index.mjs'),
    answer: '' as string,
    stopReason: 'end_turn' as string,
    created: [] as Array<Record<string, unknown>>,
    /** The SDK client options (maxRetries) and each create()'s request options (signal). */
    clientOpts: [] as Array<Record<string, unknown>>,
    requestOpts: [] as Array<{ signal?: AbortSignal } | undefined>,
    /** When true, create() waits until its signal aborts, then rejects like the SDK. */
    hang: false,
  };
  const fakeSdk = () => ({
    default: class {
      constructor(opts: Record<string, unknown>) {
        state.clientOpts.push(opts);
      }
      messages = {
        create: async (req: Record<string, unknown>, ro?: { signal?: AbortSignal }) => {
          state.created.push(req);
          state.requestOpts.push(ro);
          if (state.hang) {
            await new Promise<void>((resolve) => ro?.signal?.addEventListener('abort', () => resolve()));
            throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
          }
          return {
            stop_reason: state.stopReason,
            usage: { input_tokens: 3000, output_tokens: 700 },
            content: [{ type: 'text', text: state.answer }],
          };
        },
      };
    },
  });
  return Object.assign(state, { fakeSdk });
});

vi.mock(h.sdkPath, () => h.fakeSdk());
vi.mock(h.sdkEsmPath, () => h.fakeSdk());
vi.mock('@restomatch/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/api')>();
  return { ...real, meterOcrScan: async () => ({ metered: true, used: 1, limit: null }) };
});

const { classifyOcrError, OcrDeadlineError, processOcrInvoice, withOcrDeadline } = await import('../jobs/ocrInvoice');
const { ClaudeVision, OcrExtractionError } = await import('@restomatch/ocr');

const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const SCAN_PREFIX = 'https://scans.test/storage/v1/object/sign/invoice-scans/';

/** What a real Claude answer for a consolidated invoice looks like (the v2 schema; illustrative values). */
const consolidatedAnswer = {
  documentKind: 'consolidated',
  supplier: { name: 'ירקות הגליל', businessId: null },
  invoiceNumber: 'R-2026-10',
  invoiceDate: '2026-10-31',
  allocationNumber: null,
  deliveryNotes: [{ number: 'ת.מ. 9001', date: '2026-10-05' }, { number: '9002' }, { number: '9001' }],
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  lines: [
    { rawDescription: 'עגבניות', qty: 10, unit: 'kg', unitPrice: 6, lineTotal: 60, vatRate: 0.18, confidence: 0.98 },
    { rawDescription: 'מלפפונים', qty: 5, unit: 'kg', unitPrice: 4, lineTotal: 20, vatRate: 0.18, confidence: 0.98 },
  ],
  totals: { subtotal: 80, vat: 14.4, total: 94.4, vatRate: 0.18 },
  confidence: 0.97,
};

describe('a real ClaudeVision read of a consolidated invoice (only messages.create mocked)', () => {
  const saved = { ...process.env };
  let rid = '';
  let supplierId = '';

  async function newInvoice() {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: rid,
        supplierId,
        status: 'ocr_pending',
        source: 'email',
        rawImageUrl: `${SCAN_PREFIX}${rid}/scan-abc123-def456.pdf?token=t`,
      })
      .returning();
    return inv!.id;
  }
  const run = (invoiceId: string) =>
    processOcrInvoice({ data: { restaurantId: rid, invoiceId, supplierId: null, imageUrl: 'ignored' } } as never);
  const row = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;

  beforeEach(async () => {
    process.env.DATABASE_URL = testDbUrl();
    process.env.INVOICE_SCAN_URL_PREFIX = SCAN_PREFIX;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    delete process.env.OCR_CLAUDE_MODEL;
    h.answer = JSON.stringify(consolidatedAnswer);
    h.stopReason = 'end_turn';
    h.created.length = 0;
    h.clientOpts.length = 0;
    h.requestOpts.length = 0;
    h.hang = false;
    // The worker fetches the private scan itself (fetchBytes): a tiny PDF.
    // Anything else (the real SDK, were the mock not applied) fails loudly.
    vi.stubGlobal('fetch', async (url: unknown) => {
      if (!String(url).startsWith(SCAN_PREFIX)) throw new Error(`unexpected fetch in a no-network test: ${String(url).slice(0, 40)}`);
      return new Response(Buffer.from('%PDF-1.4 test'), { status: 200 });
    });
    const [r] = await db
      .insert(restaurants)
      .values({ name: 'OCR real-parse QA', settings: { features: { consolidatedMatch: true } } as never })
      .returning();
    rid = r!.id;
    process.env.OCR_REAL_RESTAURANT_IDS = rid;
    const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ירקות הגליל' }).returning();
    supplierId = s!.id;
  });
  afterEach(async () => {
    await qsql`DELETE FROM job_queue WHERE restaurant_id = ${rid}`;
    await db.delete(restaurants).where(eq(restaurants.id, rid));
    process.env = { ...saved };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("raw.kind='consolidated' with the period and canonical notes; parsed, lines written, no match job", async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await newInvoice();
    expect(await run(id)).toMatchObject({ lines: 2 });
    expect(h.created).toHaveLength(1); // one paid call (single provider)
    // The worker's wiring (#232): no SDK retry inside a job, and the read carries the deadline's signal.
    expect(h.clientOpts[0]).toMatchObject({ maxRetries: 0 });
    expect(h.requestOpts[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(h.requestOpts[0]?.signal?.aborted).toBe(false);

    const inv = await row(id);
    expect(inv.status).toBe('parsed');
    const raw = inv.ocrPayload?.raw as Record<string, unknown>;
    expect(raw).toMatchObject({
      kind: 'consolidated',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      // #232 canonicalises the note numbers upstream (digits only, de-duplicated).
      deliveryNotes: [{ number: '9001' }, { number: '9002' }],
    });
    expect(raw.reviewReasons).toEqual(expect.arrayContaining(['consolidated']));
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id))).toHaveLength(2);
    expect(await qsql`SELECT id FROM job_queue WHERE queue = 'match-invoice' AND payload->>'invoiceId' = ${id}`).toHaveLength(0);
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, id))).toHaveLength(0);

    // The cost log names the model from the provider's meta (the package default here).
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[ocr-invoice] mode=claude'))!;
    expect(line).toMatch(/kind=consolidated .* model=claude-opus-5-5 tokens=3000\/700 /);
    expect(line).not.toContain('scans.test');
  });

  it("an answer cut off at max_tokens is final at once as 'unreadable' (typed error, no retry)", async () => {
    h.stopReason = 'max_tokens';
    h.answer = '{"documentKind":"consolidated","lines":[';
    const id = await newInvoice();
    const err = await run(id).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.startsWith('[terminal] ')).toBe(true);
    expect((await row(id)).ocrPayload?.raw).toMatchObject({ ocrFailed: true, reason: 'unreadable' });
    expect(h.created).toHaveLength(1);
  });
  it('the per-job deadline CANCELS the in-flight read (signal → SDK) and reports a retryable OcrDeadlineError', async () => {
    h.hang = true;
    const vision = new ClaudeVision({ apiKey: 'test-key-not-real', fetchBytes: true, maxRetries: 0 });
    const url = `${SCAN_PREFIX}${rid}/scan-abc123-def456.pdf?token=t`;
    const err = await withOcrDeadline((signal) => vision.extract(url, { signal }), 50).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrDeadlineError);
    expect(classifyOcrError(err).retryable).toBe(true);
    expect(h.requestOpts[0]?.signal?.aborted).toBe(true); // the HTTP request itself was cancelled
  });

  it("an 'aborted' read the deadline did not cause is still retryable (never a terminal review)", () => {
    expect(classifyOcrError(new OcrExtractionError('aborted', 'the caller cancelled the read'))).toEqual({ retryable: true });
  });

  it("an invoice-level discount goes to review through the real pipeline (#232's gate): parsed, 'invoice_discount', no match job", async () => {
    h.answer = JSON.stringify({
      ...consolidatedAnswer,
      documentKind: 'tax_invoice',
      invoiceNumber: 'D-1',
      deliveryNotes: [],
      periodStart: null,
      periodEnd: null,
      invoiceDiscount: 8,
      totals: { subtotal: 72, vat: 12.96, total: 84.96, vatRate: 0.18 },
    });
    const id = await newInvoice();
    await run(id);
    const inv = await row(id);
    expect(inv.status).toBe('parsed');
    const raw = inv.ocrPayload?.raw as Record<string, unknown>;
    expect(raw.kind).toBe('tax_invoice');
    expect(raw.reviewReasons).toEqual(expect.arrayContaining(['invoice_discount']));
    expect(await qsql`SELECT id FROM job_queue WHERE queue = 'match-invoice' AND payload->>'invoiceId' = ${id}`).toHaveLength(0);
  });
});
