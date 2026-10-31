/**
 * G-09 sweep: path-form scans (`<restaurantId>/scan-….<ext>`, stored since G-09
 * instead of an expiring signed URL) are retried and signed at sweep time,
 * including an invoice re-opened for a composed re-OCR whose job was lost; and
 * a multi-page page held for a sibling that never settled is released to the
 * match after G09_HOLD_MAX_MS.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  invoiceScans,
  invoices,
  restaurants,
  testDbUrl,
} from '@restomatch/db';
import { insertJob, queueSql } from '@restomatch/queue';
import { runOcrSweep } from '../jobs/ocrSweep';

process.env.LOCAL_SCAN_DIR = mkdtempSync(join(tmpdir(), 'ocr-sweep-g09-'));

const db = createDb(testDbUrl());
const sql = queueSql(testDbUrl());
const NOW = new Date('2026-11-02T09:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const rids: string[] = [];
const ids: Record<string, string> = {};
const mine = (list: string[] | undefined) => (list ?? []).filter((id) => Object.values(ids).includes(id));

async function jobs(queue: string, invoiceId: string) {
  return sql<Array<{ dedupe_key: string | null; payload: Record<string, unknown> }>>`
    SELECT dedupe_key, payload FROM job_queue WHERE queue = ${queue} AND payload->>'invoiceId' = ${invoiceId} ORDER BY id`;
}

async function restaurant(name: string, multiPage: boolean) {
  const [r] = await db
    .insert(restaurants)
    .values({ name, settings: { features: multiPage ? { multiPage: true } : {} } as never })
    .returning({ id: restaurants.id });
  rids.push(r!.id);
  return r!.id;
}

async function invoice(rid: string, key: string, opts: { status: string; age: number; url: string; pages?: number }) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: rid,
      source: 'whatsapp',
      status: opts.status as never,
      rawImageUrl: opts.url,
      createdAt: minutesAgo(opts.age),
      updatedAt: minutesAgo(opts.age),
    })
    .returning({ id: invoices.id });
  ids[key] = inv!.id;
  if (opts.pages) {
    await db.insert(invoiceScans).values({ invoiceId: inv!.id, restaurantId: rid, storagePath: opts.url, mimeType: 'application/pdf', pageCount: opts.pages });
  }
  return inv!.id;
}

const channels = new Map<string, string>();
async function ingestPage(rid: string, invoiceId: string) {
  if (!channels.has(rid)) {
    const [c] = await db
      .insert(ingestChannels)
      .values({ restaurantId: rid, kind: 'whatsapp', tokenHash: `h-${rid}`, tokenHint: 'wa' })
      .returning({ id: ingestChannels.id });
    channels.set(rid, c!.id);
  }
  const ch = { id: channels.get(rid)! };
  const [m] = await db
    .insert(ingestMessages)
    .values({ restaurantId: rid, channelId: ch.id, kind: 'whatsapp', provider: 'stub', providerMessageId: `m-${invoiceId}`, sender: '9725', senderAllowed: true, status: 'accepted' })
    .returning({ id: ingestMessages.id });
  await db.insert(ingestDocuments).values({ restaurantId: rid, messageId: m!.id, status: 'registered', invoiceId, storagePath: `${rid}/scan-a1-0000aaaa.jpg`, mimeType: 'image/jpeg' });
}

let A = '';
let B = '';
let OFF = '';

beforeAll(async () => {
  A = await restaurant('G-09 sweep A', true);
  B = await restaurant('G-09 sweep B', true);
  OFF = await restaurant('G-09 sweep switch off', false);
  // U-1: path-form scans.
  await invoice(A, 'lost', { status: 'ocr_pending', age: 15, url: `${A}/scan-a1b2-0000beef.jpg` });
  const queued = await invoice(A, 'queued', { status: 'ocr_pending', age: 15, url: `${A}/scan-a1b2-0000cafe.jpg` });
  await insertJob(sql, 'ocr-invoice', { restaurantId: A, invoiceId: queued }, { restaurantId: A, dedupeKey: `ocr:${queued}:1` });
  const reocr = await invoice(A, 'reocr', { status: 'ocr_pending', age: 20, url: `${A}/scan-c0de-0000f00d.pdf`, pages: 2 });
  await insertJob(sql, 'ocr-invoice', { restaurantId: A, invoiceId: reocr }, { restaurantId: A, dedupeKey: `ocr:${reocr}:1` }); // the old 1-page read
  await invoice(A, 'foreign', { status: 'ocr_pending', age: 15, url: `${B}/scan-a1b2-0000dead.jpg` }); // another tenant's prefix
  await invoice(A, 'freshPath', { status: 'ocr_pending', age: 3, url: `${A}/scan-a1b2-00001234.jpg` });
  // HIGH-2 backstop: held pages.
  const held = await invoice(A, 'held', { status: 'matched', age: 40, url: `${A}/scan-h1-00000001.jpg` });
  await ingestPage(A, held);
  const young = await invoice(A, 'heldYoung', { status: 'matched', age: 10, url: `${A}/scan-h1-00000002.jpg` });
  await ingestPage(A, young);
  const off = await invoice(OFF, 'heldSwitchOff', { status: 'matched', age: 40, url: `${OFF}/scan-h1-00000003.jpg` });
  await ingestPage(OFF, off);
  const photo = await invoice(A, 'notIngested', { status: 'matched', age: 40, url: `${A}/scan-h1-00000004.jpg` });
  void photo;
});

afterAll(async () => {
  for (const rid of rids) {
    await sql`DELETE FROM job_queue WHERE restaurant_id = ${rid}`;
    await db.delete(ingestDocuments).where(eq(ingestDocuments.restaurantId, rid));
    await db.delete(ingestMessages).where(eq(ingestMessages.restaurantId, rid));
    await db.delete(ingestChannels).where(eq(ingestChannels.restaurantId, rid));
    await db.delete(invoices).where(eq(invoices.restaurantId, rid));
    await db.delete(restaurants).where(eq(restaurants.id, rid));
  }
});

describe('G-09 sweep', () => {
  it('U-1: a path-form ocr_pending invoice whose job was lost is retried, signed at sweep time', async () => {
    const res = await runOcrSweep(sql, NOW);
    expect(mine(res.requeued).sort()).toEqual([ids.lost, ids.reocr].sort());
    const [job] = await jobs('ocr-invoice', ids.lost!);
    expect(job!.dedupe_key).toBe(`ocr-sweep-${ids.lost}:1`);
    expect(job!.payload).toMatchObject({ restaurantId: A, invoiceId: ids.lost });
    expect(String(job!.payload.imageUrl)).toMatch(/\/scans\/scan-a1b2-0000beef\/file$/); // signed (local dev form)
    expect(await jobs('ocr-invoice', ids.queued!)).toHaveLength(1); // its job is on record
    expect(await jobs('ocr-invoice', ids.foreign!)).toHaveLength(0); // never another tenant's object
    expect(await jobs('ocr-invoice', ids.freshPath!)).toHaveLength(0); // not stale yet
  });

  it('U-1: an invoice re-opened for a composed re-OCR (2 pages) is retried despite its old 1-page job', async () => {
    const all = await jobs('ocr-invoice', ids.reocr!);
    expect(all.map((j) => j.dedupe_key)).toEqual([`ocr:${ids.reocr}:1`, `ocr-sweep-${ids.reocr}:2`]);
  });

  it('HIGH-2: a held page past the cap is released to the match, once; young, switch-off and non-ingest pages are not', async () => {
    const res = await runOcrSweep(sql, NOW);
    expect(mine(res.released)).toEqual([]); // already released by the first sweep
    expect((await jobs('match-invoice', ids.held!)).map((j) => j.dedupe_key)).toEqual([`g09-release-${ids.held}`]);
    for (const k of ['heldYoung', 'heldSwitchOff', 'notIngested']) expect(await jobs('match-invoice', ids[k]!)).toHaveLength(0);
    expect(mine(res.requeued)).toEqual([]); // idempotent
  });
});
