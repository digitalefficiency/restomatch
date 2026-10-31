import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, invoiceLines, invoices, matchRuns, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter, buildMatchInputForInvoice } from '@restomatch/api';
import { queueSql } from '@restomatch/queue';
import type { InvoiceOcrResult } from '@restomatch/types';

/**
 * OCR-A / PR-OCR-2b: persistence of a real read (+ the 31.10 owner decision:
 * real consolidated invoices). ClaudeVision is a spy — no Anthropic call.
 */
const h = vi.hoisted(() => ({
  result: null as unknown,
  /** Runs inside extract(), before it returns (e.g. another read lands meanwhile). */
  during: null as null | (() => Promise<void>),
}));

vi.mock('@restomatch/ocr', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/ocr')>();
  class FakeClaudeVision {
    readonly id = 'claude_vision' as const;
    constructor(private readonly opts: { onUsage?: (u: { input_tokens?: number; output_tokens?: number }) => void }) {}
    async extract() {
      if (h.during) await h.during();
      this.opts.onUsage?.({ input_tokens: 2000, output_tokens: 500 });
      return h.result as InvoiceOcrResult;
    }
  }
  return { ...real, ClaudeVision: FakeClaudeVision };
});
vi.mock('@restomatch/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/api')>();
  return { ...real, meterOcrScan: async () => ({ metered: true, used: 1, limit: null }) };
});

const { canonicalNoteNumber, documentFacts, normalizeBusinessId, ocrCostUsd, processOcrInvoice } = await import('../jobs/ocrInvoice');

const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const SCAN_PREFIX = 'https://scans.test/storage/v1/object/sign/invoice-scans/';

const base: InvoiceOcrResult = {
  supplier: { name: 'ספק ירקות' },
  invoiceNumber: 'P-1',
  invoiceDate: '2026-10-30',
  allocationNumber: null,
  lines: [{ rawDescription: 'עגבניות', qty: 2, unit: 'kg', unitPrice: 10, lineTotal: 20, vatRate: 0.18, confidence: 0.99 }],
  totals: { subtotal: 20, vat: 3.6, total: 23.6 },
  confidence: 0.99,
};
const consolidated = {
  ...base,
  invoiceNumber: 'R-10',
  // S14's shape (packages/ocr): consolidation + billingPeriod {from, to} on reconciled.
  consolidation: 'consolidated',
  consolidationBasis: 'delivery_note_list',
  documentKind: 'consolidated',
  billingPeriod: { from: '2026-10-01', to: '2026-10-31' },
  deliveryNotes: [{ number: '9001' }, { number: '9002' }, '9001'],
} as unknown as InvoiceOcrResult;

