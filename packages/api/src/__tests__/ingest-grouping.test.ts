/**
 * G-09 · one document = one invoice on the WhatsApp / e-mail intake.
 * Drives processInboundMessage on the RLS-enforced app role with the stub
 * provider (as ingest.attack.test.ts does): no network, no paid OCR.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestSenders,
  invoiceScans,
  invoices,
  restaurants,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { StubIngestProvider, type InboundMessage } from '@restomatch/ingest';
import { processInboundMessage, registerReviewGroup, type ResolvedChannel } from '../ingest/pipeline';
import { __setReocrEdgeForTests } from '../documents/intake';
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
  __setReocrEdgeForTests(true);
});

afterEach(() => __setReocrEdgeForTests(false));
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('one message → one document', () => {
  it('an e-mail with 3 images → ONE 3-page document, every attachment row points at it', async () => {
    const out = await send(ch.email, mail([1, 2, 3].map((i) => ({ name: `p${i}.jpg`, bytes: jpegBytes(`m3-${i}`, 40_000) }))), at(0));
    expect(out.status).toBe('accepted');
    const docs = await docsOf((out as { messageId: string }).messageId);
    expect(docs.map((d) => d.status)).toEqual(['registered', 'registered', 'registered']);
    const ids = new Set(docs.map((d) => d.invoiceId));
    expect(ids.size).toBe(1);
    const invoiceId = docs[0]!.invoiceId!;
    expect(await invoicesOfA()).toHaveLength(1);
    expect(await pdfPagesOf(invoiceId)).toBe(3);
    expect((await ocrJobs(invoiceId)).map((j) => j.dedupe_key)).toEqual([`ocr:${invoiceId}:3`]);
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
});

describe('one sender within N minutes → one document', () => {
  it('a 2-photo WhatsApp invoice (two messages, 3 min apart) → ONE invoice, one extra OCR job, both pages composed', async () => {
    const m1 = await send(ch.wa, wa([jpegBytes('wa-p1')]), at(0));
    const m2 = await send(ch.wa, wa([jpegBytes('wa-p2')]), at(3));
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    expect(d2!.invoiceId).toBe(d1!.invoiceId);
    expect(await invoicesOfA()).toHaveLength(1);
    const invoiceId = d1!.invoiceId!;
    expect(await pdfPagesOf(invoiceId)).toBe(2);
    expect((await ocrJobs(invoiceId)).map((j) => j.dedupe_key)).toEqual([`ocr:${invoiceId}:1`, `ocr:${invoiceId}:2`]);
    const [scan] = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.invoiceId, invoiceId));
    expect(scan!.pageCount).toBe(2);
  });

  it('a 3rd photo 11 min after the first → a new document', async () => {
    await send(ch.wa, wa([jpegBytes('n-p1')]), at(0));
    await send(ch.wa, wa([jpegBytes('n-p2')]), at(3));
    await send(ch.wa, wa([jpegBytes('n-p3')]), at(11));
    const inv = await invoicesOfA();
    expect(inv).toHaveLength(2);
  });

  it('settings.ingest.groupMinutes (5) is honoured', async () => {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true }, ingest: { groupMinutes: 5 } } as never })
      .where(eq(restaurants.id, A.restaurantId));
    await send(ch.wa, wa([jpegBytes('g-p1')]), at(0));
    await send(ch.wa, wa([jpegBytes('g-p2')]), at(4));
    expect(await invoicesOfA()).toHaveLength(1);
    await send(ch.wa, wa([jpegBytes('g-p3')]), at(6));
    expect(await invoicesOfA()).toHaveLength(2);
  });

  it('a photo after the first invoice was approved → a new document', async () => {
    const m1 = await send(ch.wa, wa([jpegBytes('ap-p1')]), at(0));
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    await ownerDb.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, d1!.invoiceId!));
    const m2 = await send(ch.wa, wa([jpegBytes('ap-p2')]), at(2));
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    expect(d2!.invoiceId).not.toBe(d1!.invoiceId);
    expect(await ocrJobs(d1!.invoiceId!)).toHaveLength(1);
  });

  it('the same bytes re-sent → duplicate: no page, no OCR', async () => {
    const bytes = jpegBytes('same');
    const m1 = await send(ch.wa, wa([bytes]), at(0));
    const m2 = await send(ch.wa, wa([bytes]), at(1));
    const [d1] = await docsOf((m1 as { messageId: string }).messageId);
    const [d2] = await docsOf((m2 as { messageId: string }).messageId);
    expect(d2).toMatchObject({ status: 'duplicate', invoiceId: d1!.invoiceId });
    expect(await pdfPagesOf(d1!.invoiceId!)).toBe(1);
    expect(await ocrJobs(d1!.invoiceId!)).toHaveLength(1);
  });

  it('with the re-OCR edge OFF (production default) a later photo is its own document', async () => {
    __setReocrEdgeForTests(false);
    await send(ch.wa, wa([jpegBytes('off-p1')]), at(0));
    await send(ch.wa, wa([jpegBytes('off-p2')]), at(2));
    expect(await invoicesOfA()).toHaveLength(2);
  });
});

describe('review documents and the mapping row', () => {
  it("an unknown sender's 2 photos → one review document; approving registers ONE invoice with both pages", async () => {
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
    expect(await invoicesOfA()).toHaveLength(1);
    expect(await pdfPagesOf(reg.invoiceId)).toBe(2);
  });

  it('invoice_scans.invoice_id is the invoice UUID, with page_count', async () => {
    const out = await send(ch.wa, wa([jpegBytes('map-1'), jpegBytes('map-2')]), at(0));
    const [d] = await docsOf((out as { messageId: string }).messageId);
    const rows = await ownerDb.select().from(invoiceScans).where(eq(invoiceScans.restaurantId, A.restaurantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ invoiceId: d!.invoiceId, pageCount: 2, mimeType: 'application/pdf' });
    expect(rows[0]!.storagePath.startsWith(`${A.restaurantId}/`)).toBe(true);
  });

  it('a new invoice row never stores an expiring signed URL (a stable object form)', async () => {
    const out = await send(ch.wa, wa([jpegBytes('stable')]), at(0));
    const [d] = await docsOf((out as { messageId: string }).messageId);
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, d!.invoiceId!));
    expect(inv!.rawImageUrl).not.toMatch(/[?&]token=/);
    expect(toObjectRef(inv!.rawImageUrl!, A.restaurantId)).toBeTruthy();
  });
});

