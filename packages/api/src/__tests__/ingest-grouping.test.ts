/**
 * G-09 · one document = one invoice on the WhatsApp / e-mail intake, FROM THE
 * SAME SUPPLIER ONLY (owner decision 31.10). Drives processInboundMessage on the
 * RLS-enforced app role with the stub provider (as ingest.attack.test.ts does),
 * then plays the OCR worker: write the page's OCR header + a line, then call
 * settleDocumentPages exactly where the worker does. No network, no paid OCR.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  auditLog,
  discrepancies,
  recoveryClaims,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestSenders,
  invoiceLines,
  invoiceScans,
  invoices,
  matchRuns,
  restaurants,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { StubIngestProvider, type InboundMessage } from '@restomatch/ingest';
import { processInboundMessage, registerReviewGroup, type ResolvedChannel } from '../ingest/pipeline';
import { settleDocumentPages, type SettleResult } from '../documents/settle';
import { toObjectRef } from '../documents/objectRef';
import { localDocumentStorage } from '../documents/storage';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { jpegBytes, pngBytes } from './documentTestKit';

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
const ch: { wa: ResolvedChannel; email: ResolvedChannel } = {} as never;
const SUPPLIER_PHONE = '972501111111';
const SUPPLIER_MAIL = 'bills@supplier-a.co.il';
const T0 = new Date('2026-11-02T08:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

process.env.LOCAL_SCAN_DIR = mkdtempSync(join(tmpdir(), 'ingest-grouping-'));

let provider: StubIngestProvider;
let seq = 0;

function wa(images: Uint8Array[], opts: { from?: string } = {}): InboundMessage {
  const id = `wamid.g${++seq}`;
  return {
    kind: 'whatsapp',
    providerMessageId: id,
    sender: opts.from ?? SUPPLIER_PHONE,
    subject: null,
    sentAtSec: null,
    phoneNumberId: null,
    authVerdict: 'pass',
    attachments: images.map((bytes, i) => {
      const ref = `${id}-${i}`;
      provider.register(ref, { bytes, mimeType: 'image/jpeg' });
      return { filename: null, declaredMime: 'image/jpeg', declaredSize: null, providerRef: ref };
    }),
  };
}

function mail(files: Array<{ name: string; bytes: Uint8Array }>): InboundMessage {
  return {
    kind: 'email',
    providerMessageId: `mail-${++seq}`,
    sender: SUPPLIER_MAIL,
    subject: 'חשבונית',
    sentAtSec: null,
    phoneNumberId: null,
    authVerdict: 'pass',
    attachments: files.map((f) => ({
      filename: f.name,
      declaredMime: null,
      declaredSize: f.bytes.byteLength,
      contentBase64: Buffer.from(f.bytes).toString('base64'),
    })),
  };
}

async function send(channel: ResolvedChannel, m: InboundMessage, now: Date) {
  return processInboundMessage(appDb, channel, m, provider, { now });
}

async function docsOf(messageId: string) {
  return ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.messageId, messageId)).orderBy(ingestDocuments.createdAt);
}

async function ocrJobs(invoiceId: string) {
  return (await ownerDb.execute(
    sql`select dedupe_key from job_queue where queue = 'ocr-invoice' and payload->>'invoiceId' = ${invoiceId} order by id`,
  )) as unknown as Array<{ dedupe_key: string | null }>;
}

async function pdfPagesOf(invoiceId: string): Promise<number> {
  const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, invoiceId));
  const ref = toObjectRef(inv!.rawImageUrl!, A.restaurantId)!;
  const bytes = await localDocumentStorage().read(A.restaurantId, ref);
  if (!bytes) throw new Error(`no object for ${ref}`);
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return 1;
  return (await PDFDocument.load(bytes)).getPageCount();
}

async function setSettings(opts: { multiPage?: boolean; groupMinutes?: number; all?: boolean }) {
  const features: Record<string, boolean> = { ingestWhatsapp: true, ingestEmail: true };
  if (opts.multiPage !== undefined) features.multiPage = opts.multiPage;
  if (opts.all) features.all = true;
  await ownerDb
    .update(restaurants)
    .set({ settings: { features, ...(opts.groupMinutes !== undefined ? { ingest: { groupMinutes: opts.groupMinutes } } : {}) } as never })
    .where(eq(restaurants.id, A.restaurantId));
}

interface OcrHead {
  supplierName?: string;
  businessId?: string;
  invoiceNumber?: string | null;
  status?: 'parsed' | 'matched';
}
const ACME: OcrHead = { supplierName: 'תנובה בע"מ', businessId: '51-000123-4', invoiceNumber: 'A-100' };
const OTHER: OcrHead = { supplierName: 'שטראוס', businessId: '52-999888-7', invoiceNumber: 'S-7' };

let matchCalls: string[] = [];
let ocrCalls: Array<{ invoiceId: string; dedupeKey?: string }> = [];

/**
 * Play the OCR worker for one invoice: header + one line (as writeOcrHeader +
 * the line insert do), then the settle hook. Returns its verdict.
 */
