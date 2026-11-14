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
import { decidePages, settleDocumentPages, windowCloseGate, WINDOW_MAX_ATTEMPTS, WINDOW_RETRY_MS, WINDOW_LONG_RETRY_MS, WINDOW_CEILING_ATTEMPTS, type PageHeader, type SettleResult } from '../documents/settle';
import { resolvePageFlag } from '../documents/resolve';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { toObjectRef } from '../documents/objectRef';
import { localDocumentStorage } from '../documents/storage';
import { splitDocument } from '../documents/attach';
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
  /** writeOcrHeader's duplicate branch: number blanked, raw.duplicateOf set. */
  duplicateOf?: { invoiceId: string | null; invoiceNumber: string };
  /** markOcrFailed: no lines, raw.ocrFailed. */
  failed?: boolean;
  /** Line content (default: unique per invoice). Same content = a re-shot photo. */
  lineTotal?: string;
  lines?: Array<{ qty: string; total: string; desc?: string; unitPrice?: string }>;
  totalInclVat?: string;
  /** A whole invoice on its own: totalExclVat = the lines' sum (selfComplete). */
  totalExclVat?: string;
  /** raw.reviewReasons the read wrote (round 9: reasons can outlive their hold). */
  reviewReasons?: string[];
}
const ACME: OcrHead = { supplierName: 'תנובה בע"מ', businessId: '51-000123-4', invoiceNumber: 'A-100' };
const OTHER: OcrHead = { supplierName: 'שטראוס', businessId: '52-999888-7', invoiceNumber: 'S-7' };

let matchCalls: string[] = [];
let lineSeq = 0;
let delayedCalls: Array<{ invoiceId: string; runAt: Date }> = [];

/** The object id (scan-…) an invoice points at: the OCR dedupe key's suffix. */
async function objectOf(invoiceId: string): Promise<string> {
  const [scan] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, invoiceId));
  return scan!.storagePath.split('/')[1]!.replace(/\.[a-z0-9]+$/i, '');
}
let ocrCalls: Array<{ invoiceId: string; dedupeKey?: string }> = [];

/**
 * Play the OCR worker for one invoice: header + one line (as writeOcrHeader +
 * the line insert do), then the settle hook. Returns its verdict.
 */
async function ocr(invoiceId: string, head: OcrHead): Promise<SettleResult> {
  await writeOcr(invoiceId, head);
  return settle(invoiceId);
}

/** The worker's writes for one page (writeOcrHeader + lines, or markOcrFailed). */
async function writeOcr(invoiceId: string, head: OcrHead): Promise<void> {
  const raw = head.failed
    ? { ocrFailed: true, reason: 'provider error' }
    : {
        reconciled: { supplier: { name: head.supplierName, businessId: head.businessId }, invoiceNumber: head.invoiceNumber },
        ...(head.duplicateOf ? { duplicateOf: head.duplicateOf } : {}),
        ...(head.reviewReasons ? { reviewReasons: head.reviewReasons } : {}),
      };
  await ownerDb
    .update(invoices)
    .set({
      status: head.failed || head.duplicateOf ? 'parsed' : (head.status ?? 'matched'),
      invoiceNumber: head.duplicateOf || head.failed ? null : (head.invoiceNumber ?? null),
      totalInclVat: head.totalInclVat ?? null,
      totalExclVat: head.totalExclVat ?? null,
      ocrPayload: { provider: 'stub', raw } as never,
    })
    .where(eq(invoices.id, invoiceId));
  await ownerDb.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  if (head.failed) return;
  // Default content is unique per page (its own quantity and total), so two
  // different pages never look like a re-shot copy of each other.
  lineSeq += 1;
  const lines: Array<{ qty: string; total: string; desc?: string; unitPrice?: string }> = head.lines ?? [
    { qty: String(lineSeq), total: `${100 + lineSeq * 37}.00`, desc: `item ${lineSeq} unique` },
  ];
  if (head.lineTotal) lines.splice(0, lines.length, { qty: '1', total: head.lineTotal, desc: 'עגבניות שרי' });
  await ownerDb.insert(invoiceLines).values(
    lines.map((l, i) => ({
      invoiceId,
      rawDescription: l.desc ?? `line ${i} item`,
      qtyBilled: l.qty,
      unit: 'unit',
      unitPriceBilled: l.unitPrice ?? '10.0000',
      lineTotal: l.total,
    })),
  );
}

/** The settle hook, exactly where the worker calls it. */
async function settle(invoiceId: string, now = new Date('2027-01-01T00:00:00Z')): Promise<SettleResult> {
  return withRestaurant(appDb, A.restaurantId, (tx) =>
    settleDocumentPages(
      tx,
      { restaurantId: A.restaurantId, invoiceId, now },
      {
        enqueueOcr: async (jobs) => {
          ocrCalls.push(...jobs.map((j) => ({ invoiceId: j.invoiceId, dedupeKey: j.dedupeKey })));
        },
        enqueueMatch: async (j) => {
          matchCalls.push(j.invoiceId);
        },
        enqueueDelayedMatch: async (j, runAt) => {
          delayedCalls.push({ invoiceId: j.invoiceId, runAt });
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
    expect(ocrCalls).toEqual([{ invoiceId: p1, dedupeKey: `ocr:${p1}:${await objectOf(p1)}:1` }]); // re-open generation 1
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

  it('after a flagged page NOTHING later merges into page 1, even with page 1\'s own number', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('f-p1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('f-p2')]), at(1)));
    const p3 = await invoiceOf(await send(ch.wa, wa([jpegBytes('f-p3')]), at(2)));
    await ocr(p1, ACME);
    await ocr(p2, OTHER);
    const s3 = await ocr(p3, { ...ACME, invoiceNumber: 'A 100' }); // same number, other spacing
    expect(s3.flagged).toEqual([
      { invoiceId: p2, reason: 'page_other_supplier' },
      { invoiceId: p3, reason: 'page_not_merged' },
    ]);
    expect(s3.absorbed).toBe(false);
    expect(await invoicesOfA()).toHaveLength(3);
  });
});

const pages = async (n: number, tag: string, gapMin = 1, startMin = 0) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await invoiceOf(await send(ch.wa, wa([jpegBytes(`${tag}-${i}`)]), at(startMin + i * gapMin))));
  return ids;
};
const NOHEAD: OcrHead = { invoiceNumber: null };
const linesOf = async (id: string) => ownerDb.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));

