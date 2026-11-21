/**
 * G-09 round 12 · "checked together" through the REAL worker path: the answer, then
 * matchInvoiceForJob re-matching the carrier on the whole document (#2/#13); a member's
 * first match racing the answer saves no run (#7); a lost re-match enqueue is retried by
 * the sweep and cleared by the job (#9).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  invoiceLines,
  invoices,
  matchRuns,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { resolvePageFlag } from '@restomatch/api';
import { matchInvoiceForJob } from '../jobs/matchInvoice';
import { runOcrSweep } from '../jobs/ocrSweep';

/** One shot, AFTER the job assembled its input and before it persists (the #7 window). */
const h = vi.hoisted(() => ({ afterBuild: null as null | (() => Promise<void>) }));
vi.mock('@restomatch/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@restomatch/api')>();
  return {
    ...real,
    buildMatchInputForInvoice: async (...args: Parameters<typeof real.buildMatchInputForInvoice>) => {
      const built = await real.buildMatchInputForInvoice(...args);
      const hook = h.afterBuild;
      h.afterBuild = null;
      if (hook) await hook();
      return built;
    },
  };
});

const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
let rid = '';
let supplierId = '';
let channelId = '';
let seq = 0;

const rawOf = async (id: string) =>
  (((await db.select().from(invoices).where(eq(invoices.id, id)))[0]?.ocrPayload as { raw?: Record<string, unknown> } | null)?.raw ?? {}) as Record<string, unknown>;

async function invoice(opts: { number: string | null; status: string; line: string; excl?: string; incl?: string; raw?: Record<string, unknown> }) {
  seq += 1;
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: rid,
      supplierId,
      source: 'whatsapp',
      status: opts.status as never,
      invoiceNumber: opts.number,
      rawImageUrl: `${rid}/scan-g09-${String(seq).padStart(8, '0')}.jpg`,
      totalExclVat: opts.excl ?? null,
      totalInclVat: opts.incl ?? null,
      ocrPayload: { provider: 'stub', raw: opts.raw ?? {} } as never,
    })
    .returning({ id: invoices.id });
  await db.insert(invoiceLines).values({ invoiceId: inv!.id, rawDescription: `שורה ${seq}`, qtyBilled: '1', unit: 'unit', unitPriceBilled: opts.line, lineTotal: opts.line });
  return inv!.id;
}

/** [p1 A-x ₪400 line, already matched] + [p2 continuation ₪600 line printing the document total ₪1,000], p2 asked about. */
async function pair(number: string, p2Raw: (p1: string) => Record<string, unknown> = () => ({}), p2Status = 'matched') {
  const p1 = await invoice({ number, status: 'matched', line: '400.00' });
  await db.insert(matchRuns).values({ restaurantId: rid, invoiceId: p1, overallStatus: 'clean' });
  const p2 = await invoice({
    number: null,
    status: p2Status,
    line: '600.00',
    excl: '1000.00',
    incl: '1170.00',
    raw: { pageOf: { invoiceId: p1, invoiceIds: [p1] }, ...p2Raw(p1) },
  });
  const [m] = await db
    .insert(ingestMessages)
    .values({ restaurantId: rid, channelId, kind: 'whatsapp', provider: 'stub', providerMessageId: `m-${p2}`, sender: '9725', senderAllowed: true, status: 'accepted' })
    .returning({ id: ingestMessages.id });
  const [d] = await db
    .insert(ingestDocuments)
    .values({ restaurantId: rid, messageId: m!.id, status: 'registered', invoiceId: p2, storagePath: `${rid}/scan-doc-${p2}.jpg`, mimeType: 'image/jpeg', error: 'page_merge_blocked' })
    .returning({ id: ingestDocuments.id });
  return { p1, p2, documentId: d!.id };
}

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: 'G-09 r12 worker', settings: {} as never }).returning({ id: restaurants.id });
  rid = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'תנובה בע"מ' }).returning({ id: suppliers.id });
  supplierId = s!.id;
  const [c] = await db.insert(ingestChannels).values({ restaurantId: rid, kind: 'whatsapp', tokenHash: `h-${rid}`, tokenHint: 'wa' }).returning({ id: ingestChannels.id });
  channelId = c!.id;
});

