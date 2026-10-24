/**
 * Daily platform health digest (wave 1 / monitoring).
 *
 * Once a day (cron.ts, 06:45 Asia/Jerusalem) the worker emails the ops recipients a short
 * snapshot of everything that silently rots when nobody looks:
 *   - job_queue depths (waiting / active / delayed / failed) per queue,
 *   - jobs that FAILED in the last 24 h (name + first error line),
 *   - invoices stuck in `ocr_pending` for more than 30 minutes (OCR never ran),
 *   - outbox notifications created in the last 24 h that ended `failed`.
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
import { redactString } from '@restomatch/observability';
import { jobDb } from '../db';
import { makeQueue, makeWorker } from '../queue';

export interface HealthDigestJob {
  /** Override "now" (tests). */
  now?: string;
  /** Manual run: bypass the once-per-day dedupe (and don't consume today's slot). */
  force?: boolean;
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
  'ocr-sweep',
  // Wave 1 (flag-gated jobs; a no-op tenant still shows queue depth/failures).
  'price-alerts',
  'recovery-reminders',
  'monthly-report',
] as const;

export const OCR_STALE_AFTER_MS = 30 * 60_000;
/** Max failed jobs inspected per queue per digest (newest first). */
export const FAILED_SCAN_LIMIT = 1_000;
const FAILED_PAGE = 100;
const FAILED_LISTED = 10;
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
  /** First few failures (for the email); the true 24 h count is failedLast24hCount. */
  failedLast24h: FailedJobSummary[];
  failedLast24hCount: number;
  /** True when the scan hit FAILED_SCAN_LIMIT per queue — the count is a lower bound. */
  failedCountTruncated: boolean;
  ocrPendingStale: { count: number; oldestAt: string | null };
  outboxFailedLast24h: number;
}

/** Minimal queue surface the collector needs (so tests can pass fakes). */
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
  let failedLast24hCount = 0;
  let failedCountTruncated = false;
  for (const q of probes) {
    const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
    queues.push({
      name: q.name,
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
    });
    // Page through the failed set (newest first) until we pass the 24 h window.
    for (let start = 0; start < FAILED_SCAN_LIMIT; start += FAILED_PAGE) {
      const page = await q.getFailed(start, start + FAILED_PAGE - 1);
      let older = false;
      for (const j of page) {
        if (!j.finishedOn || j.finishedOn < since.getTime()) {
          older = true;
          continue;
        }
        failedLast24hCount += 1;
        if (failedLast24h.length < FAILED_LISTED) {
          failedLast24h.push({
            queue: q.name,
            id: String(j.id ?? '?'),
            name: j.name,
            failedAt: new Date(j.finishedOn).toISOString(),
            // First line only, capped, and no tenant PII in an ops email.
            reason: redactString((j.failedReason ?? '').split('\n')[0]!.slice(0, 200)),
          });
        }
      }
      if (page.length < FAILED_PAGE || older) break;
      if (start + FAILED_PAGE >= FAILED_SCAN_LIMIT) failedCountTruncated = true;
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
    failedLast24hCount,
    failedCountTruncated,
    ocrPendingStale: {
      count: Number(ocr?.n ?? 0),
      oldestAt: ocr?.oldest ? new Date(ocr.oldest).toISOString() : null,
    },
    outboxFailedLast24h: Number(outbox?.n ?? 0),
  };
}

/** Number of things a human should look at. */
export function issueCount(s: HealthSnapshot): number {
  // Backlog = jobs waiting for a worker. Delayed jobs are mostly scheduler
  // ticks / retries-in-backoff, so they don't count as backlog.
  const backlog = s.queues.filter((q) => q.waiting > 100).length;
  return s.failedLast24hCount + s.ocrPendingStale.count + s.outboxFailedLast24h + backlog;
}

export function renderHealthDigest(s: HealthSnapshot): { subject: string; text: string; html: string } {
  const issues = issueCount(s);
  const date = digestDay(new Date(s.at));
  const subject = issues
    ? `RestoMatch health ${date}: ${issues} item${issues === 1 ? '' : 's'} need attention`
    : `RestoMatch health ${date}: all clear`;
  const lines: string[] = [subject, ''];
  lines.push(
    `OCR pending > 30 min: ${s.ocrPendingStale.count}` +
      (s.ocrPendingStale.oldestAt ? ` (oldest since ${s.ocrPendingStale.oldestAt})` : ''),
  );
  lines.push(`Outbox notifications created in the last 24 h that failed: ${s.outboxFailedLast24h}`);
  lines.push(`Jobs failed (24 h): ${s.failedLast24hCount}${s.failedCountTruncated ? '+' : ''}`);
  if (s.failedLast24hCount > s.failedLast24h.length) lines.push(`  (showing the ${s.failedLast24h.length} most recent)`);
  for (const f of s.failedLast24h) {
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function homeRestaurantId(db: Database): Promise<string | null> {
  const configured = process.env.HEALTH_DIGEST_RESTAURANT_ID?.trim();
  if (configured) {
    const [hit] = UUID_RE.test(configured)
      ? await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, configured)).limit(1)
      : [];
    if (hit) return hit.id;
    // A typo here must not silence the digest forever — fall back and say so.
    console.warn(`[health-digest] HEALTH_DIGEST_RESTAURANT_ID=${configured} is not a restaurant — using the oldest`);
  }
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).orderBy(asc(restaurants.createdAt)).limit(1);
  return r?.id ?? null;
}

/** The digest's calendar day in Israel (the dedupe unit), e.g. 2026-10-18. */
export function digestDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Collect + enqueue one digest email per recipient (deduped per day). */
export async function runHealthDigest(db: Database, probes: QueueProbe[], now = new Date(), opts: { force?: boolean } = {}) {
  const recipients = digestRecipients();
  if (recipients.length === 0) return { skipped: 'no recipients (set HEALTH_DIGEST_EMAILS)' as const };
  const restaurantId = await homeRestaurantId(db);
  if (!restaurantId) return { skipped: 'no restaurant to attribute the outbox row to' as const };

  const snapshot = await collectHealth(db, probes, now);
  const { subject, text, html } = renderHealthDigest(snapshot);
  const day = digestDay(now);
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
      // Manual (force) runs get their own key so they never consume the
      // scheduled digest's once-per-day slot.
      dedupeKey: opts.force ? `health-digest:manual:${now.toISOString()}:${to}` : `health-digest:${day}:${to}`,
    });
    if (!res.deduped) enqueued += 1;
  }
  return { issues: issueCount(snapshot), enqueued, recipients: recipients.length, snapshot };
}

export function startHealthDigestWorker() {
  // Read-only probes on the job_queue table (the worker's queue connection).
  const probes = DIGEST_QUEUES.map((name) => makeQueue(name) as unknown as QueueProbe);
  return makeWorker<HealthDigestJob>('health-digest', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const result = await runHealthDigest(jobDb(url), probes, job.data.now ? new Date(job.data.now) : new Date(), {
      force: job.data.force,
    });
    console.log(`[health-digest] ${JSON.stringify({ ...result, snapshot: undefined })}`);
    return result;
  });
}