describe('review fixes: false-leak paths (CRITICAL-1/2, HIGH-1)', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('CRITICAL-1: a page whose number is ANOTHER invoice already on file is never a continuation', async () => {
    const [p1, p2] = await pages(2, 'c1a');
    await ocr(p1!, ACME);
    const s2 = await ocr(p2!, { ...ACME, duplicateOf: { invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber } });
    expect(s2).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_other_invoice' }] });
    expect(await invoicesOfA()).toHaveLength(2);
    expect(ocrCalls).toEqual([]);
  });

  it('CRITICAL-1: a new invoice after a duplicate page 1 keeps its own number (effective numbers compared)', async () => {
    const [p1, p2] = await pages(2, 'c1b');
    await ocr(p1!, { ...ACME, duplicateOf: { invoiceId: A.invoiceId, invoiceNumber: 'A-100' } });
    const s2 = await ocr(p2!, { ...ACME, invoiceNumber: 'A-555' });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_other_invoice' }]);
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('CRITICAL-1: a real page 2 that repeats page 1\'s number (blanked against page 1 itself) still merges', async () => {
    const [p1, p2] = await pages(2, 'c1c');
    await ocr(p1!, ACME);
    const s2 = await ocr(p2!, { ...ACME, duplicateOf: { invoiceId: p1!, invoiceNumber: 'A-100' } });
    expect(s2).toMatchObject({ absorbed: true, mergedInto: p1 });
    expect(await pdfPagesOf(p1!)).toBe(2);
  });

  it('HIGH-1: a re-shot photo of page 1 (same number, same content) is flagged page_duplicate, never merged', async () => {
    const [p1, p2] = await pages(2, 'h1');
    await ocr(p1!, { ...ACME, lineTotal: '77.00', totalInclVat: '90.86' });
    const s2 = await ocr(p2!, { ...ACME, duplicateOf: { invoiceId: p1!, invoiceNumber: 'A-100' }, lineTotal: '77.00', totalInclVat: '90.86' });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_duplicate', repeats: p1 }]);
    expect(await invoicesOfA()).toHaveLength(2);
    const [dup] = await ownerDb.select().from(invoices).where(eq(invoices.id, p2!));
    expect(dup!.status).toBe('parsed'); // the duplicate hold stays for a human
    expect(ocrCalls).toEqual([]);
  });

  it('CRITICAL-2 v1: [ACME, OTHER, header-less] → the header-less page is NOT summed into ACME', async () => {
    const [p1, p2, p3] = await pages(3, 'c2v1');
    await ocr(p1!, ACME);
    await ocr(p2!, OTHER);
    const s3 = await ocr(p3!, NOHEAD);
    expect(s3.absorbed).toBe(false);
    expect(s3.flagged).toEqual([
      { invoiceId: p2, reason: 'page_other_supplier' },
      { invoiceId: p3, reason: 'page_not_merged' },
    ]);
    expect(await linesOf(p1!)).toHaveLength(1);
    expect(await invoicesOfA()).toHaveLength(3);
  });

  it('CRITICAL-2 v2: [ACME, header-less, OTHER, header-less] → only the page right after ACME joins it', async () => {
    const [p1, p2, p3, p4] = await pages(4, 'c2v2');
    await ocr(p1!, ACME);
    await ocr(p2!, NOHEAD);
    await ocr(p3!, OTHER);
    const s4 = await ocr(p4!, NOHEAD);
    expect(s4.flagged).toEqual([
      { invoiceId: p3, reason: 'page_other_supplier' },
      { invoiceId: p4, reason: 'page_not_merged' },
    ]);
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([p1, p3, p4].sort());
    expect(await pdfPagesOf(p1!)).toBe(2);
  });

  it('CRITICAL-2 v3: [ACME A-100, ACME A-200, header-less] → A-200\'s continuation is not summed into A-100', async () => {
    const [p1, p2, p3] = await pages(3, 'c2v3');
    await ocr(p1!, ACME);
    await ocr(p2!, { ...ACME, invoiceNumber: 'A-200' });
    const s3 = await ocr(p3!, NOHEAD);
    expect(s3.flagged).toEqual([
      { invoiceId: p2, reason: 'page_other_invoice' },
      { invoiceId: p3, reason: 'page_not_merged' },
    ]);
    expect(await invoicesOfA()).toHaveLength(3);
  });

  it('CRITICAL-2 v4: a failed read or a no-lines page is never a continuation, and breaks the chain', async () => {
    const [p1, p2, p3] = await pages(3, 'c2v4');
    await ocr(p1!, ACME);
    await ocr(p2!, { failed: true });
    const s3 = await ocr(p3!, NOHEAD);
    expect(s3.flagged).toEqual([
      { invoiceId: p2, reason: 'page_unreadable' },
      { invoiceId: p3, reason: 'page_not_merged' },
    ]);
    expect(await invoicesOfA()).toHaveLength(3);
    // A 'parsed' page with no lines is unreadable too.
    const [q1, q2] = await pages(2, 'c2v4b', 1, 60); // a later, separate cluster
    await ocr(q1!, { ...ACME, invoiceNumber: 'A-9' });
    await writeOcr(q2!, { ...NOHEAD, status: 'parsed' });
    await ownerDb.delete(invoiceLines).where(eq(invoiceLines.invoiceId, q2!));
    expect((await settle(q2!)).flagged).toEqual([{ invoiceId: q2, reason: 'page_unreadable' }]);
  });
});

describe('review fixes: stranded clusters and ₪ hygiene (HIGH-2/3, MEDIUM-1, U-2)', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('HIGH-2: a sibling whose OCR fails terminally releases the held page 1 to the match', async () => {
    const [p1, p2] = await pages(2, 'h2');
    expect((await ocr(p1!, ACME)).hold).toBe(true);
    // The worker's catch: markOcrFailed, then the G-09 release (settle).
    const s2 = await ocr(p2!, { failed: true });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_unreadable' }]);
    expect(matchCalls).toEqual([p1]);
  });

  it('HIGH-3: pages summing above the 10 MB limit are not merged; flagged, page 1 released, no rollback loop', async () => {
    const big = (t: string) => jpegBytes(t, 6_000_000);
    const p1 = await invoiceOf(await send(ch.wa, wa([big('h3-1')]), at(0)));
    const p2 = await invoiceOf(await send(ch.wa, wa([big('h3-2')]), at(1)));
    expect((await ocr(p1, ACME)).hold).toBe(true);
    const s2 = await ocr(p2, NOHEAD);
    expect(s2).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_too_large' }] });
    expect(matchCalls).toEqual([p1]);
    // Settling again is stable: the flagged page left the cluster.
    expect(await settle(p2)).toEqual({ hold: false, absorbed: false, flagged: [] });
  });

  it('HIGH-3: a compose failure inside the merge rolls back ONLY the merge; pages flagged, page 1 released', async () => {
    const [p1, p2] = await pages(2, 'h3b');
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    expect((await ocr(p1!, ACME)).hold).toBe(true);
    await localDocumentStorage().remove(A.restaurantId, [d2!.storagePath!]); // the page object vanished
    const s2 = await ocr(p2!, NOHEAD);
    expect(s2).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_merge_blocked' }] });
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([p1, p2].sort());
    const [one] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1!));
    expect(one!.status).toBe('matched'); // the re-open was rolled back
    expect(await linesOf(p1!)).toHaveLength(1);
    expect(matchCalls).toEqual([p1]);
  });

  it('MEDIUM-1: re-opening page 1 for the composed re-OCR clears its lines and totals', async () => {
    const [p1, p2] = await pages(2, 'm1');
    await ocr(p1!, { ...ACME, totalInclVat: '118.00' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true);
    expect(await linesOf(p1!)).toHaveLength(0);
    const [one] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1!));
    expect(one).toMatchObject({ status: 'ocr_pending', totalInclVat: null, totalExclVat: null, vatAmount: null });
  });

  it('U-2: with the switch OFF a small e-mail image is registered as before (not skipped)', async () => {
    await setSettings({});
    const out = await send(ch.email, mail([{ name: 'small.jpg', bytes: jpegBytes('u2-small', 4_000) }]), at(0));
    const docs = await docsOf((out as { messageId: string }).messageId);
    expect(docs.map((d) => [d.status, d.error])).toEqual([['registered', null]]);
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
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_merge_blocked' }]);
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
      await writeOcr(p2, { supplierName: ACME.supplierName, businessId: ACME.businessId, invoiceNumber: null });
      await link(p2);
      const res = await withRestaurant(appDb, A.restaurantId, (tx) => settleDocumentPages(tx, { restaurantId: A.restaurantId, invoiceId: p2 }, { enqueueOcr: async () => {}, enqueueMatch: async () => {} }));
      expect({ label, res }).toMatchObject({ label, res: { absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_merge_blocked' }] } });
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
    expect(await ocrJobs(id)).toEqual([{ dedupe_key: `ocr:${id}:${await objectOf(id)}:0` }]);
  });

  it('a new invoice row never stores an expiring signed URL (a stable object form)', async () => {
    const id = await invoiceOf(await send(ch.wa, wa([jpegBytes('stable')]), at(0)));
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, id));
    expect(inv!.rawImageUrl).not.toMatch(/[?&]token=/);
    expect(toObjectRef(inv!.rawImageUrl!, A.restaurantId)).toBeTruthy();
  });
});

describe('re-review fixes (C-1, C-2, H-1)', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('C-1: a page sent AFTER a flagged page has settled is not merged into page 1 (other supplier / failed read / other number)', async () => {
    const variants: Array<[string, OcrHead]> = [
      ['other supplier', OTHER],
      ['failed read', { failed: true }],
      ['other number', { ...ACME, invoiceNumber: 'A-200' }],
    ];
    let start = 0;
    for (const [label, p2Head] of variants) {
      const [p1, p2] = await pages(2, `c1-${start}`, 1, start);
      await ocr(p1!, { ...ACME, invoiceNumber: `A-${start}` });
      const s2 = await ocr(p2!, p2Head);
      expect({ label, flagged: s2.flagged.length }).toEqual({ label, flagged: 1 });
      // Two minutes later, OTHER's (or A-200's) header-less page 2 arrives.
      const p3 = await invoiceOf(await send(ch.wa, wa([jpegBytes(`c1-${start}-late`)]), at(start + 3)));
      const s3 = await ocr(p3, NOHEAD);
      expect({ label, s3 }).toMatchObject({ label, s3: { absorbed: false, flagged: [{ invoiceId: p3, reason: 'page_not_merged' }] } });
      expect(await linesOf(p1!)).toHaveLength(1); // nothing summed into page 1
      start += 60;
    }
    expect(ocrCalls).toEqual([]);
  });

  it('C-2 (a): a header-less page 1 absorbs nothing, not even a page with a full ח.פ. + number', async () => {
    const [p1, p2] = await pages(2, 'c2a');
    await ocr(p1!, NOHEAD);
    const s2 = await ocr(p2!, OTHER);
    expect(s2).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_not_merged' }] });
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('C-2 (b): a blurry page 1 (nothing readable) and its re-shot with a full header are never merged (no doubled lines)', async () => {
    const [p1, p2] = await pages(2, 'c2b');
    const L = [{ qty: '3', total: '77.00' }, { qty: '2', total: '40.00' }];
    await ocr(p1!, { ...NOHEAD, lines: L });
    const s2 = await ocr(p2!, { ...ACME, lines: [{ qty: '3', total: '77.10' }, { qty: '2', total: '40.00' }] });
    expect(s2.absorbed).toBe(false);
    expect(s2.flagged).toHaveLength(1);
    expect(['page_duplicate', 'page_not_merged']).toContain(s2.flagged[0]!.reason);
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('C-2 (c): the 10-min anchor — X = A-100 at t0/t5/t11 (t11 header-less), Y = A-200 at t12/t13 → Y is not absorbed by t11', async () => {
    const x0 = await invoiceOf(await send(ch.wa, wa([jpegBytes('c2c-x0')]), at(0)));
    const x5 = await invoiceOf(await send(ch.wa, wa([jpegBytes('c2c-x5')]), at(5)));
    const x11 = await invoiceOf(await send(ch.wa, wa([jpegBytes('c2c-x11')]), at(11)));
    const y12 = await invoiceOf(await send(ch.wa, wa([jpegBytes('c2c-y12')]), at(12)));
    const y13 = await invoiceOf(await send(ch.wa, wa([jpegBytes('c2c-y13')]), at(13)));
    await ocr(x0, ACME);
    expect((await ocr(x5, NOHEAD)).absorbed).toBe(true); // X's page 2 joins A-100
    await ocr(x11, NOHEAD);
    await ocr(y12, { ...ACME, invoiceNumber: 'A-200' });
    const s = await ocr(y13, NOHEAD);
    expect(s.absorbed).toBe(false);
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([x0, x11, y12, y13].sort());
    for (const id of [x11, y12, y13]) expect(await linesOf(id)).toHaveLength(1);
  });

  it('H-1 (1): a re-shot of page 1 that reads one line a little differently (77.10 vs 77.00) is page_duplicate', async () => {
    const [p1, p2] = await pages(2, 'h1a');
    await ocr(p1!, { ...ACME, lines: [{ qty: '3', total: '77.00', desc: 'עגבניות שרי' }] });
    // The re-shot carries page 1's number; the worker blanks it as a duplicate of page 1.
    const s2 = await ocr(p2!, {
      ...ACME,
      duplicateOf: { invoiceId: p1!, invoiceNumber: 'A-100' },
      lines: [{ qty: '3', total: '77.10', desc: 'עגבניות שרי' }],
    });
    expect(s2.flagged).toEqual([{ invoiceId: p2, reason: 'page_duplicate', repeats: p1 }]);
    expect(s2.hold).toBe(true); // never auto-matched
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('H-1 (2): [P1, P2] merged and re-OCR\'d, then P1 re-shot → page_duplicate against P1\'s stored single-page print', async () => {
    const [p1, p2] = await pages(2, 'h1b');
    const L1 = [{ qty: '3', total: '77.00' }, { qty: '2', total: '40.00' }];
    await ocr(p1!, { ...ACME, lines: L1 });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true);
    const re = await invoiceOf(await send(ch.wa, wa([jpegBytes('h1b-reshot')]), at(4)));
    await ocr(p1!, { ...ACME, lines: [...L1, { qty: '9', total: '999.00' }] }); // the composed 2-page re-OCR
    // The worker blanks A-100 as already on file (duplicateOf = page 1).
    const s = await ocr(re, {
      ...ACME,
      duplicateOf: { invoiceId: p1!, invoiceNumber: 'A-100' },
      lines: [{ qty: '3', total: '77.10' }, { qty: '2', total: '40.00' }],
    });
    expect(s.flagged).toEqual([{ invoiceId: re, reason: 'page_duplicate', repeats: p1 }]);
    expect(await pdfPagesOf(p1!)).toBe(2);
  });

  it('H-1 (3): a re-shot of PAGE 2 is page_duplicate against the absorbed page 2, never page 3', async () => {
    const [p1, p2] = await pages(2, 'h1c');
    const L2 = [{ qty: '7', total: '210.00' }];
    await ocr(p1!, ACME);
    expect((await ocr(p2!, { ...NOHEAD, lines: L2 })).absorbed).toBe(true);
    const re2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('h1c-reshot2')]), at(3)));
    expect((await ocr(re2, { ...NOHEAD, lines: L2 })).hold).toBe(true); // page 1 is being re-read
    const s1 = await ocr(p1!, ACME); // the composed re-OCR settles the cluster
    expect(s1.flagged).toEqual([{ invoiceId: re2, reason: 'page_duplicate', repeats: p1 }]);
    expect(await pdfPagesOf(p1!)).toBe(2);
    expect(matchCalls).not.toContain(re2);
  });

  it("H-1 (4): 'A 100' vs 'A-100' slips past the unique index but is still a duplicate, and is never matched", async () => {
    const [p1, p2] = await pages(2, 'h1d');
    const L = [{ qty: '4', total: '88.00' }];
    await ocr(p1!, { ...ACME, lines: L });
    const s2 = await ocr(p2!, { ...ACME, invoiceNumber: 'A 100', lines: L });
    expect(s2).toMatchObject({ hold: true, flagged: [{ invoiceId: p2, reason: 'page_duplicate' }] });
    expect(matchCalls).toEqual([p1]); // page 1 released, the duplicate not
  });
});