describe('documentFacts', () => {
  it('no documentKind (today’s extraction, the stub) → an ordinary tax invoice', () => {
    expect(documentFacts(base)).toEqual({ kind: 'tax_invoice', periodStart: null, periodEnd: null, deliveryNotes: [], consolidatedEvidence: false });
  });
  it('a consolidated invoice: period + unique note numbers', () => {
    expect(documentFacts(consolidated)).toEqual({
      kind: 'consolidated',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      deliveryNotes: [{ number: '9001' }, { number: '9002' }],
      consolidatedEvidence: false,
    });
  });
  it('other kinds pass through as a safe slug; a bad period date is dropped', () => {
    const f = documentFacts({ documentKind: 'Delivery Note', billingPeriod: { start: '1.10.26', end: '2026-10-31' } });
    expect(f.kind).toBe('delivery_note');
    expect([f.periodStart, f.periodEnd]).toEqual([null, '2026-10-31']);
  });
  it("S14's classifier wins: documentKind 'consolidated' without its evidence (consolidation 'regular') is an ordinary invoice", () => {
    expect(documentFacts({ documentKind: 'consolidated', consolidation: 'regular' }).kind).toBe('tax_invoice');
    expect(documentFacts({ consolidation: 'consolidated', deliveryNotes: [{ number: '1' }, { number: '2' }] }).kind).toBe('consolidated');
  });
  it('ח.פ. normalisation (review #6, S14 semantics): digits only, 10→9 on a leading 0, 8–9 padded, check digit — else unknown', () => {
    expect(normalizeBusinessId('51-477812-5')).toBe('514778125');
    expect(normalizeBusinessId('0514778125')).toBe('514778125'); // a leading 0 is not significant
    expect(normalizeBusinessId('ח.פ. 514778125')).toBe('514778125');
    expect(normalizeBusinessId('12345674')).toBe('012345674'); // 8 digits → padded (valid checksum)
    expect(normalizeBusinessId('012345674')).toBe('012345674'); // the same id either way: symmetric
    expect(normalizeBusinessId('18')).toBeNull(); // too short (S14 semantics: 8–9 digits, or 10 with a leading 0)
    expect(normalizeBusinessId('514276385')).toBe('514276385');
    expect(normalizeBusinessId('515209641')).toBe('515209641');
    expect(normalizeBusinessId('1514778125')).toBeNull(); // 10 digits without a leading 0
    expect(normalizeBusinessId('514778123')).toBeNull(); // check digit fails → unknown, not a mismatch
    expect(normalizeBusinessId('0541234567')).toBeNull(); // a phone number: 10 significant digits
    expect(normalizeBusinessId(undefined)).toBeNull();
    // All zeros passes the check digit but is no one's ח.פ. (S14 semantics).
    for (const zeros of ['000000000', '00000000', '0000000000', '00-000000-0']) expect(normalizeBusinessId(zeros), zeros).toBeNull();
  });
  it('delivery-note numbers are canonical (review #9): label stripped, ranges and lists rejected', () => {
    expect(canonicalNoteNumber('ת.מ. 9001')).toBe('9001');
    expect(canonicalNoteNumber('ת"מ 9002')).toBe('9002');
    expect(canonicalNoteNumber('ת״מ: 9003')).toBe('9003');
    expect(canonicalNoteNumber('DN-9004')).toBe('9004');
    expect(canonicalNoteNumber(9005)).toBe('9005');
    expect(canonicalNoteNumber('9001-9005')).toBeNull();
    expect(canonicalNoteNumber('9001, 9002')).toBeNull();
    expect(canonicalNoteNumber('abc')).toBeNull();
    expect(documentFacts({ consolidation: 'consolidated', deliveryNotes: ['ת.מ. 9001', { number: '9001' }, '9001-9003'] }).deliveryNotes)
      .toEqual([{ number: '9001', printed: 'ת.מ. 9001' }]);
  });
  it('consolidated evidence on a document read as an ordinary invoice (review #8)', () => {
    expect(documentFacts({ deliveryNotes: [{ number: '1' }, { number: '2' }] })).toMatchObject({ kind: 'tax_invoice', consolidatedEvidence: true });
    expect(documentFacts({ billingPeriod: { from: '2026-10-01', to: '2026-10-31' } })).toMatchObject({ kind: 'tax_invoice', consolidatedEvidence: true });
    expect(documentFacts({ deliveryNotes: [{ number: '1' }] }).consolidatedEvidence).toBe(false);
    // A raw range or list, or ≥ 2 distinct alphanumeric entries, is evidence too (delta review, optional).
    expect(documentFacts({ deliveryNotes: [{ number: '1001-1005' }] }).consolidatedEvidence).toBe(true);
    expect(documentFacts({ deliveryNotes: ['12, 14'] }).consolidatedEvidence).toBe(true);
    expect(documentFacts({ deliveryNotes: [{ number: 'A12' }, { number: 'B7' }] }).consolidatedEvidence).toBe(true);
    // …but one note printed twice (with and without its prefix) is still one note.
    expect(documentFacts({ deliveryNotes: [{ number: '12345' }, { number: 'ת.מ. 12345' }] }).consolidatedEvidence).toBe(false);
    expect(documentFacts({ deliveryNotes: [{ number: 'A12' }] }).consolidatedEvidence).toBe(false);
    expect(documentFacts(consolidated).consolidatedEvidence).toBe(false); // already consolidated
  });
  it('estimated cost from the list price; an unknown model is not guessed', () => {
    expect(ocrCostUsd({ model: 'claude-opus-4-8', inputTokens: 2000, outputTokens: 500 })).toBeCloseTo(0.0225, 6);
    expect(ocrCostUsd({ model: 'some-model', inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});

describe('processOcrInvoice persistence (DB)', () => {
  const saved = { ...process.env };
  let rid = '';
  let supplierId = '';

  async function newInvoice(opts: { supplier?: boolean } = {}) {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: rid,
        supplierId: opts.supplier === false ? null : supplierId,
        status: 'ocr_pending',
        source: 'email',
        rawImageUrl: `${SCAN_PREFIX}${rid}/x.pdf?token=t`,
      })
      .returning();
    return inv!.id;
  }
  const run = (invoiceId: string) =>
    processOcrInvoice({ data: { restaurantId: rid, invoiceId, supplierId: null, imageUrl: 'ignored' } } as never);
  const row = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
  const matchJobs = async (id: string) =>
    qsql`SELECT id FROM job_queue WHERE queue = 'match-invoice' AND payload->>'invoiceId' = ${id}`;
  const raw = async (id: string) => (await row(id)).ocrPayload?.raw as Record<string, unknown>;

  beforeEach(async () => {
    process.env.DATABASE_URL = testDbUrl();
    process.env.INVOICE_SCAN_URL_PREFIX = SCAN_PREFIX;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    delete process.env.OCR_CLAUDE_MODEL;
    h.result = base;
    h.during = null;
    const [r] = await db
      .insert(restaurants)
      .values({ name: 'OCR persist QA', settings: { features: { consolidatedMatch: true } } as never })
      .returning();
    rid = r!.id;
    process.env.OCR_REAL_RESTAURANT_IDS = rid;
    const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ספק ירקות' }).returning();
    supplierId = s!.id;
  });
  afterEach(async () => {
    await qsql`DELETE FROM job_queue WHERE restaurant_id = ${rid}`;
    await db.delete(restaurants).where(eq(restaurants.id, rid));
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('stores ONE copy of the extraction (no primary / providers duplicates) + raw.kind', async () => {
    const id = await newInvoice();
    await run(id);
    const r = await raw(id);
    expect(r).not.toHaveProperty('primary');
    expect(r).not.toHaveProperty('providers');
    expect(r).toMatchObject({ kind: 'tax_invoice', confidence: expect.any(Number), reconciled: { invoiceNumber: 'P-1' } });
    expect(JSON.stringify(r).split('"עגבניות"').length - 1).toBe(1); // the line text appears once
  });

  it('a real consolidated invoice: top-level kind / period / notes, parsed, NO single-PO match; the cross-match proposal is available', async () => {
    h.result = consolidated;
    const id = await newInvoice();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(id);
    const inv = await row(id);
    expect(inv.status).toBe('parsed');
    expect(inv.ocrPayload?.raw).toMatchObject({
      kind: 'consolidated',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      deliveryNotes: [{ number: '9001' }, { number: '9002' }],
    });
    expect(await matchJobs(id)).toHaveLength(0);
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, id))).toHaveLength(0);
    // Even a match job (re-match, receipt) builds nothing for it…
    expect(await buildMatchInputForInvoice(db, rid, id)).toBeNull();
    // …while the cross-match proposal reads it.
    const caller = appRouter.createCaller({ db, session: { userId: crypto.randomUUID(), restaurantId: rid, role: 'owner' } } as never);
    const proposal = await caller.consolidated.proposal({ invoiceId: id });
    expect(proposal).not.toBeNull();
    expect(proposal!.periodStart.slice(0, 7)).toBe('2026-09'); // 1 Oct 00:00 Israel = 30 Sep 21:00Z
    // One log line: kind + model / tokens / ms / $ — no content, no URL.
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[ocr-invoice] mode=claude'))!;
    expect(line).toMatch(/kind=consolidated .* model=claude-opus-4-8 tokens=2000\/500 ms=\d+ usd=0\.0225/);
    expect(line).not.toContain('scans.test');
    expect(line).not.toContain('עגבניות');
  });

  it('consolidated with no known supplier: held for a human (review reason), no match — never guessed', async () => {
    h.result = consolidated;
    const id = await newInvoice({ supplier: false });
    await run(id);
    expect((await row(id)).status).toBe('parsed');
    expect((await raw(id)).reviewReasons).toEqual(['consolidated', 'consolidated_unknown_supplier']);
    expect(await matchJobs(id)).toHaveLength(0);
  });

  it('a document that is not a tax invoice: parsed, review reason doc_kind_<kind>, no match', async () => {
    h.result = { ...base, documentKind: 'delivery_note' };
    const id = await newInvoice();
    await run(id);
    expect((await row(id)).status).toBe('parsed');
    expect(await raw(id)).toMatchObject({ kind: 'delivery_note', reviewReasons: ['doc_kind_delivery_note'] });
    expect(await matchJobs(id)).toHaveLength(0);
  });

  it('ח.פ. on the document differs from the supplier on file: held (supplier_id_mismatch), no match', async () => {
    await db.update(suppliers).set({ businessId: '514778125' }).where(eq(suppliers.id, supplierId));
    h.result = { ...base, supplier: { name: 'ספק ירקות', businessId: '511111114' } };
    const id = await newInvoice();
    await run(id);
    expect((await row(id)).status).toBe('parsed');
    expect((await raw(id)).reviewReasons).toEqual(['supplier_id_mismatch']);
    expect(await matchJobs(id)).toHaveLength(0);
  });

  it('the same ח.פ. (as printed: with dashes) or none on file is not a mismatch', async () => {
    await db.update(suppliers).set({ businessId: '514778125' }).where(eq(suppliers.id, supplierId));
    h.result = { ...base, supplier: { name: 'ספק ירקות', businessId: '51-477812-5' } };
    const same = await newInvoice();
    await run(same);
    expect(await raw(same)).not.toHaveProperty('reviewReasons');
    await db.update(suppliers).set({ businessId: null }).where(eq(suppliers.id, supplierId));
    h.result = { ...base, invoiceNumber: 'P-2', supplier: { name: 'ספק ירקות', businessId: '511111114' } };
    const none = await newInvoice();
    await run(none);
    expect(await raw(none)).not.toHaveProperty('reviewReasons');
  });

  it("another tenant's supplier row is never consulted", async () => {
    const [other] = await db.insert(restaurants).values({ name: 'OCR persist other' }).returning();
    try {
      // A VALID ח.פ. (599999992 passes the check digit), so a cross-tenant read
      // would really flag a mismatch — the test is not vacuous.
      const [s2] = await db.insert(suppliers).values({ restaurantId: other!.id, name: 'x', businessId: '599999992' }).returning();
      h.result = { ...base, supplier: { name: 'x', businessId: '511111114' } };
      // An invoice of OUR tenant pointing at the other tenant's supplier id (a corrupt row).
      const [inv] = await db
        .insert(invoices)
        .values({ restaurantId: rid, supplierId: s2!.id, status: 'ocr_pending', source: 'email', rawImageUrl: `${SCAN_PREFIX}${rid}/y.pdf` })
        .returning();
      await run(inv!.id);
      expect(await raw(inv!.id)).not.toHaveProperty('reviewReasons');
      // Positive control: the same pair on OUR supplier is a mismatch.
      await db.update(suppliers).set({ businessId: '599999992' }).where(eq(suppliers.id, supplierId));
      const ours = await newInvoice();
      await run(ours);
      expect((await raw(ours)).reviewReasons).toEqual(['supplier_id_mismatch']);
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, other!.id));
    }
  });

  it("a consolidated invoice always carries the explicit 'consolidated' reason (review #2)", async () => {
    h.result = consolidated;
    const id = await newInvoice();
    await run(id);
    expect((await raw(id)).reviewReasons).toEqual(['consolidated']);
  });

  it('a read merges over raw keys stamped before it (scanGrId, reasons) — review #4', async () => {
    const id = await newInvoice();
    const stamped = crypto.randomUUID();
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'claude_vision', raw: { scanGrId: stamped, reviewReasons: ['unlinked'], keep: 'me' } } })
      .where(eq(invoices.id, id));
    await run(id);
    const r = await raw(id);
    expect(r).toMatchObject({ scanGrId: stamped, keep: 'me', kind: 'tax_invoice', reconciled: { invoiceNumber: 'P-1' } });
    expect(r.reviewReasons).toEqual(['unlinked']);
  });

  it('a document with consolidated evidence but read as an ordinary invoice is held, never auto-matched — review #8', async () => {
    h.result = { ...base, deliveryNotes: [{ number: '7001' }, { number: '7002' }] };
    const id = await newInvoice();
    await run(id);
    expect((await row(id)).status).toBe('parsed');
    expect((await raw(id)).reviewReasons).toEqual(['consolidated_evidence']);
    expect(await matchJobs(id)).toHaveLength(0);
  });

  it('needsHumanReview: parsed, no auto-match', async () => {
    h.result = { ...base, confidence: 0.4, lines: [{ ...base.lines[0]!, confidence: 0.1 }] };
    const id = await newInvoice();
    await run(id);
    expect((await row(id)).status).toBe('parsed');
    expect(await matchJobs(id)).toHaveLength(0);
  });

  it('header + lines in one transaction guarded by ocr_pending: a read that lands meanwhile is never overwritten', async () => {
    const id = await newInvoice();
    h.during = async () => {
      await db.update(invoices).set({ status: 'matched', invoiceNumber: 'OTHER-READ' }).where(eq(invoices.id, id));
    };
    expect(await run(id)).toMatchObject({ skipped: 'already_read' });
    const inv = await row(id);
    expect(inv.invoiceNumber).toBe('OTHER-READ');
    expect(inv.ocrPayload).toBeNull();
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id))).toHaveLength(0);
    expect(await matchJobs(id)).toHaveLength(0);
  });
});