async function ocr(invoiceId: string, head: OcrHead): Promise<SettleResult> {
  await ownerDb
    .update(invoices)
    .set({
      status: head.status ?? 'matched',
      invoiceNumber: head.invoiceNumber ?? null,
      ocrPayload: {
        provider: 'stub',
        raw: { reconciled: { supplier: { name: head.supplierName, businessId: head.businessId }, invoiceNumber: head.invoiceNumber } },
      } as never,
    })
    .where(eq(invoices.id, invoiceId));
  await ownerDb.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  await ownerDb.insert(invoiceLines).values({
    invoiceId,
    rawDescription: `line of ${invoiceId.slice(0, 8)}`,
    qtyBilled: '1',
    unit: 'unit',
    unitPriceBilled: '10.0000',
    lineTotal: '10.00',
  });
  return withRestaurant(appDb, A.restaurantId, (tx) =>
    settleDocumentPages(
      tx,
      { restaurantId: A.restaurantId, invoiceId },
      {
        enqueueOcr: async (jobs) => {
          ocrCalls.push(...jobs.map((j) => ({ invoiceId: j.invoiceId, dedupeKey: j.dedupeKey })));
        },
        enqueueMatch: async (j) => {
          matchCalls.push(j.invoiceId);
        },
      },
    ),
  );
}

async function invoiceOf(out: { messageId?: string } | unknown): Promise<string> {
  const [d] = await docsOf((out as { messageId: string }).messageId);
  return d!.invoiceId!;
}

async function invoicesOfA() {
  return ownerDb.select().from(invoices).where(and(eq(invoices.restaurantId, A.restaurantId), sql`${invoices.source} in ('whatsapp','email')`));
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await ownerDb.execute(sql`delete from job_queue`);
  A = await seedTenant(ownerDb, 'A');
  await ownerDb
    .update(restaurants)
    .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } as never })
    .where(eq(restaurants.id, A.restaurantId));
  const [w] = await ownerDb
    .insert(ingestChannels)
    .values({ restaurantId: A.restaurantId, kind: 'whatsapp', tokenHash: `h-wa-${seq}`, tokenHint: 'wa' })
    .returning({ id: ingestChannels.id });
  const [e] = await ownerDb
    .insert(ingestChannels)
    .values({ restaurantId: A.restaurantId, kind: 'email', tokenHash: `h-em-${seq}`, tokenHint: 'em' })
    .returning({ id: ingestChannels.id });
  ch.wa = { channelId: w!.id, restaurantId: A.restaurantId, kind: 'whatsapp', phoneNumberId: null };
  ch.email = { channelId: e!.id, restaurantId: A.restaurantId, kind: 'email', phoneNumberId: null };
  await ownerDb.insert(ingestSenders).values([
    { restaurantId: A.restaurantId, kind: 'whatsapp', sender: SUPPLIER_PHONE, supplierId: A.supplierId },
    { restaurantId: A.restaurantId, kind: 'email', sender: SUPPLIER_MAIL, supplierId: A.supplierId },
  ]);
  provider = new StubIngestProvider('whatsapp');
  await setSettings({ multiPage: true });
});
afterAll(async () => {
  await resetDb(ownerDb);
});


