import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  goodsReceipts,
  invoiceLines,
  invoices,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import type { InvoiceOcrResult } from '@restomatch/types';

/**
 * OCR-A / PR-OCR-1: real OCR only for allowlisted tenants. ClaudeVision and the
 * meter are spies — no real Anthropic call is ever made here.
 */
const h = vi.hoisted(() => ({
  claudeCtor: vi.fn(),
  claudeUrls: [] as string[],
  claudeResult: null as unknown,
  meter: vi.fn(async () => ({ metered: true, used: 1, limit: null })),
  demoIds: null as string[] | null,
}));

vi.mock('@restomatch/ocr', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/ocr')>();
  class FakeClaudeVision {
    readonly id = 'claude_vision' as const;
    constructor(opts: unknown) {
      h.claudeCtor(opts);
    }
    async extract(image: unknown) {
      h.claudeUrls.push(String(image));
      return h.claudeResult as InvoiceOcrResult;
    }
  }
  return { ...real, ClaudeVision: FakeClaudeVision };
});

vi.mock('@restomatch/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/api')>();
  return { ...real, meterOcrScan: h.meter };
});

vi.mock('@restomatch/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/db')>();
  return {
    ...real,
    // The demo identity check (findDemoTenants) — the real one unless a test names the demo set.
    findDemoTenants: async (sql: Parameters<typeof real.findDemoTenants>[0]) =>
      h.demoIds
        ? { restaurants: h.demoIds.map((id) => ({ id, name: 'demo', businessId: null })), userIds: [], billingAccountIds: [] }
        : real.findDemoTenants(sql),
  };
});

const { claudeOcrRestaurantIds, isDemoTenant, ocrModeFor, ocrRealRestaurantIds, processOcrInvoice } = await import(
  '../jobs/ocrInvoice'
);
const { processOcrSweep } = await import('../jobs/ocrSweep');

const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SCAN_PREFIX = 'https://scans.test/storage/v1/object/sign/invoice-scans/';

describe('OCR_REAL_RESTAURANT_IDS parsing', () => {
  it('unset or empty means nobody', () => {
    expect(ocrRealRestaurantIds({}).size).toBe(0);
    expect(ocrRealRestaurantIds({ OCR_REAL_RESTAURANT_IDS: '' }).size).toBe(0);
    expect(ocrRealRestaurantIds({ OCR_REAL_RESTAURANT_IDS: ' , ,' }).size).toBe(0);
  });

  it('comma-separated UUIDs, trimmed and lower-cased', () => {
    const ids = ocrRealRestaurantIds({ OCR_REAL_RESTAURANT_IDS: ` ${A.toUpperCase()} ,${B}` });
    expect([...ids].sort()).toEqual([A, B]);
  });

  it('a malformed entry is ignored with ONE warning (never echoed back)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { OCR_REAL_RESTAURANT_IDS: `${A},not-a-uuid-zz,${B}x` };
    expect([...ocrRealRestaurantIds(env)]).toEqual([A]);
    expect([...ocrRealRestaurantIds(env)]).toEqual([A]);
    expect(warn).toHaveBeenCalledTimes(2); // one per malformed entry, not per call
    expect(warn.mock.calls.flat().join(' ')).not.toContain('not-a-uuid-zz');
    warn.mockRestore();
  });

  it('no ANTHROPIC_API_KEY → nobody gets real OCR, whatever the list says', () => {
    expect(claudeOcrRestaurantIds({ OCR_REAL_RESTAURANT_IDS: A }).size).toBe(0);
    expect([...claudeOcrRestaurantIds({ OCR_REAL_RESTAURANT_IDS: A, ANTHROPIC_API_KEY: 'k' })]).toEqual([A]);
  });
});