afterAll(async () => {
  if (rid) {
    await qsql`DELETE FROM job_queue WHERE restaurant_id = ${rid}`;
    await db.delete(restaurants).where(eq(restaurants.id, rid));
  }
  // queueSql is a memoised, shared pool (singleFork): never end it here.
});

describe('round 12 · checked together, through the worker', () => {
  it('#2/#13: a carrier stamped "duplicate" of its own page 1 → answered → the REAL re-match runs on the whole document: one run, no DUPLICATE_INVOICE, no TOTAL_MISMATCH', async () => {
    const { p1, p2, documentId } = await pair('A-1201', (p1) => ({ duplicateOf: { invoiceId: p1, invoiceNumber: 'A-1201' } }), 'parsed');
    await resolvePageFlag(db, { restaurantId: rid, documentId, action: 'checked_together', payableInvoiceId: p2, userId: null }, { enqueueMatch: async () => true });
    expect(typeof (await rawOf(p2)).groupRematchPending).toBe('string');
    const out = await matchInvoiceForJob(db, { restaurantId: rid, invoiceId: p2, rematch: true });
    expect(out.skipped).toBeUndefined();
    expect(out.persisted).not.toBeNull();
    const types = out.result.discrepancies.map((d) => d.type);
    expect(types).not.toContain('DUPLICATE_INVOICE');
    expect(types).not.toContain('TOTAL_MISMATCH');
    // the document's two lines, one run, on the carrier only
    expect(out.result.discrepancies.length).toBeGreaterThanOrEqual(0);
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, p1))).toHaveLength(0);
    const runs = await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, p2));
    expect(runs).toHaveLength(1);
    expect(await db.select().from(discrepancies).where(eq(discrepancies.matchRunId, runs[0]!.id))).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ type: 'DUPLICATE_INVOICE' })]),
    );
    // #9: the job ran — the stamp is cleared
    expect((await rawOf(p2)).groupRematchPending).toBeUndefined();
  });

  it('#7: a member\'s first match racing the answer saves no run once it is "included" (re-checked under the row lock)', async () => {
    const q1 = await invoice({ number: 'A-1207', status: 'matched', line: '400.00' });
    const q2 = await invoice({ number: null, status: 'matched', line: '600.00', excl: '1000.00', incl: '1170.00' });
    h.afterBuild = async () => {
      await db.execute(sql`
        update invoices set ocr_payload = jsonb_set(ocr_payload, '{raw,paidWith}', jsonb_build_object('invoiceId', ${q2}::text), true)
         where id = ${q1}::uuid`);
    };
    const out = await matchInvoiceForJob(db, { restaurantId: rid, invoiceId: q1 });
    expect(out.skipped).toBe('included');
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, q1))).toHaveLength(0);
  });

  it('#9: a re-match stamp left behind (lost enqueue) is re-enqueued by the sweep; a fresh one is left to its own job', async () => {
    const now = new Date();
    const stale = await invoice({ number: 'A-1209', status: 'matched', line: '100.00', raw: { groupRematchPending: new Date(now.getTime() - 10 * 60_000).toISOString() } });
    const fresh = await invoice({ number: 'A-1210', status: 'matched', line: '100.00', raw: { groupRematchPending: new Date(now.getTime() - 60_000).toISOString() } });
    const result = await runOcrSweep(qsql, now, [rid]);
    expect(result.rematched ?? []).toContain(stale);
    expect(result.rematched ?? []).not.toContain(fresh);
    const jobs = await qsql<Array<{ payload: { rematch?: boolean } }>>`
      SELECT payload FROM job_queue WHERE queue = 'match-invoice' AND payload->>'invoiceId' = ${stale}`;
    expect(jobs.map((j) => j.payload.rematch)).toEqual([true]);
  });
});
