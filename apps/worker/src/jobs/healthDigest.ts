/**
 * Daily platform health digest (wave 1 / monitoring).
 *
 * Once a day (cron.ts, 07:00 IL) the worker emails the ops recipients a short
 * snapshot of everything that silently rots when nobody looks:
 *   - BullMQ queue depths (waiting / active / delayed / failed) per queue,
 *   - jobs that FAILED in the last 24 h (name + first error line),
 *   - invoices stuck in `ocr_pending` for more than 30 minutes (OCR never ran),
 *   - outbox notifications that ended `failed` in the last 24 h.
 *
 * Delivery goes through notifications_outbox like every other email, so the
 * outbox-dispatch worker (and its retries / provider gating) sends it.
 * notifications_outbox.restaurant_id is NOT NULL and this wave adds no
 * migration, so the platform-wide row is attributed to a "home" restaurant:
 * HEALTH_DIGEST_RESTAURANT_ID, else the oldest restaurant. Recipients:
 * HEALTH_DIGEST_EMAILS ?? WORKER_ALERT_EMAILS ?? PLATFORM_ADMIN_EMAILS.
 */
import { enqueueNotification } from '@restomatch/api';
import {
  and,
  asc,
  count,
  eq,
  gte,
  invoices,
  lt,
  notificationsOutbox,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { jobDb } from '../db';
import { makeQueue, makeWorker } from '../queue';

export interface HealthDigestJob {
  /** Override "now" (tests). */
  now?: string;
}

/** Every queue the worker consumes (keep in sync with src/index.ts). */
export const DIGEST_QUEUES = [
  'ocr-invoice',
  'match-invoice',
  'import-catalog',
  'outbox-dispatch',
  'daily-expectations',
  'baselines',
  'order-reminders',
  'supplier-delays',
  'end-of-day-report',
  'retention',
  'sync-platforms',
  'health-digest',
] as const;

export const OCR_STALE_AFTER_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface FailedJobSummary {
  queue: string;
  id: string;
  name: string;
  failedAt: string;
  reason: string;
}

export interface HealthSnapshot {
  at: string;
  queues: QueueHealth[];
  failedLast24h: FailedJobSummary[];
  ocrPendingStale: { count: number; oldestAt: string | null };
  outboxFailedLast24h: number;
}

/** Minimal BullMQ surface the collector needs (so tests can pass fakes). */
export interface QueueProbe {
  name: string;
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  getFailed(start?: number, end?: number): Promise<
    Array<{ id?: string; name: string; finishedOn?: number; failedReason?: string }>
  >;
}

export async function collectHealth(
  db: Database,
  probes: QueueProbe[],
  now = new Date(),
): Promise<HealthSnapshot> {
  const since = new Date(now.getTime() - DAY_MS);
  const queues: QueueHealth[] = [];
  const failedLast24h: FailedJobSummary[] = [];
  for (const q of probes) {
    const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
    queues.push({
      name: q.name,
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
    });
    for (const j of await q.getFailed(0, 49)) {
      if (!j.finishedOn || j.finishedOn < since.getTime()) continue;
      failedLast24h.push({
        queue: q.name,
        id: String(j.id ?? '?'),
        name: j.name,
        failedAt: new Date(j.finishedOn).toISOString(),
        reason: (j.failedReason ?? '').split('\n')[0]!.slice(0, 200),
      });
    }
  }

  const staleBefore = new Date(now.getTime() - OCR_STALE_AFTER_MS);
  const [ocr] = await db
    .select({ n: count(invoices.id), oldest: sql<Date | string | null>`min(${invoices.createdAt})` })
    .from(invoices)
    .where(and(eq(invoices.status, 'ocr_pending'), lt(invoices.createdAt, staleBefore)));

  const [outbox] = await db
    .select({ n: count(notificationsOutbox.id) })
    .from(notificationsOutbox)
    .where(and(eq(notificationsOutbox.status, 'failed'), gte(notificationsOutbox.createdAt, since)));

  return {
    at: now.toISOString(),
    queues,
    failedLast24h,
    ocrPendingStale: {
      count: Number(ocr?.n ?? 0),
      oldestAt: ocr?.oldest ? new Date(ocr.oldest).toISOString() : null,
    },
    outboxFailedLast24h: Number(outbox?.n ?? 0),
  };
}

/** Number of things a human should look at. */
export function issueCount(s: HealthSnapshot): number {
  const backlog = s.queues.filter((q) => q.waiting + q.delayed > 100).length;
  return s.failedLast24h.length + s.ocrPendingStale.count + s.outboxFailedLast24h + backlog;
}

export function renderHealthDigest(s: HealthSnapshot): { subject: string; text: string; html: string } {
  const issues = issueCount(s);
  const date = s.at.slice(0, 10);
  const subject = issues
    ? `RestoMatch health ${date}: ${issues} item${issues === 1 ? '' : 's'} need attention`
    : `RestoMatch health ${date}: all clear`;
  const lines: string[] = [subject, ''];
  lines.push(
    `OCR pending > 30 min: ${s.ocrPendingStale.count}` +
      (s.ocrPendingStale.oldestAt ? ` (oldest since ${s.ocrPendingStale.oldestAt})` : ''),
  );
  lines.push(`Outbox notifications failed (24 h): ${s.outboxFailedLast24h}`);
  lines.push(`Jobs failed (24 h): ${s.failedLast24h.length}`);
  for (const f of s.failedLast24h.slice(0, 10)) {
    lines.push(`  - ${f.queue} #${f.id} at ${f.failedAt}: ${f.reason}`);
  }
  lines.push('', 'Queues (waiting / active / delayed / failed kept):');
  for (const q of s.queues) {
    lines.push(`  ${q.name.padEnd(20)} ${q.waiting} / ${q.active} / ${q.delayed} / ${q.failed}`);
  }
  const text = lines.join('\n');
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<pre style="font-family:ui-monospace,monospace;font-size:13px">${esc(text)}</pre>`;
  return { subject, text, html };
}

export function digestRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.HEALTH_DIGEST_EMAILS ?? env.WORKER_ALERT_EMAILS ?? env.PLATFORM_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function homeRestaurantId(db: Database): Promise<string | null> {
  const configured = process.env.HEALTH_DIGEST_RESTAURANT_ID;
  if (configured) return configured;
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).orderBy(asc(restaurants.createdAt)).limit(1);
  return r?.id ?? null;
}

/** Collect + enqueue one digest email per recipient (deduped per day). */
export async function runHealthDigest(db: Database, probes: QueueProbe[], now = new Date()) {
  const recipients = digestRecipients();
  if (recipients.length === 0) return { skipped: 'no recipients (set HEALTH_DIGEST_EMAILS)' as const };
  const restaurantId = await homeRestaurantId(db);
  if (!restaurantId) return { skipped: 'no restaurant to attribute the outbox row to' as const };

  const snapshot = await collectHealth(db, probes, now);
  const { subject, text, html } = renderHealthDigest(snapshot);
  const day = snapshot.at.slice(0, 10);
  let enqueued = 0;
  for (const to of recipients) {
    const res = await enqueueNotification(db, {
      restaurantId,
      channel: 'email',
      target: to,
      subject,
      body: text,
      html,
      relatedEntityType: 'health_digest',
      dedupeKey: `health-digest:${day}:${to}`,
    });
    if (!res.deduped) enqueued += 1;
  }
  return { issues: issueCount(snapshot), enqueued, recipients: recipients.length, snapshot };
}

export function startHealthDigestWorker() {
  // Read-only probes on the worker's own Redis connection (same as the queues).
  const probes = DIGEST_QUEUES.map((name) => makeQueue(name) as unknown as QueueProbe);
  return makeWorker<HealthDigestJob>('health-digest', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const result = await runHealthDigest(jobDb(url), probes, job.data.now ? new Date(job.data.now) : new Date());
    console.log(`[health-digest] ${JSON.stringify({ ...result, snapshot: undefined })}`);
    return result;
  });
}
