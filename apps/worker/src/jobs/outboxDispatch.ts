/**
 * Picks up queued notifications from `notifications_outbox` and dispatches
 * via the real provider client.
 *
 * Concurrency safety (wave 3): each tick ATOMICALLY claims a batch with a
 * single `UPDATE ... SET status='sending', claimed_at=now() WHERE id IN
 * (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`. Because the
 * claim and the status flip happen in one locked statement, two concurrent
 * workers/ticks can never grab the same row — so a PO is never sent twice.
 *
 * On success the row flips `status=sent` / `sent_at=now()`. On failure it goes
 * back to `queued` with backoff (claim released) until MAX_ATTEMPTS, then parks
 * as `status=failed` with `last_error`.
 *
 * Real provider integration (WhatsApp Cloud, Expo Push, Resend) is plug-in:
 * we look up the provider by channel and call its `dispatch` method.
 * A row whose channel has no provider configured is parked as `failed` with
 * last_error = SKIPPED_NO_PROVIDER — never `sent` — so the order page can say
 * "supplier sending isn't configured" instead of "sent by email".
 *
 * Owner rules for STAFF alerts (pilot, sendWindow.ts): none 23:00–06:00, none
 * on Shabbat, at most STAFF_ALERT_DAILY_CAP per person per Israel day. A row
 * that may not go out now goes back to `queued` with scheduled_at = the next
 * allowed instant — it does not consume an attempt and is never dropped.
 * Supplier messages a user explicitly sent (a PO send) are exempt.
 */
import {
  SKIPPED_NO_PROVIDER,
  STAFF_ALERT_DAILY_CAP,
  capKey,
  isExemptFromSendWindow,
  isResendConfigured,
  isUndeliverableAddress,
  localDay,
  nextDayAllowedAt,
  shabbatWindow,
  staffAlertWindow,
  isWhatsAppCloudConfigured,
  makeResendDispatcher,
  WhatsAppCloudNotifier,
  type EmailAttachment,
  type NotificationPayload,
} from '@restomatch/api';
import { eq, notificationsOutbox, sql, type Database } from '@restomatch/db';
import { makeWorker, type WorkerJob } from '../queue';
import { jobDb } from '../db';

export interface OutboxDispatchJob {
  /** Process up to this many queued rows per tick. */
  batchSize?: number;
  /** Test seam: the tick's "now" (ISO). Defaults to the real clock. */
  now?: string;
}

const MAX_ATTEMPTS = 5;

/** last_error for an email the dispatcher refused to hand a real provider (demo / .test domain). */
export const SKIPPED_UNDELIVERABLE = 'skipped_undeliverable_address';
const LOG_ERROR_CHARS = 160;

/** Shape of a claimed outbox row (subset we dispatch with). */
interface ClaimedRow {
  id: string;
  restaurant_id: string;
  channel: 'whatsapp' | 'push' | 'email';
  target: string;
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  dedupe_key: string | null;
  scheduled_at: string | Date;
  attempt_count: number;
}

/** Email attachments ride in `payload.__attachments` (e.g. the order PDF). */
export function readAttachments(payload: Record<string, unknown> | null): EmailAttachment[] | undefined {
  const raw = payload?.__attachments;
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter(
    (a): a is EmailAttachment =>
      !!a && typeof a === 'object' &&
      typeof (a as EmailAttachment).filename === 'string' &&
      typeof (a as EmailAttachment).contentBase64 === 'string',
  );
  return out.length ? out : undefined;
}

export function startOutboxDispatchWorker() {
  return makeWorker<OutboxDispatchJob>('outbox-dispatch', processOutboxDispatch);
}