describe('round-3 fixes (HIGH chain identity, MEDIUM samePage, inbox recourse)', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('HIGH: a NAME-only page 1 does not adopt a page that carries an invoice number', async () => {
    const [p1, p2] = await pages(2, 'r3h1');
    await ocr(p1!, { supplierName: ACME.supplierName, invoiceNumber: null });
    const s2 = await ocr(p2!, { supplierName: ACME.supplierName, invoiceNumber: 'A-700' });
    expect(s2).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_not_merged' }] });
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('HIGH: a number-only page 1 absorbs ONE ח.פ., then refuses a second, different ח.פ. (accumulated identity)', async () => {
    const [p1, p2, p3] = await pages(3, 'r3h2');
    await ocr(p1!, { invoiceNumber: 'A-800' });
    await ocr(p2!, { businessId: '51-000123-4', invoiceNumber: null });
    const s3 = await ocr(p3!, { businessId: '52-999888-7', invoiceNumber: null });
    expect(s3.flagged).toEqual([{ invoiceId: p3, reason: 'page_other_supplier' }]);
    expect(s3.absorbed).toBe(false);
    expect((await invoicesOfA()).map((i) => i.id).sort()).toEqual([p1, p3].sort());
  });

  it('round 5 (was round 3): page 1 with name + ח.פ. and no number does NOT take a page 2 that adds a number — maybe the next invoice', async () => {
    const [p1, p2] = await pages(2, 'r3h3');
    await ocr(p1!, { ...ACME, invoiceNumber: null });
    expect(await ocr(p2!, { ...ACME, invoiceNumber: 'A-900' })).toMatchObject({
      absorbed: false,
      flagged: [{ invoiceId: p2, reason: 'page_not_merged' }],
    });
  });

  it('round 4: a page that REPEATS page 1\'s items is NEVER merged (in doubt, a person decides)', async () => {
    const [p1, p2] = await pages(2, 'r3m1');
    const L = [{ qty: '5', total: '120.00', desc: 'חלב 3%' }, { qty: '2', total: '30.00', desc: 'לחם אחיד' }];
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-910', lines: L });
    const s2 = await ocr(p2!, { ...NOHEAD, lines: L });
    expect(s2.absorbed).toBe(false);
    expect(s2.flagged).toHaveLength(1);
  });

  it('round 5: an equal printed total is overlap enough — never merged; held as a possible duplicate (never billed twice)', async () => {
    const [p1, p2] = await pages(2, 'r3m2');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-920', totalInclVat: '500.00' });
    const s2 = await ocr(p2!, { ...ACME, duplicateOf: { invoiceId: p1!, invoiceNumber: 'A-920' }, totalInclVat: '500.00' });
    expect(s2).toMatchObject({ absorbed: false, hold: true, flagged: [{ invoiceId: p2, reason: 'page_duplicate', repeats: p1 }] });
  });

  it("MEDIUM: a page is never a 'duplicate' of a FLAGGED other-supplier page; it is just not merged", async () => {
    const [p1, p2, p3] = await pages(3, 'r3m3');
    const L = [{ qty: '4', total: '64.00', desc: 'קמח לבן' }];
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-930' });
    await ocr(p2!, { ...OTHER, lines: L });
    const s3 = await ocr(p3!, { ...NOHEAD, lines: L });
    expect(s3.flagged).toContainEqual({ invoiceId: p3, reason: 'page_not_merged' });
  });

  it("inbox: 'separate' answers the question for good — audited, matched, and it never joins a document again", async () => {
    const [p1, p2] = await pages(2, 'r3s');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-940' });
    await ocr(p2!, { ...ACME, invoiceNumber: 'A-941' }); // page_other_invoice
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    expect(d2!.error).toBe('page_other_invoice');
    matchCalls = [];
    const res = await withRestaurant(appDb, A.restaurantId, (tx) =>
      resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: d2!.id, action: 'separate', userId: A.ownerUserId }, { enqueueMatch: async (j) => void matchCalls.push(j.invoiceId) }),
    );
    expect(res).toEqual({ invoiceId: p2, action: 'separate' });
    const [after] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id));
    expect(after!.error).toBe('page_separate');
    expect(matchCalls).toEqual([p2]);
    const audit = await ownerDb.select().from(auditLog).where(and(eq(auditLog.entityId, p2!), eq(auditLog.action, 'document.page_separated')));
    expect(audit[0]).toMatchObject({ userId: A.ownerUserId, before: { flag: 'page_other_invoice' } });
    // A later header-less page right after it does not join page 1 (the separated page is a break).
    const p3 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r3s-late')]), at(3)));
    expect((await ocr(p3, NOHEAD)).absorbed).toBe(false);
  });

  it("inbox: 'delete the duplicate' retires a page_duplicate (scan kept), and is refused for anything referenced or not a duplicate", async () => {
    const [p1, p2] = await pages(2, 'r3d');
    const L = [{ qty: '3', total: '77.00', desc: 'עגבניות' }];
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-950', lines: L });
    await ocr(p2!, { ...ACME, duplicateOf: { invoiceId: p1!, invoiceNumber: 'A-950' }, lines: L });
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    expect(d2!.error).toBe('page_duplicate');
    const [d1] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p1!));
    const asA = <T>(fn: (tx: typeof appDb) => Promise<T>) => withRestaurant(appDb, A.restaurantId, fn);
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => e.message ?? e.code);
    expect(await code(asA((tx) => resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: d1!.id, action: 'delete_duplicate', userId: null })))).toBe('not_flagged');
    // A claim on the duplicate refuses the delete.
    const [run] = await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p2!, overallStatus: 'minor' }).returning();
    const [gap] = await ownerDb.insert(discrepancies).values({ matchRunId: run!.id, restaurantId: A.restaurantId, type: 'PRICE_HIGHER', severity: 'warn' }).returning();
    const [claim] = await ownerDb.insert(recoveryClaims).values({ restaurantId: A.restaurantId, discrepancyId: gap!.id, invoiceId: p2!, amountAgorot: 100 }).returning();
    expect(await code(asA((tx) => resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: d2!.id, action: 'delete_duplicate', userId: null })))).toBe('has_claim');
    await ownerDb.delete(recoveryClaims).where(eq(recoveryClaims.id, claim!.id));
    await ownerDb.delete(matchRuns).where(eq(matchRuns.id, run!.id));
    await asA((tx) => resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: d2!.id, action: 'delete_duplicate', userId: A.ownerUserId }));
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, p2!))).toHaveLength(0);
    const [gone] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id));
    expect(gone).toMatchObject({ status: 'duplicate', error: null, invoiceId: null });
    expect(await localDocumentStorage().read(A.restaurantId, gone!.storagePath!)).not.toBeNull();
  });

  it('inbox: ingest.resolvePageFlag is manager-tier and tenant-scoped (foreign document → NOT_FOUND, receiver → FORBIDDEN)', async () => {
    const [p1, p2] = await pages(2, 'r3t');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-960' });
    await ocr(p2!, OTHER);
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    const other = await seedTenant(ownerDb, 'Y');
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } as never })
      .where(eq(restaurants.id, other.restaurantId));
    const caller = (t: { restaurantId: string; userId: string }, role: Session['role']) =>
      appRouter.createCaller({ db: ownerDb, session: { userId: t.userId, restaurantId: t.restaurantId, role } } as AppContext);
    await expect(
      caller({ restaurantId: other.restaurantId, userId: other.ownerUserId }, 'owner').ingest.resolvePageFlag({ documentId: d2!.id, action: 'separate' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller({ restaurantId: A.restaurantId, userId: A.ownerUserId }, 'receiver').ingest.resolvePageFlag({ documentId: d2!.id, action: 'separate' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [still] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id));
    expect(still!.error).toBe('page_other_supplier');
    const ok = await caller({ restaurantId: A.restaurantId, userId: A.ownerUserId }, 'owner').ingest.resolvePageFlag({ documentId: d2!.id, action: 'separate' });
    expect(ok.action).toBe('separate');
    // The Errors filter lists a message whose page is flagged.
    const p3 = await pages(2, 'r3t-err', 1, 30);
    await ocr(p3[0]!, { ...ACME, invoiceNumber: 'A-961' });
    await ocr(p3[1]!, { ...OTHER, invoiceNumber: 'S-8' });
    const inbox = await caller({ restaurantId: A.restaurantId, userId: A.ownerUserId }, 'owner').ingest.inbox({ filter: 'errors', limit: 50 });
    expect(inbox.some((m) => m.documents.some((d) => d.invoiceId === p3[1] && d.error === 'page_other_supplier'))).toBe(true);
  });
});