describe('ocrModeFor', () => {
  const env = { ANTHROPIC_API_KEY: 'k', OCR_REAL_RESTAURANT_IDS: A };
  const demo = (ids: string[]) => async (id: string) => ids.includes(id);

  it("'claude' only for a listed tenant with the key set", async () => {
    expect(await ocrModeFor(A, { env, isDemo: demo([]) })).toBe('claude');
    expect(await ocrModeFor(A.toUpperCase(), { env, isDemo: demo([]) })).toBe('claude');
    expect(await ocrModeFor(A, { env: { OCR_REAL_RESTAURANT_IDS: A }, isDemo: demo([]) })).toBe('disabled');
  });

  it("'stub' only for the demo identity, and only for a receiving scan (grId)", async () => {
    expect(await ocrModeFor(B, { env, grId: 'gr', isDemo: demo([B]) })).toBe('stub');
    expect(await ocrModeFor(B, { env, isDemo: demo([B]) })).toBe('disabled');
  });

  it("'disabled' for everyone else — a real tenant never gets the stub", async () => {
    expect(await ocrModeFor(B, { env, grId: 'gr', isDemo: demo([]) })).toBe('disabled');
  });

  it('the demo is never on real OCR unless it is listed (the allowlist is checked first)', async () => {
    expect(await ocrModeFor(B, { env: { ANTHROPIC_API_KEY: 'k' }, grId: 'gr', isDemo: demo([B]) })).toBe('stub');
  });
});