describe('owner rule: multi-page invoices FROM THE SAME SUPPLIER', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('2 pages, same supplier (2 WhatsApp messages 3 min apart) → ONE invoice, 2 pages, one extra OCR', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('s-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('s-p2')]), at(3)));
    expect(p2).not.toBe(p1); // each page is OCR'd alone first
    // Page 1 is read while page 2 is still pending → no match yet.
    expect(await ocr(p1, ACME)).toMatchObject({ hold: true, absorbed: false });
    // Page 2: same ח.פ., no invoice number (a continuation page) → merged.
    const s2 = await ocr(p2, { ...ACME, invoiceNumber: null });
    expect(s2).toMatchObject({ absorbed: true, mergedInto: p1, flagged: [] });
    expect((await invoicesOfA()).map((i) => i.id)).toEqual([p1]);
    expect(await pdfPagesOf(p1)).toBe(2);
    expect(ocrCalls).toEqual([{ invoiceId: p1, dedupeKey: `ocr:${p1}:2` }]);
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1));
    expect(inv!.status).toBe('ocr_pending');
    // The re-OCR of page 1 settles as a 2-page document: nothing left to merge.
    expect(await ocr(p1, ACME)).toMatchObject({ hold: false, absorbed: false, flagged: [] });
  });

  it('page 2 from ANOTHER supplier (different ח.פ.) → NOT merged, flagged, page 1 is matched on its own', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('o-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('o-p2')]), at(2)));
    expect((await ocr(p1, ACME)).hold).toBe(true);
    const s2 = await ocr(p2, OTHER);
    expect(s2).toMatchObject({ absorbed: false, hold: false, flagged: [{ invoiceId: p2, reason: 'page_other_supplier' }] });
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([p1, p2].sort());
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2));
    expect(d2!.error).toBe('page_other_supplier');
    // Never summed: each invoice keeps only its own line.
    for (const id of [p1, p2]) expect(await ownerDb.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id))).toHaveLength(1);
    expect(ocrCalls).toEqual([]);
    expect(matchCalls).toEqual([p1]); // the held page 1 is released to the match
  });

  it('a different supplier NAME (no ח.פ. read) is another supplier too', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('n-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('n-p2')]), at(2)));
    await ocr(p1, { supplierName: 'תנובה בע"מ', invoiceNumber: 'A-1' });
    const s2 = await ocr(p2, { supplierName: 'שטראוס בע"מ', invoiceNumber: null });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_other_supplier' }]);
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('same supplier, a DIFFERENT invoice number → NOT merged (two invoices), flagged', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('i-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('i-p2')]), at(2)));
    await ocr(p1, ACME);
    const s2 = await ocr(p2, { ...ACME, invoiceNumber: 'A-101' });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_other_invoice' }]);
    expect(await invoicesOfA()).toHaveLength(2);
    expect(ocrCalls).toEqual([]);
  });

  it('a flagged page never joins later: page 3 of the real invoice still merges into page 1', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('f-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('f-p2')]), at(1)));
    const p3 = await invoiceOf(await send(ch.wa, wa([jpegBytes('f-p3')]), at(2)));
    await ocr(p1, ACME);
    await ocr(p2, OTHER);
    const s3 = await ocr(p3, { ...ACME, invoiceNumber: 'A 100' }); // same number, other spacing
    expect(s3.flagged).toEqual([{ invoiceId: p2, reason: 'page_other_supplier' }]);
    expect(s3).toMatchObject({ absorbed: true, mergedInto: p1 });
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([p1, p2].sort());
    expect(await pdfPagesOf(p1)).toBe(2);
  });
});