describe('round-3 LOW items', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it('a recompose removes the superseded composed PDF (no row references it any more)', async () => {
    const [p1, p2, p3] = await pages(3, 'r3low');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-970' });
    expect((await ocr(p2!, NOHEAD)).hold).toBe(true); // p3 still pending
    expect((await ocr(p3!, NOHEAD)).absorbed).toBe(true); // p2 + p3 into p1 → 3-page PDF
    const [scan] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, p1!));
    expect(scan!.pageCount).toBe(3);
    // A 4th page joins later: the 3-page PDF is superseded and removed.
    const p4 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r3low-4')]), at(5)));
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-970' }); // the composed re-OCR of 3 pages
    expect((await ocr(p4, NOHEAD)).absorbed).toBe(true);
    const [scan4] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, p1!));
    expect(scan4!.pageCount).toBe(4);
    expect(scan4!.storagePath).not.toBe(scan!.storagePath);
    expect(await localDocumentStorage().read(A.restaurantId, scan!.storagePath)).toBeNull();
    expect(await localDocumentStorage().read(A.restaurantId, scan4!.storagePath)).not.toBeNull();
  });
});

/* ───────────────────────── round 4 ───────────────────────── */

const L5: LineIn[] = [
  { qty: '5', total: '120.00', desc: 'חלב תנובה 3% קרטון', unitPrice: '24.00' },
  { qty: '2', total: '30.00', desc: 'לחם אחיד פרוס', unitPrice: '15.00' },
  { qty: '10', total: '45.00', desc: 'ביצים L תבנית', unitPrice: '4.50' },
  { qty: '1', total: '80.00', desc: 'גבינה צהובה עמק 1 קג', unitPrice: '80.00' },
  { qty: '3', total: '27.00', desc: 'יוגורט דנונה 1.5%', unitPrice: '9.00' },
];
type LineIn = { qty: string; total: string; desc: string; unitPrice?: string };
type Head = Partial<PageHeader> & { lines?: LineIn[]; totalExclVat?: string | null; totalInclVat?: string | null; number?: string | null };
const H = (id: string, h: Head = {}): PageHeader => ({
  invoiceId: id,
  status: 'matched',
  supplierId: 'sup-1',
  invoiceNumber: h.number ?? h.invoiceNumber ?? null,
  supplierName: h.supplierName ?? null,
  businessId: h.businessId ?? null,
  duplicateOf: h.duplicateOf ?? null,
  unreadable: h.unreadable ?? false,
  alreadyFlagged: h.alreadyFlagged ?? null,
  print: {
    number: h.number ?? h.invoiceNumber ?? null,
    totalExclVat: h.totalExclVat ?? null,
    totalInclVat: h.totalInclVat ?? null,
    lines: (h.lines ?? []).map((l) => ({ qty: l.qty, total: l.total, unitPrice: l.unitPrice ?? null, description: l.desc })),
  },
});
const TNUVA = { supplierName: 'תנובה בע"מ', businessId: '510001234' };
const OTHERL: LineIn[] = [
  { qty: '7', total: '210.00', desc: 'קמח לבן 25 קג' },
  { qty: '4', total: '64.00', desc: 'שמן קנולה 4 ליטר' },
];
const verdict = (members: PageHeader[]) => {
  const d = decidePages(members);
  return { merged: d.merge.map((m) => m.invoiceId), flagged: d.flagged.map(({ heads: _h, ...f }) => f) };
};

describe('round 9 · decidePages (pure): the heads a stray page may continue', () => {
  const headsOf = (members: PageHeader[], id: string) => decidePages(members).flagged.find((f) => f.invoiceId === id)?.heads;
  const COMPLETE_L = [{ qty: '1', total: '500.00', desc: 'whole invoice' }];
  it('after a complete page 1, a continuation follows the run head only', () => {
    const m = [H('a', { ...TNUVA, number: 'A-1', lines: COMPLETE_L, totalExclVat: '500.00' }), H('b1', { ...TNUVA, number: 'B-2', lines: L5 }), H('b2', { lines: OTHERL })];
    expect(headsOf(m, 'b2')).toEqual(['b1']);
  });
  it('after an OPEN page 1, the run head first, then page 1', () => {
    const m = [H('a1', { ...TNUVA, number: 'A-1', lines: L5 }), H('a2', { lines: OTHERL }), H('b1', { ...TNUVA, number: 'B-2', lines: [{ qty: '9', total: '99.00', desc: 'x' }] }), H('b2', { lines: [{ qty: '3', total: '33.00', desc: 'y' }] })];
    expect(headsOf(m, 'b2')).toEqual(['b1', 'a1']);
  });
  it("another supplier's page is never a head", () => {
    const m = [H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { supplierName: 'שטראוס', businessId: '529998887', number: 'S-7', lines: OTHERL }), H('p3', { ...TNUVA, number: 'A 1', lines: [{ qty: '3', total: '33.00', desc: 'y' }] })];
    expect(headsOf(m, 'p3')).toEqual(['p1']);
  });
});

describe('round 4 · decidePages (pure): in doubt, a person — never a merge', () => {
  it('HIGH-1 c1: an exact re-shot whose number was lost to glare → page_duplicate, not page 2', () => {
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: L5 })])).toEqual({
      merged: [],
      flagged: [{ invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' }],
    });
  });

  it('HIGH-1 c2: a re-shot read with 2-of-5 wording differences is still never merged', () => {
    const reworded = L5.map((l, i) => (i < 2 ? { ...l, desc: `${l.desc} מבצע` } : l));
    const v = verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: reworded })]);
    expect(v.merged).toEqual([]);
    expect(v.flagged[0]!.invoiceId).toBe('p2');
  });

  it('HIGH-1 c3 / c3b: a cropped first shot, or a cropped re-shot, overlaps → held possible duplicate (round 5)', () => {
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5.slice(0, 3) }), H('p2', { lines: L5 })]).flagged).toEqual([
      { invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' },
    ]);
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: L5.slice(1, 4) })]).flagged).toEqual([
      { invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' },
    ]);
  });

  it('HIGH-1 c4 / c7: the same printed total (number missing on one side, or different lines) is never merged', () => {
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', totalInclVat: '355.00', lines: L5 }), H('p2', { totalInclVat: '355.00', lines: OTHERL })]).merged).toEqual([]);
  });

  it('HIGH-1: an unpriced signed delivery note of the same items is never merged into the invoice', () => {
    const note = L5.map((l) => ({ qty: l.qty, total: '', desc: l.desc }));
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: note })])).toEqual({
      merged: [],
      flagged: [{ invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' }],
    });
  });

  it('HIGH-1: a one-letter misread of every description still reads as the same items', () => {
    const misread = L5.map((l) => ({ ...l, desc: l.desc.replace('ב', 'כ') }));
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: misread })]).merged).toEqual([]);
  });

  it('control: a real page 2 with DIFFERENT items still joins page 1', () => {
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: OTHERL })])).toEqual({ merged: ['p2'], flagged: [] });
  });

  it("HIGH-2: 'כהן' does not adopt 'כהן ובניו''s ח.פ. as evidence for its numbered page (two suppliers)", () => {
    const v = verdict([
      H('p1', { supplierName: 'כהן', lines: L5.slice(0, 1) }),
      H('p2', { supplierName: 'כהן ובניו', businessId: '520009999', lines: OTHERL.slice(0, 1) }),
      H('p3', { supplierName: 'כהן ובניו', businessId: '520009999', number: 'K-77', lines: OTHERL.slice(1) }),
    ]);
    expect(v.merged).not.toContain('p3');
    expect(v.flagged).toContainEqual({ invoiceId: 'p3', reason: 'page_not_merged' });
  });

  it('round 5 (was LOW-12): a footer-only page 1 (ח.פ.) does NOT take a header page bringing a number — a person decides', () => {
    expect(
      verdict([
        H('p1', { businessId: '510001234', lines: L5.slice(0, 2) }),
        H('p2', { ...TNUVA, number: 'A-5', lines: OTHERL }),
      ]),
    ).toEqual({ merged: [], flagged: [{ invoiceId: 'p2', reason: 'page_not_merged' }] });
  });

  it('MEDIUM-7: a self-complete number-less invoice absorbs nothing and is never absorbed; a credit note never merges', () => {
    const complete = { lines: OTHERL, totalExclVat: '274.00' };
    expect(verdict([H('p1', { ...TNUVA, ...complete }), H('p2', { lines: L5.slice(0, 1) })]).merged).toEqual([]);
    // round 5: after an OPEN document a whole invoice is a question, never silent
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { ...complete })])).toEqual({
      merged: [],
      flagged: [{ invoiceId: 'p2', reason: 'page_not_merged' }],
    });
    const credit: LineIn[] = [{ qty: '1', total: '-50.00', desc: 'זיכוי החזרה' }];
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: credit })]).merged).toEqual([]);
  });

  it('MEDIUM-6 (round 5): an overcharged near-copy is held as a possible duplicate (never matched), and it cuts the chain', () => {
    const overcharged = L5.map((l, i) => (i === 0 ? { ...l, total: '156.00' } : l));
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: overcharged })]).flagged).toEqual([
      { invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' },
    ]);
    const v = verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: overcharged }), H('p3', { lines: OTHERL })]);
    expect(v).toEqual({
      merged: [],
      flagged: [
        { invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' },
        { invoiceId: 'p3', reason: 'page_not_merged' },
      ],
    });
  });
});