describe('processOcrInvoice gate (DB)', () => {
  const saved = { ...process.env };
  let rid = '';
  let supplierId = '';
  let grId = '';

  const extraction: InvoiceOcrResult = {
    supplier: { name: 'ספק' },
    invoiceNumber: 'REAL-1',
    invoiceDate: '2026-10-30',
    allocationNumber: null,
    lines: [{ rawDescription: 'עגבניות', qty: 2, unit: 'kg', unitPrice: 10, lineTotal: 20, vatRate: 0.18, confidence: 0.99 }],
    totals: { subtotal: 20, vat: 3.6, total: 23.6 },
    confidence: 0.99,
  };

  async function newInvoice(opts: { status?: 'ocr_pending' | 'matched'; url?: string | null } = {}) {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: rid,
        supplierId,
        status: opts.status ?? 'ocr_pending',
        source: 'photo',
        rawImageUrl: opts.url === undefined ? `${SCAN_PREFIX}${rid}/scan.jpg?token=t` : opts.url,
      })
      .returning();
    return inv!;
  }

  const run = (data: Record<string, unknown>) =>
    processOcrInvoice({ data: { restaurantId: rid, supplierId: null, imageUrl: 'https://payload.example/evil.jpg', ...data } } as never);

  const read = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
  const lines = (id: string) => db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));

  beforeEach(async () => {
    process.env.DATABASE_URL = testDbUrl();
    process.env.INVOICE_SCAN_URL_PREFIX = SCAN_PREFIX;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OCR_REAL_RESTAURANT_IDS;
    h.claudeCtor.mockClear();
    h.meter.mockClear();
    h.claudeUrls.length = 0;
    h.claudeResult = extraction;
    h.demoIds = null;
    const [r] = await db.insert(restaurants).values({ name: 'OCR allowlist QA' }).returning();
    rid = r!.id;
    const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ספק' }).returning();
    supplierId = s!.id;
    const [po] = await db.insert(purchaseOrders).values({ restaurantId: rid, supplierId }).returning();
    await db.insert(poLines).values([
      { poId: po!.id, rawDescription: 'מלפפונים', qtyOrdered: '5', unit: 'kg', unitPriceExpected: '4.0000' },
      { poId: po!.id, rawDescription: 'בצל', qtyOrdered: '3', unit: 'kg', unitPriceExpected: '3.0000' },
    ]);
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId: rid, poId: po!.id }).returning();
    grId = gr!.id;
  });

  afterEach(async () => {
    await qsql`DELETE FROM job_queue WHERE restaurant_id = ${rid}`;
    await db.delete(restaurants).where(eq(restaurants.id, rid));
    process.env = { ...saved };
  });

  it('an unknown tenant → disabled: no ClaudeVision, no meter, invoice marked ocr_disabled with no lines', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.OCR_REAL_RESTAURANT_IDS = A; // someone else
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const inv = await newInvoice();
    const res = await run({ invoiceId: inv.id, grId });
    expect(res).toMatchObject({ skipped: 'ocr_disabled' });
    expect(h.claudeCtor).not.toHaveBeenCalled();
    expect(h.meter).not.toHaveBeenCalled();
    const row = await read(inv.id);
    expect(row.status).toBe('parsed');
    expect(Number(row.ocrConfidence)).toBe(0);
    expect(row.ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'ocr_disabled' });
    expect(await lines(inv.id)).toHaveLength(0);
    // One line per job: mode + short ids, no URL.
    const out = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[ocr-invoice]'));
    expect(out).toEqual([`[ocr-invoice] mode=disabled restaurant=${rid.slice(0, 8)} invoice=${inv.id.slice(0, 8)} skipped=ocr_disabled`]);
    log.mockRestore();
  });

  it('the demo tenant → stub from its receipt (DEMO- number), ClaudeVision never constructed, not metered', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    h.demoIds = [rid];
    const inv = await newInvoice();
    const res = await run({ invoiceId: inv.id, grId });
    expect(res).toMatchObject({ invoiceId: inv.id, lines: 2 });
    expect(h.claudeCtor).not.toHaveBeenCalled();
    expect(h.meter).not.toHaveBeenCalled();
    const row = await read(inv.id);
    expect(row.invoiceNumber).toMatch(/^DEMO-/);
    expect((await lines(inv.id)).map((l) => l.rawDescription).sort()).toEqual(['בצל', 'מלפפונים']);
  });

  it('the demo tenant without a receipt (email / WhatsApp scan) → disabled, nothing fabricated', async () => {
    h.demoIds = [rid];
    const inv = await newInvoice();
    expect(await run({ invoiceId: inv.id })).toMatchObject({ skipped: 'ocr_disabled' });
    expect(await lines(inv.id)).toHaveLength(0);
    expect((await read(inv.id)).ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'ocr_disabled' });
  });

  it("an allowlisted tenant → ClaudeVision (mocked) on the ROW's URL, never the payload's; metered once", async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.OCR_REAL_RESTAURANT_IDS = `${A},${rid}`;
    const inv = await newInvoice();
    const res = await run({ invoiceId: inv.id });
    expect(res).toMatchObject({ invoiceId: inv.id, lines: 1 });
    expect(h.claudeCtor).toHaveBeenCalledTimes(1);
    expect(h.claudeUrls).toEqual([inv.rawImageUrl]);
    expect(h.claudeUrls).not.toContain('https://payload.example/evil.jpg');
    expect(h.meter).toHaveBeenCalledTimes(1);
    expect((await read(inv.id)).invoiceNumber).toBe('REAL-1');
  });

  it('an allowlisted tenant whose row URL is not one of our signed scan URLs → refused, nothing fetched or metered', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.OCR_REAL_RESTAURANT_IDS = rid;
    const inv = await newInvoice({ url: 'http://169.254.169.254/latest/meta-data' });
    expect(await run({ invoiceId: inv.id, imageUrl: `${SCAN_PREFIX}ok.jpg` })).toMatchObject({ skipped: 'scan_url_refused' });
    expect(h.claudeCtor).not.toHaveBeenCalled();
    expect(h.meter).not.toHaveBeenCalled();
    expect((await read(inv.id)).ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'scan_url_refused' });
  });

  it('status guard: an invoice that already left ocr_pending is left alone', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.OCR_REAL_RESTAURANT_IDS = rid;
    const inv = await newInvoice({ status: 'matched' });
    expect(await run({ invoiceId: inv.id })).toMatchObject({ skipped: 'not_pending' });
    expect(h.claudeCtor).not.toHaveBeenCalled();
    expect(h.meter).not.toHaveBeenCalled();
    const row = await read(inv.id);
    expect(row.status).toBe('matched');
    expect(row.ocrPayload).toBeNull();
  });

  it('in production a payload can never inject an extraction (mockProviders ignored → the mode decides)', async () => {
    process.env.NODE_ENV = 'production';
    const inv = await newInvoice();
    const res = await run({ invoiceId: inv.id, mockProviders: { docAi: extraction, claude: extraction } });
    expect(res).toMatchObject({ skipped: 'ocr_disabled' });
    expect(await lines(inv.id)).toHaveLength(0);
  });

  it('isDemoTenant uses the real identity finder: an ordinary tenant is not demo', async () => {
    expect(await isDemoTenant(db, rid)).toBe(false);
  });
});

describe('ocr-sweep gate', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('does nothing while no tenant is on real OCR', async () => {
    delete process.env.OCR_REAL_RESTAURANT_IDS;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    expect(await processOcrSweep({ data: {} } as never)).toMatchObject({ skipped: expect.stringContaining('no tenant') });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OCR_REAL_RESTAURANT_IDS = A;
    expect(await processOcrSweep({ data: {} } as never)).toMatchObject({ skipped: expect.stringContaining('no tenant') });
  });
});
