/**
 * G-09 · documents/{compose,objectRef,attach}: one document = one PDF = one
 * invoice. Local dev storage (LOCAL_SCAN_DIR), stub provider, no paid OCR.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAuditImmutableRls,
  auditLog,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestSenders,
  invoiceScans,
  invoices,
  matchRuns,
  recoveryClaims,
  restaurants,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { StubIngestProvider, type InboundMessage } from '@restomatch/ingest';
import { composeDocument, composedPathFor } from '../documents/compose';
import { DocumentError } from '../documents/errors';
import { attachAsPage, splitDocument } from '../documents/attach';
import { storedImageValue, toObjectRef } from '../documents/objectRef';
import { localDocumentStorage, type DocumentStorage } from '../documents/storage';
import { processInboundMessage, type OcrJobToEnqueue, type ResolvedChannel } from '../ingest/pipeline';
import { deterministicScanId } from '../routers/scans';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { jpegBytes, pngBytes, webpBytes } from './documentTestKit';

process.env.LOCAL_SCAN_DIR = mkdtempSync(join(tmpdir(), 'document-compose-'));

/** Local storage that counts reads per path and can fail writes. */
function spyStorage(opts: { failWrite?: boolean } = {}) {
  const base = localDocumentStorage();
  const reads = new Map<string, number>();
  const storage: DocumentStorage = {
    async read(r, p) {
      reads.set(p, (reads.get(p) ?? 0) + 1);
      return base.read(r, p);
    },
    async write(r, p, b, m) {
      if (opts.failWrite) throw new Error('injected write failure');
      return base.write(r, p, b, m);
    },
    remove: (r, ps) => base.remove(r, ps),
  };
  return { storage, reads };
}

async function putPage(restaurantId: string, tag: string, bytes: Uint8Array, ext = 'jpg'): Promise<string> {
  const path = `${restaurantId}/${deterministicScanId(restaurantId, `page:${tag}`)}.${ext}`;
  await localDocumentStorage().write(restaurantId, path, bytes, ext === 'png' ? 'image/png' : 'image/jpeg');
  return path;
}

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DocumentError) return err.reason;
    return (err as { code?: string }).code ?? String(err);
  }
  return 'resolved';
}

describe('composeDocument', () => {
  const R = randomUUID();

  it('3 JPEG pages → one 3-page PDF at the deterministic object, in array order', async () => {
    const pages = [await putPage(R, 'a1', jpegBytes('a1')), await putPage(R, 'a2', pngBytes('a2'), 'png'), await putPage(R, 'a3', jpegBytes('a3', 1_000, 1_000, 500))];
    const out = await composeDocument({ restaurantId: R, clientDocumentId: 'doc-a', pageObjects: pages });
    expect(out).toMatchObject({ storagePath: `${R}/${deterministicScanId(R, 'doc-a')}.pdf`, pageCount: 3, created: true });
    const bytes = await localDocumentStorage().read(R, out.storagePath);
    const pdf = await PDFDocument.load(bytes!);
    expect(pdf.getPageCount()).toBe(3);
    // Page 3 is landscape (1000×500): order is kept.
    const [w, h] = [pdf.getPage(2).getWidth(), pdf.getPage(2).getHeight()];
    expect(w).toBeGreaterThan(h);
    // Pages are deleted only after the successful write (default for dock capture).
    for (const p of pages) expect(await localDocumentStorage().read(R, p)).toBeNull();
  });

  it('the same clientDocumentId twice → the same object and sha256; the pages are not read again', async () => {
    const pages = [await putPage(R, 'b1', jpegBytes('b1')), await putPage(R, 'b2', jpegBytes('b2'))];
    const first = await composeDocument({ restaurantId: R, clientDocumentId: 'doc-b', pageObjects: pages, deletePages: false });
    const spy = spyStorage();
    const again = await composeDocument({ restaurantId: R, clientDocumentId: 'doc-b', pageObjects: pages }, { storage: spy.storage });
    expect(again).toEqual({ ...first, created: false });
    for (const p of pages) expect(spy.reads.get(p) ?? 0).toBe(0);
  });

  it("a page under another restaurant's prefix, a traversal and a missing object → the same NOT_FOUND", async () => {
    const other = randomUUID();
    const foreign = await putPage(other, 'f1', jpegBytes('f1'));
    const mine = await putPage(R, 'c1', jpegBytes('c1'));
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'c-1', pageObjects: [mine, foreign] }))).toBe('NOT_FOUND');
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'c-2', pageObjects: [`${R}/../${foreign}`] }))).toBe('NOT_FOUND');
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'c-3', pageObjects: [`${R}/scan-zz-0000ffff.jpg`] }))).toBe('NOT_FOUND');
    // The foreign object is untouched.
    expect(await localDocumentStorage().read(other, foreign)).not.toBeNull();
  });

  it('webp → unsupported_page_type (sniffed by magic bytes, not the extension)', async () => {
    const disguised = await putPage(R, 'w1', webpBytes(), 'jpg');
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'w', pageObjects: [disguised] }))).toBe('unsupported_page_type');
  });

  it('over the 10 MB attachment limit → too_large', async () => {
    const big = [await putPage(R, 'big1', jpegBytes('big1', 6_000_000)), await putPage(R, 'big2', jpegBytes('big2', 6_000_000))];
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'big', pageObjects: big }))).toBe('too_large');
  });

  it('empty and oversized page lists are named refusals', async () => {
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'e', pageObjects: [] }))).toBe('no_pages');
    const p = await putPage(R, 'many', jpegBytes('many'));
    expect(await reason(composeDocument({ restaurantId: R, clientDocumentId: 'm', pageObjects: Array(21).fill(p) }))).toBe('too_many_pages');
  });

  it('a failed write keeps every page (nothing deleted before the object exists)', async () => {
    const pages = [await putPage(R, 'd1', jpegBytes('d1')), await putPage(R, 'd2', jpegBytes('d2'))];
    const spy = spyStorage({ failWrite: true });
    await expect(composeDocument({ restaurantId: R, clientDocumentId: 'doc-d', pageObjects: pages }, { storage: spy.storage })).rejects.toThrow(
      /injected/,
    );
    for (const p of pages) expect(await localDocumentStorage().read(R, p)).not.toBeNull();
    expect(await localDocumentStorage().read(R, composedPathFor(R, 'doc-d'))).toBeNull();
  });
});