describe('round 4 · DB', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
    delayedCalls = [];
  });

  it('HIGH-4: two pages whose OCR finishes 30 s apart → page 1 is HELD (delayed match), page 2 then merges', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r4w-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-401' });
    const s1 = await settle(p1, new Date(at(0).getTime() + 30_000)); // alone, window open
    expect(s1).toMatchObject({ hold: true, absorbed: false });
    expect(delayedCalls).toEqual([{ invoiceId: p1, runAt: new Date(at(11).getTime()) }]);
    expect(matchCalls).toEqual([]);
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r4w-2')]), at(1)));
    await writeOcr(p2, NOHEAD);
    expect(await settle(p2, new Date(at(1).getTime() + 30_000))).toMatchObject({ absorbed: true, mergedInto: p1 });
    expect(await ownerDb.select().from(matchRuns).where(eq(matchRuns.invoiceId, p1))).toHaveLength(0);
  });

  it('HIGH-3: deleting the copy that HOLDS the number moves the number to the kept page 1 and matches it', async () => {
    const [keep, copy] = await pages(2, 'r4k');
    const L = [{ qty: '6', total: '66.00', desc: 'פלפל אדום' }];
    await writeOcr(copy!, { ...ACME, invoiceNumber: 'A-990', lines: L }); // read first, took the number
    await writeOcr(keep!, { ...ACME, duplicateOf: { invoiceId: copy!, invoiceNumber: 'A-990' }, lines: L });
    const s = await settle(keep!);
    expect(s.flagged).toEqual([{ invoiceId: copy, reason: 'page_duplicate', repeats: keep }]);
    const [dCopy] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, copy!));
    matchCalls = [];
    await withRestaurant(appDb, A.restaurantId, (tx) =>
      resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: dCopy!.id, action: 'delete_duplicate', userId: A.ownerUserId }, { enqueueMatch: async (j) => void matchCalls.push(j.invoiceId) }),
    );
    const [k] = await ownerDb.select().from(invoices).where(eq(invoices.id, keep!));
    expect(k!.invoiceNumber).toBe('A-990');
    expect((k!.ocrPayload as { raw?: { duplicateOf?: unknown } }).raw?.duplicateOf).toBeUndefined();
    expect(matchCalls).toEqual([keep]);
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, copy!))).toHaveLength(0);
  });

  it('MEDIUM-5: delete_duplicate is refused for an invoice that holds more than the clicked page', async () => {
    const [p1, p2] = await pages(2, 'r4m5');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-501' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true); // p1 now holds two pages
    const docs = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p1!));
    await ownerDb.update(ingestDocuments).set({ error: 'page_duplicate' }).where(eq(ingestDocuments.id, docs[1]!.id));
    const code = await withRestaurant(appDb, A.restaurantId, (tx) =>
      resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: docs[1]!.id, action: 'delete_duplicate', userId: null }),
    ).then(
      () => 'ok',
      (e: { message?: string }) => e.message,
    );
    expect(code).toBe('multi_page');
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, p1!))).toHaveLength(1);
  });
});

describe('round 5 · decidePages (pure): HIGH money findings', () => {
  it('HIGH silentBreak: a carried-forward page 2 that "adds up" after an open document → page_not_merged, never silent', () => {
    const carried = { lines: OTHERL, totalExclVat: '274.00' }; // its lines add up to its own subtotal
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', carried)])).toEqual({
      merged: [],
      flagged: [{ invoiceId: 'p2', reason: 'page_not_merged' }],
    });
  });

  it('HIGH silentBreak: a discount / credit page after an open document → page_not_merged, never silent', () => {
    const discount: LineIn[] = [{ qty: '1', total: '-35.00', desc: 'הנחה' }];
    expect(verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: discount })]).flagged).toEqual([
      { invoiceId: 'p2', reason: 'page_not_merged' },
    ]);
  });

  it('silentBreak stays silent only when page 1 is itself a whole invoice (two separate invoices)', () => {
    const whole = { lines: OTHERL, totalExclVat: '274.00' };
    const other = { lines: L5, totalExclVat: L5.reduce((n, l) => n + Number(l.total), 0).toFixed(2) };
    expect(verdict([H('p1', { ...TNUVA, ...whole }), H('p2', { ...other })])).toEqual({ merged: [], flagged: [] });
  });

  it('HIGH two invoices: page 1 without a number never takes a page bringing one (VAT-inclusive lines miss selfComplete)', () => {
    const vatIncl: LineIn[] = OTHERL.map((l) => ({ ...l, total: String((Number(l.total) * 1.17).toFixed(2)) }));
    expect(
      verdict([H('p1', { ...TNUVA, lines: L5.slice(0, 2) }), H('p2', { ...TNUVA, number: 'A-77', lines: vatIncl, totalExclVat: '274.00' })]),
    ).toEqual({ merged: [], flagged: [{ invoiceId: 'p2', reason: 'page_not_merged' }] });
  });

  it('HIGH near-copy: an overlapping page records the chain page it repeats (the delete keeper)', () => {
    const cropped = L5.slice(0, 3);
    const v = verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { lines: cropped })]);
    expect(v.flagged).toEqual([{ invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' }]);
  });
});

describe('round 5 · DB: HIGH money findings', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
    delayedCalls = [];
  });

  it('HIGH near-copy: an overcharged near-copy is HELD (never matched) and can be deleted in the inbox', async () => {
    const [p1, p2] = await pages(2, 'r5nc');
    const L = [
      { qty: '5', total: '120.00', desc: 'חלב 3%' },
      { qty: '2', total: '30.00', desc: 'לחם אחיד' },
    ];
    await writeOcr(p1!, { ...ACME, invoiceNumber: 'A-551', lines: L });
    await writeOcr(p2!, { ...ACME, invoiceNumber: null, lines: [{ ...L[0]!, total: '126.00' }, L[1]!] });
    const s = await settle(p2!);
    expect(s).toMatchObject({ absorbed: false, hold: true, flagged: [{ invoiceId: p2, reason: 'page_duplicate', repeats: p1 }] });
    expect(matchCalls).not.toContain(p2);
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    await withRestaurant(appDb, A.restaurantId, (tx) =>
      resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: d2!.id, action: 'delete_duplicate', userId: A.ownerUserId }, { enqueueMatch: async (j) => void matchCalls.push(j.invoiceId) }),
    );
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, p2!))).toHaveLength(0);
    const [k] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1!));
    expect(k!.invoiceNumber).toBe('A-551');
  });

  it('HIGH keeper: deleting the copy un-blanks ONLY the chain page it repeats; an unrelated re-send stays blanked and unmatched', async () => {
    const [keep, copy] = await pages(2, 'r5k');
    const L = [{ qty: '6', total: '66.00', desc: 'פלפל אדום' }];
    await writeOcr(copy!, { ...ACME, invoiceNumber: 'A-991', lines: L }); // read first, took the number
    await writeOcr(keep!, { ...ACME, duplicateOf: { invoiceId: copy!, invoiceNumber: 'A-991' }, lines: L });
    // an unrelated re-send an hour later (another cluster), also blanked against the copy
    const resend = await invoiceOf(await send(ch.wa, wa([jpegBytes('r5k-resend')]), at(60)));
    await writeOcr(resend, { ...ACME, duplicateOf: { invoiceId: copy!, invoiceNumber: 'A-991' }, lines: L });
    expect((await settle(keep!)).flagged).toEqual([{ invoiceId: copy, reason: 'page_duplicate', repeats: keep }]);
    const [dCopy] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, copy!));
    matchCalls = [];
    await withRestaurant(appDb, A.restaurantId, (tx) =>
      resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: dCopy!.id, action: 'delete_duplicate', userId: A.ownerUserId }, { enqueueMatch: async (j) => void matchCalls.push(j.invoiceId) }),
    );
    expect(matchCalls).toEqual([keep]);
    const [k] = await ownerDb.select().from(invoices).where(eq(invoices.id, keep!));
    expect(k!.invoiceNumber).toBe('A-991');
    const [r] = await ownerDb.select().from(invoices).where(eq(invoices.id, resend));
    expect(r!.invoiceNumber).toBeNull();
    expect((r!.ocrPayload as { raw?: { duplicateOf?: { invoiceId?: string } } }).raw?.duplicateOf?.invoiceId).toBe(keep);
  });
});

describe('round 5 · decidePages (pure): MED findings', () => {
  const notes = (n: string, date: string): LineIn[] => [
    { qty: '1', total: '120.00', desc: `ת.מ. ${n} מיום ${date}` },
    { qty: '1', total: '95.00', desc: `ת.מ. ${Number(n) + 1} מיום ${date}` },
  ];

  it('MED digit-blind: two consolidated pages listing DIFFERENT delivery notes are not a copy, and not an overlap', () => {
    const p1 = H('p1', { ...TNUVA, number: 'R-7', lines: notes('4411', '01/11') });
    const p2 = H('p2', { lines: notes('4511', '08/11') });
    expect(verdict([p1, p2])).toEqual({ merged: ['p2'], flagged: [] }); // a continuation page, not a duplicate
  });

  it('MED digit-aware: the same delivery notes again IS an exact copy (held duplicate)', () => {
    const p1 = H('p1', { ...TNUVA, number: 'R-7', lines: notes('4411', '01/11') });
    const p2 = H('p2', { lines: notes('4411', '01/11') });
    expect(verdict([p1, p2]).flagged).toEqual([{ invoiceId: 'p2', reason: 'page_duplicate', repeats: 'p1' }]);
  });

  it('MED name substring: a number-less page whose name only CONTAINS page 1\'s name (no equal ח.פ.) is a question, never merged', () => {
    const v = verdict([
      H('p1', { supplierName: 'כהן ירקות', number: 'A-1', lines: L5 }),
      H('p2', { supplierName: 'כהן', lines: OTHERL }),
    ]);
    expect(v).toEqual({ merged: [], flagged: [{ invoiceId: 'p2', reason: 'page_not_merged' }] });
  });

  it('control: the same name exactly still continues the document', () => {
    const v = verdict([H('p1', { ...TNUVA, number: 'A-1', lines: L5 }), H('p2', { supplierName: 'תנובה בע"מ', lines: OTHERL })]);
    expect(v.merged).toEqual(['p2']);
  });
});

