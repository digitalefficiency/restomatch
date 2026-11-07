import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, testDbUrl } from '@restomatch/db';
import { insertJob, queueSql } from '@restomatch/queue';
import { runOcrSweep } from '../jobs/ocrSweep';

const db = createDb(testDbUrl());
const sql = queueSql(testDbUrl());
const NOW = new Date('2026-10-18T09:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
let restaurantId = '';
const ids: Record<string, string> = {};
const mine = (list: string[]) => list.filter((id) => Object.values(ids).includes(id));

async function jobsFor(invoiceId: string) {
  return sql<Array<{ dedupe_key: string | null; payload: Record<string, unknown>; restaurant_id: string }>>`
    SELECT dedupe_key, payload, restaurant_id FROM job_queue
     WHERE queue = 'ocr-invoice' AND payload->>'invoiceId' = ${invoiceId}`;
}

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: 'OCR sweep QA' }).returning({ id: restaurants.id });
  restaurantId = r!.id;
  const rows = [
    ['stale', 'ocr_pending', 15, 'https://x.example/scan-stale.jpg'],
    ['fresh', 'ocr_pending', 5, 'https://x.example/scan-fresh.jpg'],
    ['expired', 'ocr_pending', 40, 'https://x.example/scan-old.jpg'], // signed URL no longer valid
    ['noImage', 'ocr_pending', 15, null],
    ['done', 'matched', 15, 'https://x.example/scan-done.jpg'],
    ['queued', 'ocr_pending', 12, 'https://x.example/scan-queued.jpg'],
    ['failedBefore', 'ocr_pending', 14, 'https://x.example/scan-failed.jpg'],
    ['smoke', 'ocr_pending', 16, 'smoke://all'],
    ['race', 'ocr_pending', 13, 'https://x.example/scan-race.jpg'],
  ] as const;
  for (const [key, status, age, url] of rows) {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId, source: 'photo', status, rawImageUrl: url, createdAt: minutesAgo(age) })
      .returning({ id: invoices.id });
    ids[key] = inv!.id;
  }
  // A backlog job (still queued) and a job that already ran and failed (e.g. quota).
  await insertJob(sql, 'ocr-invoice', { restaurantId, invoiceId: ids.queued });
  await insertJob(sql, 'ocr-invoice', { restaurantId, invoiceId: ids.failedBefore });
  await sql`UPDATE job_queue SET status = 'failed', finished_at = now() WHERE payload->>'invoiceId' = ${ids.failedBefore!}`;
});
afterAll(async () => {
  await sql`DELETE FROM job_queue WHERE restaurant_id = ${restaurantId}`;
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('ocr-pending retry sweep (Postgres queue)', () => {
  it('sweeps only tenants on real OCR: an empty list or another tenant enqueues nothing', async () => {
    expect(mine((await runOcrSweep(sql, NOW, [])).requeued)).toEqual([]);
    expect(mine((await runOcrSweep(sql, NOW, ['33333333-3333-4333-8333-333333333333'])).requeued)).toEqual([]);
    expect(await jobsFor(ids.stale!)).toHaveLength(0);
  });

  it('re-enqueues only stale, never-run, http(s) invoices whose scan URL is still valid', async () => {
    const res = await runOcrSweep(sql, NOW, [restaurantId]);
    expect(mine(res.requeued).sort()).toEqual([ids.race, ids.stale].sort());
    const [job] = await jobsFor(ids.stale!);
    expect(job).toMatchObject({
      dedupe_key: `ocr-sweep-${ids.stale}`,
      restaurant_id: restaurantId,
      payload: { restaurantId, invoiceId: ids.stale, supplierId: null, imageUrl: 'https://x.example/scan-stale.jpg' },
    });
    for (const k of ['fresh', 'expired', 'noImage', 'done', 'smoke']) expect(await jobsFor(ids[k]!)).toHaveLength(0);
    expect(await jobsFor(ids.queued!)).toHaveLength(1); // the backlog job only
    expect(await jobsFor(ids.failedBefore!)).toHaveLength(1); // not retried: it already ran
  });

  it('is idempotent: the retry job itself counts as "on record"', async () => {
    const second = await runOcrSweep(sql, new Date(NOW.getTime() + 5 * 60_000), [restaurantId]);
    expect(mine(second.requeued)).toEqual([]);
    expect(await jobsFor(ids.stale!)).toHaveLength(1);
  });

  it('two sweeps racing on the same invoice enqueue it once (dedupe key)', async () => {
    await sql`DELETE FROM job_queue WHERE payload->>'invoiceId' = ${ids.race!}`;
    const [a, b] = await Promise.all([runOcrSweep(sql, NOW, [restaurantId]), runOcrSweep(sql, NOW, [restaurantId])]);
    const won = [...a.requeued, ...b.requeued].filter((id) => id === ids.race);
    expect(won).toHaveLength(1);
    expect(await jobsFor(ids.race!)).toHaveLength(1);
  });
});

describe('ocr-pending retry sweep — commit-race refusal (Postgres queue)', () => {
  const ids2: Record<string, string> = {};
  let rid2 = '';
  const refusal = (id: string) => `[ocr-invoice] invoice=${id} not found in restaurant=${rid2} — refusing to process`;

  beforeAll(async () => {
    const [r] = await db.insert(restaurants).values({ name: 'OCR sweep race QA' }).returning({ id: restaurants.id });
    rid2 = r!.id;
    for (const key of ['refused', 'quota', 'retryRefused', 'receiving'] as const) {
      const [inv] = await db
        .insert(invoices)
        .values({ restaurantId: rid2, source: 'photo', status: 'ocr_pending', rawImageUrl: `https://x.example/${key}.jpg`, createdAt: minutesAgo(15) })
        .returning({ id: invoices.id });
      ids2[key] = inv!.id;
    }
    // The original job lost the commit race (tenant guard refused it: nothing fetched or metered).
    await insertJob(sql, 'ocr-invoice', { restaurantId: rid2, invoiceId: ids2.refused });
    await sql`UPDATE job_queue SET status = 'failed', finished_at = now(), last_error = ${refusal(ids2.refused!)}
               WHERE payload->>'invoiceId' = ${ids2.refused!}`;
    // A receiving scan's original job carried its goods receipt (#94) and was refused the same way.
    await insertJob(sql, 'ocr-invoice', { restaurantId: rid2, invoiceId: ids2.receiving, grId: 'gr-of-the-scan' });
    await sql`UPDATE job_queue SET status = 'failed', finished_at = now(), last_error = ${refusal(ids2.receiving!)}
               WHERE payload->>'invoiceId' = ${ids2.receiving!}`;
    // Any other failure already ran and was metered.
    await insertJob(sql, 'ocr-invoice', { restaurantId: rid2, invoiceId: ids2.quota });
    await sql`UPDATE job_queue SET status = 'failed', finished_at = now(), last_error = 'QuotaExceededError: monthly OCR cap reached'
               WHERE payload->>'invoiceId' = ${ids2.quota!}`;
    // The sweep's own retry was refused too: it stays on record — no second retry.
    await insertJob(sql, 'ocr-invoice', { restaurantId: rid2, invoiceId: ids2.retryRefused }, { dedupeKey: `ocr-sweep-${ids2.retryRefused}` });
    await sql`UPDATE job_queue SET status = 'failed', finished_at = now(), last_error = ${refusal(ids2.retryRefused!)}
               WHERE payload->>'invoiceId' = ${ids2.retryRefused!}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM job_queue WHERE restaurant_id = ${rid2}`;
    await db.delete(invoices).where(eq(invoices.restaurantId, rid2));
    await db.delete(restaurants).where(eq(restaurants.id, rid2));
  });

  it('an original job refused by the tenant guard did not really run: it gets its one retry; other failures never do', async () => {
    const ours = (list: string[]) => list.filter((id) => Object.values(ids2).includes(id));
    const res = await runOcrSweep(sql, NOW, [rid2]);
    expect(ours(res.requeued).sort()).toEqual([ids2.refused, ids2.receiving].sort());
    const jobs = await jobsFor(ids2.refused!);
    expect(jobs.map((j) => j.dedupe_key ?? '').sort()).toEqual(['', `ocr-sweep-${ids2.refused}`].sort());
    expect(await jobsFor(ids2.quota!)).toHaveLength(1);
    expect(await jobsFor(ids2.retryRefused!)).toHaveLength(1);
    // Once retried, the retry job is on record: a later sweep does not enqueue it again.
    const again = await runOcrSweep(sql, new Date(NOW.getTime() + 5 * 60_000), [rid2]);
    expect(ours(again.requeued)).toEqual([]);
    expect(await jobsFor(ids2.refused!)).toHaveLength(2);
  });

  it("the retry keeps the scan's goods receipt from the original job — the OCR job holds the match on it (#94)", async () => {
    const retry = (await jobsFor(ids2.receiving!)).find((j) => j.dedupe_key === `ocr-sweep-${ids2.receiving}`);
    expect(retry?.payload).toMatchObject({ restaurantId: rid2, invoiceId: ids2.receiving, grId: 'gr-of-the-scan' });
    // A scan whose original job carried no receipt gets none.
    const plain = (await jobsFor(ids2.refused!)).find((j) => j.dedupe_key === `ocr-sweep-${ids2.refused}`);
    expect(plain?.payload).not.toHaveProperty('grId');
  });
});