describe('one message and one sender window', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('an e-mail with 3 images of one invoice → ONE 3-page invoice after OCR', async () => {
    const out = await send(ch.email, mail([1, 2, 3].map((i) => ({ name: `p${i}.jpg`, bytes: jpegBytes(`m3-${i}`, 40_000) }))), at(0));
    expect(out.status).toBe('accepted');
    const docs = await docsOf((out as { messageId: string }).messageId);
    expect(docs.map((d) => d.status)).toEqual(['registered', 'registered', 'registered']);
    const [a, b, c] = docs.map((d) => d.invoiceId!);
    expect((await ocr(a!, ACME)).hold).toBe(true);
    expect((await ocr(b!, { ...ACME, invoiceNumber: null })).hold).toBe(true); // page 3 still pending
    const last = await ocr(c!, { ...ACME, invoiceNumber: null });
    expect(last).toMatchObject({ absorbed: true, mergedInto: a });
    expect((await invoicesOfA()).map((i) => i.id)).toEqual([a]);
    expect(await pdfPagesOf(a!)).toBe(3);
    const [scan] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, a!));
    expect(scan).toMatchObject({ pageCount: 3, mimeType: 'application/pdf' });
  });

  it('an e-mail with a PDF + a 4 KB logo → one document, the logo skipped:inline_image', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const out = await send(
      ch.email,
      mail([
        { name: 'inv.pdf', bytes: await pdf.save() },
        { name: 'logo.png', bytes: jpegBytes('logo', 4_000, 120, 40) },
      ]),
      at(0),
    );
    const docs = await docsOf((out as { messageId: string }).messageId);
    expect(docs.map((d) => [d.status, d.error])).toEqual([
      ['registered', null],
      ['skipped', 'inline_image'],
    ]);
    expect(await invoicesOfA()).toHaveLength(1);
    const [scan] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, docs[0]!.invoiceId!));
    expect(scan).toMatchObject({ mimeType: 'application/pdf', pageCount: 2, restaurantId: A.restaurantId });
  });

  it('a 3rd photo 11 min after the first → its own document, even from the same supplier', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('w-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('w-p2')]), at(3)));
    const p3 = await invoiceOf(await send(ch.wa, wa([jpegBytes('w-p3')]), at(11)));
    await ocr(p1, ACME);
    await ocr(p2, { ...ACME, invoiceNumber: null });
    expect(await ocr(p3, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: false, hold: false, flagged: [] });
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([p1, p3].sort());
  });

  it('settings.ingest.groupMinutes (5) is honoured', async () => {
    await setSettings({ multiPage: true, groupMinutes: 5 });
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('g-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('g-p2')]), at(6)));
    await ocr(p1, ACME);
    expect(await ocr(p2, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: false });
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('a page after page 1 was approved → not merged (flagged), page 1 untouched', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('ap-p1')]), at(0)));
    await ocr(p1, ACME);
    await ownerDb.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, p1));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('ap-p2')]), at(2)));
    const s2 = await ocr(p2, { ...ACME, invoiceNumber: null });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_not_merged' }]);
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1));
    expect(inv!.status).toBe('approved');
    expect(ocrCalls).toEqual([]);
  });

  it('a merged page leaves an audit row and its scan object stays in storage', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('au-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('au-p2')]), at(2)));
    const [page2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2));
    await ocr(p1, ACME);
    expect(await ocr(p2, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: true });
    const audit = await ownerDb.select().from(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.entityId, p2)));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'document.page_absorbed', entityType: 'invoice', userId: null, after: { absorbedInto: p1 } });
    expect(await localDocumentStorage().read(A.restaurantId, page2!.storagePath!)).not.toBeNull();
  });

  it('a page that anything references is never retired: claim, decided gap, receipt link, credit note', async () => {
    const cases: Array<[string, (inv: string) => Promise<void>]> = [
      ['claim', async (inv) => {
        const [run] = await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: inv, overallStatus: 'minor' }).returning();
        const [gap] = await ownerDb
          .insert(discrepancies)
          .values({ matchRunId: run!.id, restaurantId: A.restaurantId, type: 'PRICE_HIGHER', severity: 'warn' }) // undecided
          .returning();
        await ownerDb.insert(recoveryClaims).values({ restaurantId: A.restaurantId, discrepancyId: gap!.id, invoiceId: inv, amountAgorot: 500 });
      }],
      ['decided', async (inv) => {
        const [run] = await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: inv, overallStatus: 'minor' }).returning();
        await ownerDb.insert(discrepancies).values({ matchRunId: run!.id, restaurantId: A.restaurantId, type: 'PRICE_HIGHER', severity: 'warn', resolutionStatus: 'accepted' });
      }],
      ['receipt', async (inv) => {
        await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: inv, grId: A.grId, overallStatus: 'clean' });
      }],
      ['scan stamp', async (inv) => {
        await ownerDb.update(invoices).set({ ocrPayload: sql`jsonb_set(coalesce(${invoices.ocrPayload}, '{}'::jsonb), '{raw,scanGrId}', ${JSON.stringify(A.grId)}::jsonb, true)` }).where(eq(invoices.id, inv));
      }],
      ['credit note', async (inv) => {
        const [line] = await ownerDb
          .insert(invoiceLines)
          .values({ invoiceId: inv, rawDescription: 'credited', qtyBilled: '1', unit: 'unit', unitPriceBilled: '1.0000', lineTotal: '1.00' })
          .returning();
        await ownerDb.execute(
          sql`insert into credit_notes (restaurant_id, supplier_id, invoice_id, invoice_line_id, amount_agorot, issued_on, source)
              values (${A.restaurantId}, ${A.supplierId}, ${inv}, ${line!.id}, 100, '2026-11-02', 'invoice_line')`,
        );
      }],
    ];
    let minute = 0;
    for (const [label, link] of cases) {
      const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes(`ref-${label}-1`)]), at(minute)));
      const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes(`ref-${label}-2`)]), at(minute + 1)));
      await ocr(p1, { ...ACME, invoiceNumber: `A-${minute}` });
      await ownerDb.update(invoices).set({ status: 'matched', invoiceNumber: null, ocrPayload: { raw: { reconciled: { supplier: { name: ACME.supplierName, businessId: ACME.businessId } } } } as never }).where(eq(invoices.id, p2));
      await link(p2);
      const res = await withRestaurant(appDb, A.restaurantId, (tx) => settleDocumentPages(tx, { restaurantId: A.restaurantId, invoiceId: p2 }, { enqueueOcr: async () => {}, enqueueMatch: async () => {} }));
      expect({ label, res }).toMatchObject({ label, res: { absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_not_merged' }] } });
      expect(await ownerDb.select().from(invoices).where(eq(invoices.id, p2))).toHaveLength(1);
      expect(await ownerDb.select().from(auditLog).where(eq(auditLog.entityId, p2))).toHaveLength(0);
      minute += 30;
    }
  });

  it("merging into an already-matched page 1 resets its undecided match run (no stale gap)", async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('mr-p1')]), at(0)));
    await ocr(p1, ACME);
    await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p1, overallStatus: 'minor' });
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('mr-p2')]), at(2)));
    expect(await ocr(p2, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: true, mergedInto: p1 });
    expect(await ownerDb.select().from(matchRuns).where(eq(matchRuns.invoiceId, p1))).toHaveLength(0);
  });

  it('the same bytes re-sent → duplicate: no page, no OCR', async () => {
    const bytes = jpegBytes('same');
    const m1 = await send(ch.wa, wa([bytes]), at(0));
    const m2 = await send(ch.wa, wa([bytes]), at(1));
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    expect(d2).toMatchObject({ status: 'duplicate', invoiceId: d1!.invoiceId });
    expect(await ocrJobs(d1!.invoiceId!)).toHaveLength(1);
  });

  it('with features.multiPage OFF (the default, even with features.all) every page stays its own invoice', async () => {
    await setSettings({ all: true });
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('off-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('off-p2')]), at(2)));
    expect(await ocr(p1, ACME)).toEqual({ hold: false, absorbed: false, flagged: [] });
    expect(await ocr(p2, { ...ACME, invoiceNumber: null })).toEqual({ hold: false, absorbed: false, flagged: [] });
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('INGEST_MULTIPAGE_OFF=1 is a global kill switch (FEATURES_OFF=multiPage too)', async () => {
    process.env.INGEST_MULTIPAGE_OFF = '1';
    try {
      const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('k-p1')]), at(0)));
      const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('k-p2')]), at(2)));
      await ocr(p1, ACME);
      expect((await ocr(p2, { ...ACME, invoiceNumber: null })).absorbed).toBe(false);
      expect(await invoicesOfA()).toHaveLength(2);
    } finally {
      delete process.env.INGEST_MULTIPAGE_OFF;
    }
  });

  it("another restaurant's id settles nothing (tenant-scoped)", async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('t-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('t-p2')]), at(2)));
    await ocr(p1, ACME);
    const other = await seedTenant(ownerDb, 'X');
    const res = await withRestaurant(appDb, other.restaurantId, (tx) => settleDocumentPages(tx, { restaurantId: other.restaurantId, invoiceId: p2 }));
    expect(res).toEqual({ hold: false, absorbed: false, flagged: [] });
    expect(await invoicesOfA()).toHaveLength(2);
  });
});