describe('round 6 · HIGH: the window-close match is settle-aware', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
    delayedCalls = [];
  });

  const gate = (invoiceId: string, now: Date, attempt = 0, resched: Array<{ runAt: Date; attempt: number }> = []) =>
    withRestaurant(appDb, A.restaurantId, (tx) =>
      windowCloseGate(
        tx,
        { restaurantId: A.restaurantId, invoiceId, attempt, now },
        {
          enqueueOcr: async (jobs) => void ocrCalls.push(...jobs.map((j) => ({ invoiceId: j.invoiceId, dedupeKey: j.dedupeKey }))),
          enqueueMatch: async (j) => void matchCalls.push(j.invoiceId),
          reschedule: async (_j, runAt, a) => void resched.push({ runAt, attempt: a }),
        },
      ),
    );

  it('page 2 still being read at runAt → page 1 is NOT matched, the job re-schedules; page 2 then merges', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6w-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-601' });
    expect(await settle(p1, new Date(at(0).getTime() + 30_000))).toMatchObject({ hold: true, holdReason: 'window_open' });
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6w-2')]), at(9))); // inside the window, still ocr_pending
    const resched: Array<{ runAt: Date; attempt: number }> = [];
    const runAt = at(11);
    expect(await gate(p1, runAt, 0, resched)).toBe('rescheduled');
    expect(resched).toEqual([{ runAt: new Date(runAt.getTime() + WINDOW_RETRY_MS), attempt: 1 }]);
    expect(await ownerDb.select().from(matchRuns).where(eq(matchRuns.invoiceId, p1))).toHaveLength(0);
    // page 2's read lands: it merges into page 1 (no run blocked it)
    expect(await ocr(p2, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: true, mergedInto: p1 });
  });

  it('round 8: at the cap, a sibling still ALIVE → re-checked later (longer backoff), never page 1 alone; the ceiling ends it', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6c-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-602' });
    await invoiceOf(await send(ch.wa, wa([jpegBytes('r6c-2')]), at(5))); // still being read (just touched)
    const resched: Array<{ runAt: Date; attempt: number }> = [];
    const now = new Date();
    expect(await gate(p1, now, WINDOW_MAX_ATTEMPTS, resched)).toBe('rescheduled'); // nothing is ever left un-queued
    expect(resched).toEqual([{ runAt: new Date(now.getTime() + WINDOW_LONG_RETRY_MS), attempt: WINDOW_MAX_ATTEMPTS + 1 }]);
    expect(await ownerDb.select().from(matchRuns).where(eq(matchRuns.invoiceId, p1))).toHaveLength(0);
    expect(await gate(p1, now, WINDOW_CEILING_ATTEMPTS)).toBe('match'); // the hard ceiling
  });

  it('round 8: the window job never auto-matches an invoice the OCR held for a person', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r8h-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-606', status: 'parsed' });
    await ownerDb
      .update(invoices)
      .set({ ocrPayload: sql`jsonb_set(coalesce(${invoices.ocrPayload}, '{}'::jsonb), '{raw,reviewReasons}', '["supplier_id_mismatch"]'::jsonb, true)` })
      .where(eq(invoices.id, p1));
    expect(await gate(p1, at(11))).toBe('skip');
    expect(await gate(p1, at(11), WINDOW_CEILING_ATTEMPTS)).toBe('skip');
  });

  it('round 9 (N2): a released invoice (status matched) whose reasons outlived the hold IS matched — the OCR job\'s own rule', async () => {
    // learned-charge release: 'matched' with reviewReasons ['unlinked'] kept
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r9n2-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-901', reviewReasons: ['unlinked'] });
    expect(await settle(p1, new Date(at(0).getTime() + 30_000))).toMatchObject({ hold: true, holdReason: 'window_open' });
    expect(await gate(p1, at(11))).toBe('match');
    expect(await gate(p1, at(11), WINDOW_CEILING_ATTEMPTS)).toBe('match');
    // control: a number already on file (raw.duplicateOf) is still never auto-matched
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r9n2-2')]), at(20)));
    await writeOcr(p2, { ...ACME, invoiceNumber: 'A-902' });
    await ownerDb
      .update(invoices)
      .set({ ocrPayload: sql`jsonb_set(${invoices.ocrPayload}, '{raw,duplicateOf}', '{"invoiceId":null,"invoiceNumber":"A-902"}'::jsonb, true)` })
      .where(eq(invoices.id, p2));
    expect(await gate(p2, at(31))).toBe('skip');
  });

  it('round 9 (N5): a merge drops page 1\'s own verdict — the composed read is never held by a single page\'s failed checks', async () => {
    const [p1, p2] = await pages(2, 'r9n5');
    // page 1 read alone: no total, "continues on another page" → held 'parsed'
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-905', status: 'parsed', reviewReasons: ['missing_total', 'continues_on_another_page'] });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true); // p1 → ocr_pending (one composed re-read)
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1!));
    const raw = (inv!.ocrPayload as { raw?: Record<string, unknown> }).raw ?? {};
    expect(raw.reviewReasons).toBeUndefined(); // nothing for the composed read to inherit
    expect(raw.reconciled).toBeDefined(); // the rest of the payload stays
    // the composed read is confident → 'matched'; at window close it is matched
    await writeOcr(p1!, { ...ACME, invoiceNumber: 'A-905', totalInclVat: '1170.00' });
    expect(await settle(p1!, new Date(at(0).getTime() + 30_000))).toMatchObject({ hold: true });
    expect(await gate(p1!, at(11))).toBe('match');
  });

  it('round 7: at the cap, a STALE sibling (no live job, untouched > 1 h) → page 1 is matched alone', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6d-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-604' });
    const p2 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6d-2')]), at(5)));
    await ownerDb.update(invoices).set({ updatedAt: new Date(Date.now() - 2 * 60 * 60_000) }).where(eq(invoices.id, p2));
    await ownerDb.execute(sql`delete from job_queue where payload->>'invoiceId' = ${p2}`);
    expect(await gate(p1, new Date(), WINDOW_MAX_ATTEMPTS)).toBe('match');
  });

  it('round 7: the window job of an invoice that is itself being re-read → skip (its read settles)', async () => {
    const [p1, p2] = await pages(2, 'r7r');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-605' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true); // p1 is now ocr_pending (composed re-read)
    expect(await settle(p1!)).toMatchObject({ hold: true, holdReason: 'reocr' });
    expect(await gate(p1!, new Date())).toBe('skip');
  });

  it('a lone page whose window has closed is matched at once', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6l-1')]), at(0)));
    await writeOcr(p1, { ...ACME, invoiceNumber: 'A-603' });
    expect(await gate(p1, at(11))).toBe('match');
  });
});

describe('round 6 · MED: a failed composed re-read is never silent', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });

  it("the merged document's terminal re-read failure flags every page row page_unreadable", async () => {
    const [p1, p2] = await pages(2, 'r6f');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-611' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true); // p1 is now re-read as one 2-page document
    await writeOcr(p1!, { failed: true }); // the composed read failed terminally (markOcrFailed)
    const s = await settle(p1!);
    expect(s.flagged).toEqual([{ invoiceId: p1, reason: 'page_unreadable' }]);
    const rows = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p1!));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.error === 'page_unreadable')).toBe(true);
  });

  it('a single page whose own read failed is unchanged by this rule (no merge happened)', async () => {
    const p1 = await invoiceOf(await send(ch.wa, wa([jpegBytes('r6f-lone')]), at(0)));
    await writeOcr(p1, { failed: true });
    const s = await settle(p1);
    expect(s.flagged).toEqual([]);
  });
});

describe('round 8 · M3/M7: inbox approval is per page (own supplier); page 1 waits for a page still in review', () => {
  it("approving page 1 of an unknown sender's 2 photos registers ONLY page 1; it waits; page 2 approved → merges", async () => {
    const stranger = '972508888888';
    const m1 = await send(ch.wa, wa([pngBytes('r6a-1')], { from: stranger }), at(0));
    const m2 = await send(ch.wa, wa([pngBytes('r6a-2')], { from: stranger }), at(2));
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    const caller = appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);
    const r1 = await caller.ingest.approveDocument({ documentId: d1!.id, supplierId: A.supplierId });
    expect(r1.invoiceIds).toHaveLength(1);
    expect((await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id)))[0]!.status).toBe('needs_review');
    // page 1 read: a same-sender page in its window still waits for approval → held, never matched alone
    expect(await ocr(r1.invoiceId!, ACME)).toMatchObject({ hold: true, holdReason: 'sibling_pending', pendingReview: true });
    const r2 = await caller.ingest.approveDocument({ documentId: d2!.id, supplierId: A.supplierId });
    expect(await ocr(r2.invoiceId!, { ...ACME, invoiceNumber: null })).toMatchObject({ absorbed: true, mergedInto: r1.invoiceId });
  });
});

describe('round 6 · MED: distinct reasons + a real "attach" recourse', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const callerOf = (t: { restaurantId: string; userId: string }, role: Session['role']) =>
    appRouter.createCaller({ db: ownerDb, session: { userId: t.userId, restaurantId: t.restaurantId, role } } as AppContext);

  it('page 1 already linked → the page that belongs is page_merge_blocked (not "unclear it belongs")', async () => {
    const [p1, p2] = await pages(2, 'r6b');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-621' });
    await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p1!, overallStatus: 'minor' });
    await ownerDb.insert(auditLog).values({ restaurantId: A.restaurantId, action: 'invoice.approved', entityType: 'invoice', entityId: p1! });
    await ownerDb.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, p1!));
    const s = await ocr(p2!, NOHEAD);
    expect(s).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_merge_blocked' }] });
  });

});

describe('round 6 · MED: page questions are counted, visible and reversible', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const callerOf = (t: { restaurantId: string; userId: string }, role: Session['role']) =>
    appRouter.createCaller({ db: ownerDb, session: { userId: t.userId, restaurantId: t.restaurantId, role } } as AppContext);

  it('ingest.pageQuestionOf: A sees its open page question; another restaurant gets null (isolation); overview counts it', async () => {
    const [p1, p2] = await pages(2, 'r6q');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-641' });
    await ocr(p2!, OTHER); // another supplier → page_other_supplier
    const a = callerOf({ restaurantId: A.restaurantId, userId: A.ownerUserId }, 'owner');
    expect(await a.ingest.pageQuestionOf({ invoiceId: p2! })).toMatchObject({ flag: 'page_other_supplier' });
    expect((await a.ingest.overview()).pageQuestions).toBeGreaterThanOrEqual(1);
    const other = await seedTenant(ownerDb, 'Q6');
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } as never })
      .where(eq(restaurants.id, other.restaurantId));
    expect(await callerOf({ restaurantId: other.restaurantId, userId: other.ownerUserId }, 'owner').ingest.pageQuestionOf({ invoiceId: p2! })).toBeNull();
  });

  it('"separate" on a possible duplicate is reversible: the copy can still be deleted afterwards', async () => {
    const [keep, copy] = await pages(2, 'r6s');
    const L = [{ qty: '6', total: '66.00', desc: 'פלפל צהוב' }];
    await writeOcr(keep!, { ...ACME, invoiceNumber: 'A-651', lines: L });
    await writeOcr(copy!, { ...ACME, invoiceNumber: null, lines: L });
    expect((await settle(copy!)).flagged).toEqual([{ invoiceId: copy, reason: 'page_duplicate', repeats: keep }]);
    const [dCopy] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, copy!));
    const run = (action: 'separate' | 'delete_duplicate') =>
      withRestaurant(appDb, A.restaurantId, (tx) =>
        resolvePageFlag(tx, { restaurantId: A.restaurantId, documentId: dCopy!.id, action, userId: A.ownerUserId }, { enqueueMatch: async () => {} }),
      );
    await run('separate');
    await run('delete_duplicate');
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, copy!))).toHaveLength(0);
    expect(await ownerDb.select().from(invoices).where(eq(invoices.id, keep!))).toHaveLength(1);
  });
});

