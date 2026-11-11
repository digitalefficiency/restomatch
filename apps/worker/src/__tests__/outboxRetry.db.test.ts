import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, eq, inArray, notificationsOutbox, restaurants, testDbUrl } from '@restomatch/db';
import { processOutboxDispatch } from '../jobs/outboxDispatch';
import type { WorkerJob } from '../queue';

/**
 * A send that throws goes back to `queued` with backoff. That branch used to
 * bump no counter and log nothing, so a failing provider showed up in prod as
 * `claimed=1 dispatched=0 failed=0 skipped_no_provider=0` for four ticks. Now
 * it counts as `retried` and logs one redacted line (never the recipient).
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const job: WorkerJob<{ batchSize?: number }> = { id: 't', name: 't', data: {}, attemptsMade: 0, opts: { attempts: 1 } };
const RECIPIENT = `owner-${RUN}@example.co.il`;

let restaurantId = '';
const savedKey = process.env.RESEND_API_KEY;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: `outbox-retry ${RUN}` }).returning();
  restaurantId = r!.id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});
afterAll(async () => {
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
  await db.delete(restaurants).where(inArray(restaurants.id, [restaurantId]));
});

describe('outbox dispatch — a provider error is a counted, logged retry', () => {
  it('retried=1, failed=0, row back to queued with attempt 1; the log names the error, not the recipient', async () => {
    const [row] = await db
      .insert(notificationsOutbox)
      .values({ restaurantId, channel: 'email', target: RECIPIENT, subject: 'תזכורת', body: 'גוף' })
      .returning();
    process.env.RESEND_API_KEY = 'test-key-not-real';
    // Resend rejects the send and echoes the address back, as its 4xx bodies do.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`{"message":"The ${RECIPIENT} domain is not verified"}`, { status: 403 })),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = (await processOutboxDispatch(job)) as { dispatched: number; failed: number; retried?: number };

    const [after] = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.id, row!.id));
    expect(after).toMatchObject({ status: 'queued', attemptCount: 1 });
    expect(after!.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(res.retried).toBeGreaterThanOrEqual(1);
    expect(res.failed).toBe(0);

    const summary = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[outbox-dispatch] claimed='));
    expect(summary).toMatch(/retried=[1-9]/);
    const retryLines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[outbox-dispatch] retry'));
    expect(retryLines.some((l) => l.includes('retry 1/5 email: Resend HTTP send failed (403)'))).toBe(true);
    for (const l of [...retryLines, summary ?? '']) expect(l).not.toContain(RECIPIENT);
  });
});