describe('review documents and the mapping row', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it("an unknown sender's 2 photos → one review group; approved, OCR'd, same supplier → ONE invoice", async () => {
    const stranger = '972509999999';
    const m1 = await send(ch.wa, wa([pngBytes('u1')], { from: stranger }), at(0));
    const m2 = await send(ch.wa, wa([pngBytes('u2')], { from: stranger }), at(2));
    expect(m1.status).toBe('needs_review');
    expect(m2.status).toBe('needs_review');
    expect(await invoicesOfA()).toHaveLength(0);
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    const reg = await withRestaurant(appDb, A.restaurantId, (tx) =>
      registerReviewGroup(tx, { restaurantId: A.restaurantId, documentId: d1!.id, kind: 'whatsapp', supplierId: A.supplierId, userId: A.ownerUserId }),
    );
    expect(reg.documentIds.sort()).toEqual([d1!.id, d2!.id].sort());
    expect(reg.invoiceIds).toHaveLength(2);
    await ocr(reg.invoiceIds[0]!, ACME);
    expect(await ocr(reg.invoiceIds[1]!, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: true });
    expect(await invoicesOfA()).toHaveLength(1);
    expect(await pdfPagesOf(reg.invoiceIds[0]!)).toBe(2);
  });

  it('invoice_scans.invoice_id is the invoice UUID, with page_count', async () => {
    const id = await invoiceOf(await send(ch.wa, wa([jpegBytes('map-1')]), at(0)));
    const rows = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.restaurantId, A.restaurantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ invoiceId: id, pageCount: 1, mimeType: 'image/jpeg' });
    expect(rows[0]!.storagePath.startsWith(`${A.restaurantId}/`)).toBe(true);
    expect(await ocrJobs(id)).toEqual([{ dedupe_key: `ocr:${id}:1` }]);
  });

  it('a new invoice row never stores an expiring signed URL (a stable object form)', async () => {
    const id = await invoiceOf(await send(ch.wa, wa([jpegBytes('stable')]), at(0)));
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, id));
    expect(inv!.rawImageUrl).not.toMatch(/[?&]token=/);
    expect(toObjectRef(inv!.rawImageUrl!, A.restaurantId)).toBeTruthy();
  });
});