describe('round 7 · R3: a transient storage failure never releases both halves', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
    delayedCalls = [];
  });

  it('page reads that FAIL (not missing) keep both pages held and unflagged; the last attempt asks a person', async () => {
    const [p1, p2] = await pages(2, 'r7t');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-711' });
    await writeOcr(p2!, NOHEAD);
    const real = localDocumentStorage();
    const flaky = { ...real, read: async () => Promise.reject(new Error('storage 503')) };
    const run = (finalAttempt: boolean) =>
      withRestaurant(appDb, A.restaurantId, (tx) =>
        settleDocumentPages(
          tx,
          { restaurantId: A.restaurantId, invoiceId: p2!, now: new Date('2027-01-01T00:00:00Z'), finalAttempt },
          {
            storage: flaky,
            enqueueOcr: async () => {},
            enqueueMatch: async (j) => void matchCalls.push(j.invoiceId),
            enqueueDelayedMatch: async (j, runAt) => void delayedCalls.push({ invoiceId: j.invoiceId, runAt }),
          },
        ),
      );
    const s = await run(false);
    expect(s).toMatchObject({ hold: true, holdReason: 'merge_retry', flagged: [] });
    expect(matchCalls).toEqual([]); // neither half released
    expect(delayedCalls.map((d) => d.invoiceId)).toEqual([p1]); // a settle-aware retry is scheduled
    expect((await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!)))[0]!.error).toBeNull();
    const last = await run(true);
    expect(last.flagged).toEqual([{ invoiceId: p2, reason: 'page_merge_blocked' }]);
  });
});

describe('round 7 · R4: an open page question holds approvals (its invoice and page 1)', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const owner = () =>
    appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);

  it("page 1's discrepancy is marked and approve/reject are refused while page 2 is page_merge_blocked", async () => {
    const [p1, p2] = await pages(2, 'r7a');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-721' });
    // page 1 already matched against its goods receipt → page 2 cannot join (merge blocked)
    const [run] = await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p1!, grId: A.grId, overallStatus: 'minor' }).returning();
    const [gap] = await ownerDb
      .insert(discrepancies)
      .values({ matchRunId: run!.id, restaurantId: A.restaurantId, type: 'PRICE_HIGHER', severity: 'warn', requiresRole: 'manager', deltaAmount: '12.00' })
      .returning();
    expect(await ocr(p2!, NOHEAD)).toMatchObject({ flagged: [{ invoiceId: p2, reason: 'page_merge_blocked' }] }); // page 1 has a run
    const rows = await owner().approvals.myQueue();
    expect(rows.find((r) => r.id === gap!.id)?.pageQuestion).toBe(true);
    expect((await owner().approvals.queueSummary()).pageHeld.count).toBeGreaterThanOrEqual(1);
    await expect(owner().approvals.approve({ discrepancyId: gap!.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(owner().approvals.reject({ discrepancyId: gap!.id, reason: 'x' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p1! })).toMatchObject({ flag: 'page_belongs' });
    // the person decides the page ("separate") → the hold lifts
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    await owner().ingest.resolvePageFlag({ documentId: d2!.id, action: 'separate' });
    await expect(owner().approvals.approve({ discrepancyId: gap!.id })).resolves.toBeTruthy();
  });
});

describe('round 7 · R6–R9', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const owner = () =>
    appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);

  it('R6: an unreadable page has a way out ("close as unread"), and stops asking once its invoice got lines', async () => {
    const [p1, p2] = await pages(2, 'r7u');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-731' });
    expect((await ocr(p2!, { failed: true })).flagged).toEqual([{ invoiceId: p2, reason: 'page_unreadable' }]);
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p2! })).toMatchObject({ flag: 'page_unreadable' });
    // a person types its lines → answered (no dead end), without a write
    await ownerDb.insert(invoiceLines).values({ invoiceId: p2!, rawDescription: 'הוקלד ידנית', qtyBilled: '1', unit: 'unit', unitPriceBilled: '10.0000', lineTotal: '10.00' });
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p2! })).toBeNull();
    // …and the explicit close works too
    await ownerDb.delete(invoiceLines).where(eq(invoiceLines.invoiceId, p2!));
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    await owner().ingest.resolvePageFlag({ documentId: d2!.id, action: 'close_unreadable' });
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p2! })).toBeNull();
  });

  it('R6: a merged document whose rows are all flagged counts as ONE question', async () => {
    const [p1, p2] = await pages(2, 'r7n');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-732' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true);
    const before = (await owner().ingest.overview()).pageQuestions;
    await writeOcr(p1!, { failed: true });
    expect((await settle(p1!)).flagged).toEqual([{ invoiceId: p1, reason: 'page_unreadable' }]); // 2 rows flagged
    expect((await owner().ingest.overview()).pageQuestions).toBe(before + 1);
  });

  it('R7/M11 (round 8): the number stays reserved through the re-read; only a terminal failure releases it (audit keeps it)', async () => {
    const [p1, p2] = await pages(2, 'r7o');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-733' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true);
    const [during] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1!));
    expect(during!.invoiceNumber).toBe('A-733'); // a copy read meanwhile collides with THIS (it is the duplicate)
    await ownerDb.update(invoices).set({ status: 'parsed', ocrPayload: { raw: { ocrFailed: true } } as never }).where(eq(invoices.id, p1!));
    expect((await settle(p1!)).flagged).toEqual([{ invoiceId: p1, reason: 'page_unreadable' }]);
    const [after] = await ownerDb.select().from(invoices).where(eq(invoices.id, p1!));
    expect(after!.invoiceNumber).toBeNull();
    const audit = await ownerDb.select().from(auditLog).where(eq(auditLog.entityId, p1!));
    expect(audit.find((a) => a.action === 'document.reopened_for_ocr')?.before).toMatchObject({ invoiceNumber: 'A-733' });
  });

  it("R8: page 1 a person corrected (hand lines / typed header) is never read away → page_merge_blocked", async () => {
    const [p1, p2] = await pages(2, 'r7c');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-734' });
    await ownerDb
      .update(invoices)
      .set({ ocrPayload: sql`jsonb_set(coalesce(${invoices.ocrPayload}, '{}'::jsonb), '{raw,headerEntered}', 'true'::jsonb, true)` })
      .where(eq(invoices.id, p1!));
    expect(await ocr(p2!, NOHEAD)).toMatchObject({ absorbed: false, flagged: [{ invoiceId: p2, reason: 'page_merge_blocked' }] });
  });

  it('R9 (round 8): approving one page never registers — or stamps a supplier on — a page nobody looked at', async () => {
    const stranger = '972507777777';
    const m1 = await send(ch.wa, wa([pngBytes('r7g-1')], { from: stranger }), at(0));
    const m2 = await send(ch.wa, wa([pngBytes('r7g-2')], { from: stranger }), at(2));
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    const res = await owner().ingest.approveDocument({ documentId: d1!.id, supplierId: A.supplierId });
    const [r2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id));
    expect(r2!.status).toBe('needs_review'); // approved later, with ITS supplier
    expect(r2!.invoiceId).toBeNull();
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, res.invoiceId!));
    expect(inv!.supplierId).toBe(A.supplierId);
  });
});

describe('round 7 · R11: every recomposition path keeps the failed-re-read guard', () => {
  it('splitDocument: a split-off part (and the re-opened original) whose read fails terminally is page_unreadable, never silent', async () => {
    const [p1, p2] = await pages(2, 'r7s');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-741' });
    expect((await ocr(p2!, NOHEAD)).absorbed).toBe(true);
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-741' }); // the composed read landed
    const split = await withRestaurant(appDb, A.restaurantId, (tx) =>
      splitDocument(tx, { restaurantId: A.restaurantId, invoiceId: p1!, pages: [[0], [1]] }, { enqueue: async () => {} }),
    );
    expect(split.invoiceIds).toHaveLength(2);
    for (const id of split.invoiceIds) {
      await writeOcr(id, { failed: true });
      expect((await settle(id)).flagged).toEqual([{ invoiceId: id, reason: 'page_unreadable' }]);
    }
  });
});

describe('round 8 · P1: page 1 is the chain page settle recorded (never a "newest earlier row" guess)', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const owner = () =>
    appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);
  const related = async (invoiceId: string) => {
    const inbox = await owner().ingest.inbox({ filter: 'errors' });
    return inbox.flatMap((m) => m.documents).find((d) => d.invoiceId === invoiceId)?.relatedInvoiceId ?? null;
  };

  it('ONE message with 3 photos [p1 no number, p2 A-777, p3]: p1 is held; both flagged pages point at p1', async () => {
    const m = await send(ch.wa, wa([jpegBytes('r8o-1'), jpegBytes('r8o-2'), jpegBytes('r8o-3')]), at(0));
    const [d1, d2, d3] = await docsOf((m as { messageId: string }).messageId);
    const [p1, p2, p3] = [d1!.invoiceId!, d2!.invoiceId!, d3!.invoiceId!];
    await writeOcr(p1, { ...ACME, invoiceNumber: null });
    await writeOcr(p2, { ...ACME, invoiceNumber: 'A-777' });
    await writeOcr(p3, NOHEAD);
    const s = await settle(p3);
    expect(s.flagged.map((f) => [f.invoiceId, f.reason])).toEqual([
      [p2, 'page_not_merged'],
      [p3, 'page_not_merged'],
    ]);
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p1 })).toMatchObject({ flag: 'page_belongs' });
    expect(await related(p2)).toBe(p1);
    // Round 9 (N1): p3 most likely continues A-777 (the run head) — p1, still open, is held too.
    expect(await related(p3)).toBe(p2);
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p2 })).toMatchObject({ documentId: d2!.id });
  });

  it('interleaved [p1 ACME A-100, p2 OTHER supplier, p3 ACME]: p3 points at p1, never at the other supplier', async () => {
    const [p1, p2, p3] = await pages(3, 'r8i');
    await writeOcr(p1!, { ...ACME, invoiceNumber: 'A-801' });
    await writeOcr(p2!, OTHER);
    await writeOcr(p3!, { ...ACME, invoiceNumber: 'A 801' });
    const s = await settle(p3!);
    expect(s.flagged.find((f) => f.invoiceId === p3)?.reason).toBe('page_not_merged');
    expect(await related(p3!)).toBe(p1);
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p1! })).toMatchObject({ flag: 'page_belongs' });
  });
});