/** The outbox-dispatch job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processOutboxDispatch(job: WorkerJob<OutboxDispatchJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  const batchSize = job.data.batchSize ?? 50;
  const now = job.data.now ? new Date(job.data.now) : new Date();

  // Atomically CLAIM a batch: flip queued -> sending and stamp claimed_at in a
  // single statement whose subquery locks the chosen rows FOR UPDATE SKIP
  // LOCKED. Concurrent workers/ticks therefore never select the same row, so
  // a notification (and thus a PO send) is dispatched by exactly one worker —
  // no double-send. The old SELECT-then-UPDATE had a race window between the
  // unlocked read and the write where two ticks could both grab a row.
  const claimed = (await db.execute(sql`
    UPDATE ${notificationsOutbox}
    SET status = 'sending', claimed_at = now()
    WHERE id IN (
      SELECT id FROM ${notificationsOutbox}
      WHERE status = 'queued' AND scheduled_at <= ${now.toISOString()}::timestamptz
      ORDER BY scheduled_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING id, restaurant_id, channel, target, subject, body, payload,
              related_entity_type, related_entity_id, dedupe_key, scheduled_at, attempt_count
  `)) as unknown as ClaimedRow[];

  if (claimed.length === 0) {
    return { dispatched: 0, failed: 0 };
  }

  let dispatched = 0;
  let failed = 0;
  let skipped = 0;
  const deferred = { quiet: 0, shabbat: 0, cap: 0 };

  const window = shabbatWindow();
  const gate = staffAlertWindow(now, window);
  const isStaff = (r: ClaimedRow) =>
    !isExemptFromSendWindow({ relatedEntityType: r.related_entity_type, dedupeKey: r.dedupe_key });
  // Staff alerts already sent today, per person — loaded only when the window is open.
  const sentToday = gate.open ? await staffAlertsSentToday(db, now, claimed.filter(isStaff)) : new Map<string, number>();

  // RETURNING has no order: oldest first, so the first alerts of the day are the ones that go out.
  claimed.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  for (const claimedRow of claimed) {
    if (isStaff(claimedRow)) {
      let until: Date | null = null;
      if (!gate.open) {
        until = gate.nextAllowedAt;
        deferred[gate.reason] += 1;
      } else {
        const key = capKey({ restaurantId: claimedRow.restaurant_id, target: claimedRow.target });
        if ((sentToday.get(key) ?? 0) >= STAFF_ALERT_DAILY_CAP) {
          until = nextDayAllowedAt(now, window);
          deferred.cap += 1;
        }
      }
      if (until) {
        // Back to queued at the next allowed instant. attempt_count and
        // last_error are left as they are: waiting is not a failed attempt.
        await db
          .update(notificationsOutbox)
          .set({ status: 'queued', scheduledAt: until, claimedAt: null })
          .where(eq(notificationsOutbox.id, claimedRow.id));
        continue;
      }
    }

    const row = {
      id: claimedRow.id,
      restaurantId: claimedRow.restaurant_id,
      channel: claimedRow.channel,
      target: claimedRow.target,
      subject: claimedRow.subject,
      body: claimedRow.body,
      html: typeof claimedRow.payload?.__html === 'string' ? claimedRow.payload.__html : undefined,
      attachments: readAttachments(claimedRow.payload),
      relatedEntityType: claimedRow.related_entity_type,
      relatedEntityId: claimedRow.related_entity_id,
      attemptCount: claimedRow.attempt_count,
    };
    try {
      const outcome = await dispatch(row);
      if (outcome !== 'sent') {
        await db
          .update(notificationsOutbox)
          .set({ status: 'failed', lastError: outcome === 'no_provider' ? SKIPPED_NO_PROVIDER : SKIPPED_UNDELIVERABLE, claimedAt: null })
          .where(eq(notificationsOutbox.id, row.id));
        skipped += 1;
        continue;
      }
      await db
        .update(notificationsOutbox)
        .set({ status: 'sent', sentAt: now })
        .where(eq(notificationsOutbox.id, row.id));
      dispatched += 1;
      if (isStaff(claimedRow)) {
        const key = capKey({ restaurantId: row.restaurantId, target: row.target });
        sentToday.set(key, (sentToday.get(key) ?? 0) + 1);
      }
    } catch (err) {
      const newAttempt = (row.attemptCount ?? 0) + 1;
      const errMessage = err instanceof Error ? err.message : String(err);
      // One line per failed row — the outage used to be visible only in
      // last_error. Never the address: the error text is redacted first.
      console.error(
        `[outbox-dispatch] failed id=${row.id.slice(0, 8)} channel=${row.channel} attempt=${newAttempt}/${MAX_ATTEMPTS} error="${redactError(errMessage, row.target)}"`,
      );
      if (newAttempt >= MAX_ATTEMPTS) {
        // Terminal failure: leave it parked as `failed` (claimedAt cleared).
        await db
          .update(notificationsOutbox)
          .set({
            status: 'failed',
            attemptCount: newAttempt,
            lastError: errMessage,
            claimedAt: null,
          })
          .where(eq(notificationsOutbox.id, row.id));
        failed += 1;
      } else {
        // Retry: release the claim by flipping back to `queued` and clearing
        // claimedAt, so the next tick re-claims it once the backoff elapses.
        // (Without this the row stays stuck in `sending` forever.)
        await db
          .update(notificationsOutbox)
          .set({
            status: 'queued',
            attemptCount: newAttempt,
            lastError: errMessage,
            scheduledAt: backoff(newAttempt),
            claimedAt: null,
          })
          .where(eq(notificationsOutbox.id, row.id));
      }
    }
  }

  const deferredTotal = deferred.quiet + deferred.shabbat + deferred.cap;
  if (deferredTotal > 0) {
    console.log(`[outbox-dispatch] deferred quiet=${deferred.quiet} shabbat=${deferred.shabbat} cap=${deferred.cap}`);
  }
  console.log(
    `[outbox-dispatch] claimed=${claimed.length} dispatched=${dispatched} failed=${failed} skipped_no_provider=${skipped}`,
  );
  return { dispatched, failed, skipped, deferred };
}

/**
 * Staff alerts already sent on `now`'s Israel day, per cap key, for the
 * people in this batch. Rows a mock notifier marked sent at enqueue count too:
 * the person was alerted either way.
 */
