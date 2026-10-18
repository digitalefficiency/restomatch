import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, eq, invoices, notificationsOutbox, restaurants, testDbUrl } from '@restomatch/db';
import {
  collectHealth,
  digestRecipients,
  issueCount,
  renderHealthDigest,
  runHealthDigest,
  type QueueProbe,
} from '../jobs/healthDigest';

const db = createDb(testDbUrl());
const NOW = new Date('2026-10-18T05:00:00.000Z');
let restaurantId = '';

function probe(name: string, counts: Record<string, number>, failed: QueueProbe['getFailed'] extends (...a: never[]) => Promise<infer R> ? R : never = []): QueueProbe {
  return { name, getJobCounts: async () => counts, getFailed: async () => failed };
}

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: 'Digest QA' }).returning({ id: restaurants.id });
  restaurantId = r!.id;
  // Stuck OCR (2 h old) + fresh OCR (5 min) — only the stale one counts.
  await db.insert(invoices).values([
    { restaurantId, source: 'photo', status: 'ocr_pending', createdAt: new Date(NOW.getTime() - 2 * 3600_000) },
    { restaurantId, source: 'photo', status: 'ocr_pending', createdAt: new Date(NOW.getTime() - 5 * 60_000) },
  ]);
  await db.insert(notificationsOutbox).values({
    restaurantId,
    channel: 'email',
    target: 'x@example.test',
    body: 'b',
    status: 'failed',
    createdAt: new Date(NOW.getTime() - 3600_000),
  });
});
afterEach(() => {
  delete process.env.HEALTH_DIGEST_EMAILS;
  delete process.env.HEALTH_DIGEST_RESTAURANT_ID;
});
afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('health digest', () => {
  const probes = [
    probe('ocr-invoice', { waiting: 3, active: 1, delayed: 0, failed: 2 }, [
      { id: '7', name: 'ocr-invoice', finishedOn: NOW.getTime() - 3600_000, failedReason: 'boom\nstack' },
      { id: '1', name: 'ocr-invoice', finishedOn: NOW.getTime() - 3 * 86_400_000, failedReason: 'old' },
    ]),
    probe('outbox-dispatch', { waiting: 0, active: 0, delayed: 0, failed: 0 }),
  ];

  it('collects queue depths, recent failures, stale OCR and outbox failures', async () => {
    const s = await collectHealth(db, probes, NOW);
    expect(s.queues).toEqual([
      { name: 'ocr-invoice', waiting: 3, active: 1, delayed: 0, failed: 2 },
      { name: 'outbox-dispatch', waiting: 0, active: 0, delayed: 0, failed: 0 },
    ]);
    expect(s.failedLast24h).toEqual([expect.objectContaining({ queue: 'ocr-invoice', id: '7', reason: 'boom' })]);
    expect(s.ocrPendingStale.count).toBeGreaterThanOrEqual(1);
    expect(s.outboxFailedLast24h).toBeGreaterThanOrEqual(1);
    expect(issueCount(s)).toBeGreaterThanOrEqual(3);
  });

  it('renders a subject that says whether anything needs attention', () => {
    const clear = renderHealthDigest({ at: NOW.toISOString(), queues: [], failedLast24h: [], failedLast24hCount: 0, failedCountTruncated: false, ocrPendingStale: { count: 0, oldestAt: null }, outboxFailedLast24h: 0 });
    expect(clear.subject).toBe('RestoMatch health 2026-10-18: all clear');
    const bad = renderHealthDigest({ at: NOW.toISOString(), queues: [], failedLast24h: [], failedLast24hCount: 0, failedCountTruncated: false, ocrPendingStale: { count: 2, oldestAt: null }, outboxFailedLast24h: 0 });
    expect(bad.subject).toMatch(/2 items need attention/);
    expect(bad.html).toContain('OCR pending &gt; 30 min: 2');
  });

  it('enqueues one outbox email per recipient, once per day', async () => {
    process.env.HEALTH_DIGEST_EMAILS = 'ops@example.test, cto@example.test';
    process.env.HEALTH_DIGEST_RESTAURANT_ID = restaurantId;
    const first = await runHealthDigest(db, probes, NOW);
    const second = await runHealthDigest(db, probes, NOW);
    expect(first).toMatchObject({ enqueued: 2, recipients: 2 });
    expect(second).toMatchObject({ enqueued: 0 }); // dedupe_key health-digest:<day>:<to>
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityType, 'health_digest'));
    expect(rows.filter((r) => r.restaurantId === restaurantId)).toHaveLength(2);
  });

  it('skips cleanly with no recipients', async () => {
    const saved = { w: process.env.WORKER_ALERT_EMAILS, p: process.env.PLATFORM_ADMIN_EMAILS };
    delete process.env.WORKER_ALERT_EMAILS;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(digestRecipients()).toEqual([]);
    await expect(runHealthDigest(db, probes, NOW)).resolves.toMatchObject({ skipped: expect.stringMatching(/no recipients/) });
    if (saved.w) process.env.WORKER_ALERT_EMAILS = saved.w;
    if (saved.p) process.env.PLATFORM_ADMIN_EMAILS = saved.p;
  });

  it('counts every failure in the window (not just the first page) and redacts PII', async () => {
    const many = Array.from({ length: 170 }, (_, i) => ({
      id: String(i),
      name: 'match-invoice',
      finishedOn: NOW.getTime() - 60_000 * (i + 1),
      failedReason: `boom for owner@kfar.test 052-123-4567 <script>x</script>\nstack`,
    }));
    const pager: QueueProbe = {
      name: 'match-invoice',
      getJobCounts: async () => ({ failed: 170 }),
      getFailed: async (start = 0, end = 0) => many.slice(start, end + 1),
    };
    const s = await collectHealth(db, [pager], NOW);
    expect(s.failedLast24hCount).toBe(170);
    expect(s.failedLast24h).toHaveLength(10);
    const { text, html } = renderHealthDigest(s);
    expect(text).toContain('Jobs failed (24 h): 170');
    expect(text).not.toMatch(/owner@kfar\.test|052-123-4567/);
    expect(html).not.toContain('<script>');
  });

  it('a manual (force) run does not consume the scheduled daily slot', async () => {
    process.env.HEALTH_DIGEST_EMAILS = 'force@example.test';
    process.env.HEALTH_DIGEST_RESTAURANT_ID = restaurantId;
    const manual = await runHealthDigest(db, probes, NOW, { force: true });
    const scheduled = await runHealthDigest(db, probes, NOW);
    expect(manual).toMatchObject({ enqueued: 1 });
    expect(scheduled).toMatchObject({ enqueued: 1 });
  });

  it('falls back to the oldest restaurant when HEALTH_DIGEST_RESTAURANT_ID is bogus', async () => {
    process.env.HEALTH_DIGEST_EMAILS = 'fallback@example.test';
    process.env.HEALTH_DIGEST_RESTAURANT_ID = 'not-a-uuid';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(runHealthDigest(db, probes, NOW)).resolves.toMatchObject({ enqueued: 1 });
  });
});