describe('round 8 · M16/M9: a truthful "checked together" answer, available with intake OFF', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const owner = () =>
    appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);

  it('flag (page 1 linked) → intake switched OFF → "checked together" → page 1 approvable, no "separate" claimed', async () => {
    const [p1, p2] = await pages(2, 'r8t');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-811' });
    const [run] = await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p1!, grId: A.grId, overallStatus: 'minor' }).returning();
    const [gap] = await ownerDb
      .insert(discrepancies)
      .values({ matchRunId: run!.id, restaurantId: A.restaurantId, type: 'PRICE_HIGHER', severity: 'warn', requiresRole: 'manager', deltaAmount: '9.00' })
      .returning();
    expect((await ocr(p2!, NOHEAD)).flagged).toEqual([{ invoiceId: p2, reason: 'page_merge_blocked' }]);
    expect(await owner().ingest.pageQuestionOf({ invoiceId: p1! })).toMatchObject({ flag: 'page_belongs', pageInvoiceId: p2, otherInvoiceId: p1 });
    const [rest] = await ownerDb.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    const saved = rest!.settings;
    try {
      await ownerDb
        .update(restaurants)
        .set({ settings: { ...(saved as object), features: { ...((saved as { features?: object }).features ?? {}), ingestWhatsapp: false, ingestEmail: false } } as never })
        .where(eq(restaurants.id, A.restaurantId));
      const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
      await owner().ingest.resolvePageFlag({ documentId: d2!.id, action: 'checked_together', payableInvoiceId: p1! });
      expect((await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id)))[0]!.error).toBe('page_checked_together');
      expect(await owner().ingest.pageQuestionOf({ invoiceId: p1! })).toBeNull();
      await expect(owner().approvals.approve({ discrepancyId: gap!.id })).resolves.toBeTruthy();
    } finally {
      await ownerDb.update(restaurants).set({ settings: saved as never }).where(eq(restaurants.id, A.restaurantId));
    }
  });
});

describe('round 9 · N4: "checked together" keeps exactly ONE of the two invoices payable', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const owner = () =>
    appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);
  const withPayRun = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const [rest] = await ownerDb.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    const saved = rest!.settings as { features?: Record<string, unknown> };
    try {
      await ownerDb
        .update(restaurants)
        .set({ settings: { ...saved, features: { ...(saved.features ?? {}), payRun: true } } as never })
        .where(eq(restaurants.id, A.restaurantId));
      return await fn();
    } finally {
      await ownerDb.update(restaurants).set({ settings: saved as never }).where(eq(restaurants.id, A.restaurantId));
    }
  };
  const payRow = async (invoiceId: string) =>
    (await owner().payRun.month()).suppliers.flatMap((g) => g.invoices).find((i) => i.invoiceId === invoiceId) ?? null;

  it('page 1 ₪1,000 + page 2 ₪1,500 (the document total): the person picks page 2 → page 1 is held "paid with" page 2, never ₪2,500', async () => {
    const [p1, p2] = await pages(2, 'r9n4');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-941', totalInclVat: '1000.00' });
    await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p1!, grId: A.grId, overallStatus: 'clean' });
    expect((await ocr(p2!, { ...NOHEAD, totalInclVat: '1500.00' })).flagged).toEqual([{ invoiceId: p2, reason: 'page_merge_blocked' }]);
    await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p2!, grId: A.grId, overallStatus: 'clean' });
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    // the answer must say which invoice carries the total
    await expect(owner().ingest.resolvePageFlag({ documentId: d2!.id, action: 'checked_together' })).rejects.toMatchObject({ message: 'payable_required' });
    await withPayRun(async () => {
      await owner().ingest.resolvePageFlag({ documentId: d2!.id, action: 'checked_together', payableInvoiceId: p2! });
      expect(await payRow(p1!)).toMatchObject({ status: 'hold', paidWith: p2 });
      expect(await payRow(p2!)).toMatchObject({ paidWith: null, openPageQuestion: false });
    });
  });

  it('a foreign / unrelated invoice is never accepted as the payable one', async () => {
    const [p1, p2] = await pages(2, 'r9n4b');
    await ocr(p1!, { ...ACME, invoiceNumber: 'A-942' });
    await ownerDb.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: p1!, grId: A.grId, overallStatus: 'clean' });
    await ocr(p2!, NOHEAD);
    const [d2] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, p2!));
    await expect(
      owner().ingest.resolvePageFlag({ documentId: d2!.id, action: 'checked_together', payableInvoiceId: A.invoiceId }),
    ).rejects.toMatchObject({ message: 'payable_required' });
    expect((await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.id, d2!.id)))[0]!.error).toBe('page_merge_blocked');
  });
});

describe('round 8 · L4: switch OFF intake is as before G-09', () => {
  it('no invoice_scans mapping row and no G-09 OCR dedupe key while multiPage is off', async () => {
    const [rest] = await ownerDb.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    const saved = rest!.settings as { features?: Record<string, unknown> };
    try {
      await ownerDb
        .update(restaurants)
        .set({ settings: { ...saved, features: { ...(saved.features ?? {}), multiPage: false } } as never })
        .where(eq(restaurants.id, A.restaurantId));
      const id = await invoiceOf(await send(ch.wa, wa([jpegBytes('r8-off')]), at(0)));
      expect(await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, id))).toHaveLength(0);
      expect((await ocrJobs(id)).map((j) => j.dedupe_key)).toEqual([null]);
    } finally {
      await ownerDb.update(restaurants).set({ settings: saved as never }).where(eq(restaurants.id, A.restaurantId));
    }
  });
});

describe('round 9 · N1/N3: a stray page points at the run it follows — every plausible head is held', () => {
  beforeEach(() => {
    matchCalls = [];
    ocrCalls = [];
  });
  const owner = () =>
    appRouter.createCaller({
      db: ownerDb,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
    } as AppContext);
  const related = async (invoiceId: string) => {
    const inbox = await owner().ingest.inbox({ filter: 'errors' });
    return inbox.flatMap((m) => m.documents).find((d) => d.invoiceId === invoiceId)?.relatedInvoiceId ?? null;
  };
  const COMPLETE: OcrHead = { ...ACME, lines: [{ qty: '1', total: '500.00', desc: 'whole invoice line' }], totalExclVat: '500.00' };
  const pageQ = (invoiceId: string) => owner().ingest.pageQuestionOf({ invoiceId });

  const burst = async (shape: 'messages' | 'one', tag: string): Promise<string[]> => {
    if (shape === 'messages') return pages(3, tag);
    const m = await send(ch.wa, wa([jpegBytes(`${tag}-0`), jpegBytes(`${tag}-1`), jpegBytes(`${tag}-2`)]), at(0));
    return (await docsOf((m as { messageId: string }).messageId)).map((d) => d.invoiceId!);
  };

  for (const shape of ['messages', 'one'] as const) {
    it(`[complete A-100, B-200 p1, B-200 p2] (${shape}): the continuation holds B-200, never the complete A-100`, async () => {
      const [a, b1, b2] = await burst(shape, `r9n1-${shape}`);
      await writeOcr(a!, { ...COMPLETE, invoiceNumber: shape === 'one' ? 'A-911' : 'A-910' });
      await writeOcr(b1!, { ...ACME, invoiceNumber: shape === 'one' ? 'B-211' : 'B-210' });
      await writeOcr(b2!, NOHEAD);
      const s = await settle(b2!);
      expect(s.flagged.find((f) => f.invoiceId === b2)?.reason).toBe('page_not_merged');
      expect(await pageQ(a!)).toBeNull(); // the complete invoice is not held
      expect(await related(b2!)).toBe(b1); // compare / "check both together" shows B-200
      // B-200 answered "separate" is STILL held by its continuation (r8 let it be paid)
      const [db1] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, b1!));
      if (db1!.error) await owner().ingest.resolvePageFlag({ documentId: db1!.id, action: 'separate' });
      expect(await pageQ(b1!)).toMatchObject({ flag: 'page_belongs', otherInvoiceId: b1 });
    });
  }

  it('[unreadable p1, A-100, continuation]: the continuation holds A-100 AND the open page 1', async () => {
    const [p1, p2, p3] = await pages(3, 'r9n1u');
    await writeOcr(p1!, { failed: true });
    await writeOcr(p2!, { ...ACME, invoiceNumber: 'A-912' });
    await writeOcr(p3!, NOHEAD);
    await settle(p3!);
    expect(await related(p3!)).toBe(p2);
    expect(await pageQ(p2!)).not.toBeNull();
    expect(await pageQ(p1!)).not.toBeNull();
  });

  it("[ACME A-100, OTHER supplier, ACME 'A 100']: the run head skips the other supplier's page", async () => {
    const [p1, p2, p3] = await pages(3, 'r9n1o');
    await writeOcr(p1!, { ...ACME, invoiceNumber: 'A-913' });
    await writeOcr(p2!, OTHER);
    await writeOcr(p3!, { ...ACME, invoiceNumber: 'A 913' });
    await settle(p3!);
    expect(await related(p3!)).toBe(p1);
    expect(await pageQ(p1!)).toMatchObject({ flag: 'page_belongs', otherInvoiceId: p1 });
    expect(await pageQ(p2!)).not.toMatchObject({ flag: 'page_belongs' });
  });

  it('N3: two back-to-back 2-page invoices [A p1, A p2, B p1, B p2] — B p2 holds B (and the open A), compare shows B', async () => {
    const [a1, a2, b1, b2] = await pages(4, 'r9n3');
    await writeOcr(a1!, { ...ACME, invoiceNumber: 'A-914' });
    await writeOcr(a2!, NOHEAD);
    await writeOcr(b1!, { ...ACME, invoiceNumber: 'B-214' });
    await writeOcr(b2!, NOHEAD);
    const s = await settle(b2!);
    expect(s.flagged.find((f) => f.invoiceId === b2)?.reason).toBe('page_not_merged');
    expect(await related(b2!)).toBe(b1);
    expect(await pageQ(a1!)).not.toBeNull(); // when in doubt: the open A is held too
    // B p1's own question answered "separate" — B is STILL held by its undecided page 2
    const [db1] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.invoiceId, b1!));
    expect(await pageQ(b1!)).toMatchObject({ documentId: db1!.id });
    await owner().ingest.resolvePageFlag({ documentId: db1!.id, action: 'separate' });
    expect(await pageQ(b1!)).toMatchObject({ flag: 'page_belongs', otherInvoiceId: b1 });
  });
});