describe('toObjectRef', () => {
  const R = randomUUID();
  const path = `${R}/scan-abc123-0123abcd.jpg`;

  it('a legacy signed URL and a path → the same ref', () => {
    const signed = `https://proj.supabase.co/storage/v1/object/sign/invoice-scans/${path}?token=eyJ.x.y`;
    expect(toObjectRef(signed, R)).toBe(path);
    expect(toObjectRef(`https://proj.supabase.co/storage/v1/object/sign/invoice-scans/${path}`, R)).toBe(path);
    expect(toObjectRef(path, R)).toBe(path);
  });

  it('the local dev URL → the extension-less ref of the same object', () => {
    expect(toObjectRef('http://localhost:3000/scans/scan-abc123-0123abcd/file', R)).toBe(`${R}/scan-abc123-0123abcd`);
  });

  it('with a bucket configured a new row stores the bare path (no token), which maps back to itself', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    try {
      expect(storedImageValue(R, path)).toBe(path);
      expect(toObjectRef(storedImageValue(R, path), R)).toBe(path);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('another tenant, traversal, other buckets and junk → null', () => {
    const other = randomUUID();
    expect(toObjectRef(`${other}/scan-abc123-0123abcd.jpg`, R)).toBeNull();
    expect(toObjectRef(`https://proj.supabase.co/storage/v1/object/sign/invoice-scans/${other}/scan-a-1.jpg?token=t`, R)).toBeNull();
    expect(toObjectRef(`${R}/../${other}/scan-a-1.jpg`, R)).toBeNull();
    expect(toObjectRef(`https://proj.supabase.co/storage/v1/object/sign/other-bucket/${path}`, R)).toBeNull();
    expect(toObjectRef(`${R}/sub/scan-a-1.jpg`, R)).toBeNull();
    expect(toObjectRef('https://evil.example/x.jpg', R)).toBeNull();
  });
});

/* ───────────────────────── attach / split (DB) ───────────────────────── */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let wa: ResolvedChannel;
let provider: StubIngestProvider;
let seq = 0;
const T0 = new Date('2026-11-02T08:00:00Z');
const PHONE = '972501111111';
let enqueued: OcrJobToEnqueue[] = [];
const capture = async (jobs: OcrJobToEnqueue[]) => {
  enqueued.push(...jobs);
};

/** One WhatsApp photo at T0 + `min` → its invoice id. */
async function photoInvoice(tag: string, min: number): Promise<string> {
  const id = `wamid.c${++seq}`;
  provider.register(id, { bytes: jpegBytes(tag), mimeType: 'image/jpeg' });
  const m: InboundMessage = {
    kind: 'whatsapp',
    providerMessageId: id,
    sender: PHONE,
    subject: null,
    sentAtSec: null,
    phoneNumberId: null,
    authVerdict: 'pass',
    attachments: [{ filename: null, declaredMime: 'image/jpeg', declaredSize: null, providerRef: id }],
  };
  const out = await processInboundMessage(appDb, wa, m, provider, { now: new Date(T0.getTime() + min * 60_000) });
  const [d] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.messageId, (out as { messageId: string }).messageId));
  return d!.invoiceId!;
}

