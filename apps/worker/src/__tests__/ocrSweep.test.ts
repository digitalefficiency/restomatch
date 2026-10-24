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
  it('re-enqueues only stale, never-run, http(s) invoices whose scan URL is still valid', async () => {
    const res = await runOcrSweep(sql, NOW);
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
    const second = await runOcrSweep(sql, new Date(NOW.getTime() + 5 * 60_000));
    expect(mine(second.requeued)).toEqual([]);
    expect(await jobsFor(ids.stale!)).toHaveLength(1);
  });

  it('two sweeps racing on the same invoice enqueue it once (dedupe key)', async () => {
    await sql`DELETE FROM job_queue WHERE payload->>'invoiceId' = ${ids.race!}`;
    const [a, b] = await Promise.all([runOcrSweep(sql, NOW), runOcrSweep(sql, NOW)]);
    const won = [...a.requeued, ...b.requeued].filter((id) => id === ids.race);
    expect(won).toHaveLength(1);
    expect(await jobsFor(ids.race!)).toHaveLength(1);
  });
});