async function staffAlertsSentToday(db: Database, now: Date, rows: ClaimedRow[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (rows.length === 0) return counts;
  const targets = [...new Set(rows.map((r) => r.target.trim().toLowerCase()))];
  const day = localDay(now);
  const sent = (await db.execute(sql`
    SELECT restaurant_id, target, related_entity_type, dedupe_key
    FROM ${notificationsOutbox}
    WHERE status = 'sent'
      AND sent_at >= ${day.start.toISOString()}::timestamptz
      AND sent_at < ${day.end.toISOString()}::timestamptz
      AND lower(btrim(target)) IN (${sql.join(targets.map((t) => sql`${t}`), sql`, `)})
  `)) as unknown as Array<{ restaurant_id: string; target: string; related_entity_type: string | null; dedupe_key: string | null }>;
  for (const r of sent) {
    if (isExemptFromSendWindow({ relatedEntityType: r.related_entity_type, dedupeKey: r.dedupe_key })) continue;
    const key = capKey({ restaurantId: r.restaurant_id, target: r.target });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The first LOG_ERROR_CHARS of a provider error with every address taken out
 * (the row's target, any email, any phone number) — logs must not carry PII.
 */
export function redactError(message: string, target: string): string {
  let out = message;
  const t = target.trim();
  if (t) out = out.split(t).join('<target>');
  out = out
    .replace(/[^\s"'<>,;:()\[\]]+@[^\s"'<>,;:()\[\]]+/g, '<email>')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '<phone>')
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'");
  return out.slice(0, LOG_ERROR_CHARS);
}

/**
 * Actual provider dispatch for a queued outbox row.
 *
 * Provider selection is env-gated so this stays a no-op (and tests stay
 * hermetic) until real credentials are provisioned:
 *   whatsapp -> WhatsAppCloudNotifier  when WHATSAPP_PHONE_NUMBER_ID +
 *               WHATSAPP_ACCESS_TOKEN are set
 *   email    -> Resend                 when RESEND_API_KEY is set
 *   push     -> no real provider wired yet (no-op)
 *
 * Rows enqueued by the mock notifiers are already `sent` at enqueue and never
 * reach here. Rows left `queued` (real-provider path, or a failed first send)
 * are delivered here without re-enqueueing. Throwing marks the row for retry;
 * 'no_provider' means nothing was sent and nothing can be until keys exist.
 */
export async function dispatch(row: {
  restaurantId: string;
  channel: 'whatsapp' | 'push' | 'email';
  target: string;
  subject: string | null;
  body: string;
  html?: string;
  attachments?: EmailAttachment[];
  relatedEntityType: string | null;
  relatedEntityId: string | null;
}): Promise<'sent' | 'no_provider' | 'undeliverable'> {
  // Typed as the notifier env: under the web app's ProcessEnv (Next augments it)
  // the bare process.env fails TS's weak-type check against NotifierFactoryEnv.
  const env = process.env as NonNullable<Parameters<typeof isResendConfigured>[0]>;

  if (row.channel === 'whatsapp') {
    if (!isWhatsAppCloudConfigured(env)) return 'no_provider';
    const notifier = new WhatsAppCloudNotifier({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
      accessToken: env.WHATSAPP_ACCESS_TOKEN!,
      apiBase: env.WHATSAPP_API_BASE,
    });
    await notifier.dispatch(row.target, row.body);
    return 'sent';
  }

  if (row.channel === 'email') {
    if (!isResendConfigured(env)) return 'no_provider';
    // Never hand a real provider a demo / .test address: each one is a bounce
    // against the Resend quota (PO sends to demo suppliers included).
    if (isUndeliverableAddress(row.target)) return 'undeliverable';
    const send = makeResendDispatcher({
      apiKey: env.RESEND_API_KEY!,
      from: env.RESEND_FROM ?? env.EMAIL_FROM,
    });
    const payload: NotificationPayload = {
      restaurantId: row.restaurantId,
      channel: 'email',
      target: row.target,
      subject: row.subject ?? undefined,
      body: row.body,
      html: row.html,
      attachments: row.attachments,
      relatedEntityType: row.relatedEntityType ?? undefined,
      relatedEntityId: row.relatedEntityId ?? undefined,
    };
    await send(payload);
    return 'sent';
  }

  // push: no real provider wired yet.
  return 'no_provider';
}

function backoff(attempt: number): Date {
  // Exponential backoff: 30s, 1m, 5m, 30m, 2h
  const minutes = [0.5, 1, 5, 30, 120][attempt - 1] ?? 240;
  return new Date(Date.now() + minutes * 60_000);
}