async function pagesOf(invoiceId: string): Promise<number> {
  const [scan] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, invoiceId));
  const bytes = await localDocumentStorage().read(A.restaurantId, scan!.storagePath);
  if (Buffer.from(bytes!.subarray(0, 5)).toString('latin1') !== '%PDF-') return 1;
  return (await PDFDocument.load(bytes!)).getPageCount();
}

async function setMultiPage(on: boolean) {
  await ownerDb
    .update(restaurants)
    .set({ settings: { features: { ingestWhatsapp: true, multiPage: on } } as never })
    .where(eq(restaurants.id, A.restaurantId));
}

const asA = <T>(fn: (tx: Database) => Promise<T>) => withRestaurant(appDb, A.restaurantId, fn);

describe('attachAsPage / splitDocument', () => {
  beforeAll(async () => {
    await applyCoreTenantRls(TEST_DB_URL);
    await applyAuditImmutableRls(TEST_DB_URL);
    await applyAuthCredentialTables(TEST_DB_URL);
    appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  });

  beforeEach(async () => {
    await resetDb(ownerDb);
    A = await seedTenant(ownerDb, 'A');
    B = await seedTenant(ownerDb, 'B');
    const [c] = await ownerDb
      .insert(ingestChannels)
      .values({ restaurantId: A.restaurantId, kind: 'whatsapp', tokenHash: `h-${randomUUID()}`, tokenHint: 'wa' })
      .returning({ id: ingestChannels.id });
    wa = { channelId: c!.id, restaurantId: A.restaurantId, kind: 'whatsapp', phoneNumberId: null };
    await ownerDb.insert(ingestSenders).values({ restaurantId: A.restaurantId, kind: 'whatsapp', sender: PHONE, supplierId: A.supplierId });
    provider = new StubIngestProvider('whatsapp');
    enqueued = [];
    await setMultiPage(true);
  });

  afterAll(async () => {
    await resetDb(ownerDb);
  });

  it('a split pair (30 min apart) → attach → 1 invoice, 2 pages, ONE OCR job for it', async () => {
    const first = await photoInvoice('pair-1', 0);
    const second = await photoInvoice('pair-2', 30);
    expect(second).not.toBe(first);
    const res = await asA((tx) =>
      attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second, userId: A.ownerUserId }, { enqueue: capture }),
    );
    expect(res).toMatchObject({ invoiceId: first, absorbedInvoiceId: second, pageCount: 2, ocrEnqueued: true });
    const [audit] = await ownerDb.select().from(auditLog).where(eq(auditLog.entityId, second));
    expect(audit).toMatchObject({ action: 'document.page_absorbed', userId: A.ownerUserId, after: { absorbedInto: first } });
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, second))).toHaveLength(0);
    const docs = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.restaurantId, A.restaurantId));
    expect(new Set(docs.map((d) => d.invoiceId))).toEqual(new Set([first]));
    expect(await pagesOf(first)).toBe(2);
    expect(enqueued.map((j) => [j.invoiceId, j.dedupeKey])).toEqual([[first, `ocr:${first}:2`]]);
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, first));
    expect(inv!.status).toBe('ocr_pending');
  });

  it('pageIndex 0 puts the absorbed page first', async () => {
    const first = await photoInvoice('idx-1', 0);
    const second = await photoInvoice('idx-2', 30);
    await asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second, pageIndex: 0 }, { enqueue: capture }));
    const docs = await ownerDb
      .select()
      .from(ingestDocuments)
      .where(eq(ingestDocuments.invoiceId, first))
      .orderBy(ingestDocuments.createdAt, ingestDocuments.id);
    expect(docs).toHaveLength(2);
    expect(docs[0]!.sha256).not.toBe(docs[1]!.sha256);
    // The earlier-registered page of `second` now sorts first.
    expect(docs[0]!.sha256).toBe(createHash('sha256').update(jpegBytes('idx-2')).digest('hex'));
  });

  it('refused when the absorbed invoice has a decided פער, or a claim; nothing changes', async () => {
    const first = await photoInvoice('dec-1', 0);
    const second = await photoInvoice('dec-2', 30);
    const [run] = await ownerDb
      .insert(matchRuns)
      .values({ restaurantId: A.restaurantId, invoiceId: second, overallStatus: 'minor' })
      .returning({ id: matchRuns.id });
    const [gap] = await ownerDb
      .insert(discrepancies)
      .values({ matchRunId: run!.id, restaurantId: A.restaurantId, type: 'PRICE_HIGHER', severity: 'warn', resolutionStatus: 'accepted' })
      .returning({ id: discrepancies.id });
    expect(await reason(asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second }, { enqueue: capture })))).toBe(
      'decided',
    );
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, gap!.id));
    await ownerDb.insert(recoveryClaims).values({ restaurantId: A.restaurantId, discrepancyId: gap!.id, invoiceId: second, amountAgorot: 1_000 });
    expect(await reason(asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second }, { enqueue: capture })))).toBe(
      'has_claim',
    );
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, second))).toHaveLength(1);
    expect(enqueued).toHaveLength(0);
  });

  it('refused for an approved invoice, a receipt-linked absorbed invoice, and while features.multiPage is off', async () => {
    const first = await photoInvoice('st-1', 0);
    const second = await photoInvoice('st-2', 30);
    await ownerDb.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, first));
    expect(await reason(asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second }, { enqueue: capture })))).toBe(
      'approved_or_paid',
    );
    await ownerDb.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, first));
    await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: second, grId: A.grId, overallStatus: 'clean' });
    expect(await reason(asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second }, { enqueue: capture })))).toBe(
      'linked',
    );
    await setMultiPage(false);
    expect(await reason(asA((tx) => splitDocument(tx, { restaurantId: A.restaurantId, invoiceId: second, pages: [[0]] }, { enqueue: capture })))).toBe(
      'reocr_not_enabled',
    );
  });

  it('splitDocument → 2 invoices, each composed and OCR’d once', async () => {
    const first = await photoInvoice('sp-1', 0);
    const second = await photoInvoice('sp-2', 3);
    await asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: first, documentId: second }, { enqueue: capture }));
    expect(await pagesOf(first)).toBe(2);
    enqueued = [];
    expect(await reason(asA((tx) => splitDocument(tx, { restaurantId: A.restaurantId, invoiceId: first, pages: [[0], [0]] }, { enqueue: capture })))).toBe(
      'invalid_split',
    );
    const res = await asA((tx) => splitDocument(tx, { restaurantId: A.restaurantId, invoiceId: first, pages: [[0], [1]] }, { enqueue: capture }));
    expect(res.invoiceIds).toHaveLength(2);
    expect(res.invoiceIds[0]).toBe(first);
    const [, other] = res.invoiceIds;
    expect(await pagesOf(first)).toBe(1);
    expect(await pagesOf(other!)).toBe(1);
    expect(enqueued.map((j) => j.invoiceId).sort()).toEqual([...res.invoiceIds].sort());
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, other!));
    expect(inv).toMatchObject({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'ocr_pending', source: 'whatsapp' });
  });

  it("a foreign invoiceId → NOT_FOUND, and B's invoice is untouched", async () => {
    const mine = await photoInvoice('fx-1', 0);
    const theirs = B.invoiceId;
    expect(await reason(asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: mine, documentId: theirs }, { enqueue: capture })))).toBe(
      'NOT_FOUND',
    );
    expect(await reason(asA((tx) => splitDocument(tx, { restaurantId: A.restaurantId, invoiceId: theirs, pages: [[0], [1]] }, { enqueue: capture })))).toBe(
      'NOT_FOUND',
    );
    expect(await reason(asA((tx) => attachAsPage(tx, { restaurantId: A.restaurantId, invoiceId: mine, documentId: 'not-a-uuid' }, { enqueue: capture })))).toBe(
      'NOT_FOUND',
    );
    const [b] = await ownerDb.select().from(invoices).where(eq(invoices.id, theirs));
    expect(b!.restaurantId).toBe(B.restaurantId);
    expect(enqueued).toHaveLength(0);
  });
});

