/**
 * Data minimisation for the outbox (H-05 slice b; the follow-up promised in
 * PR #261). Since markSent retains the payload, a finished row keeps its
 * rendered e-mail (`__html`) and its attachments (`__attachments`, base64:
 * order PDFs, letters). Those are needed only until the row is final. After
 * `afterDays` (default 30) this strips both keys from finished rows
 * (`sent` / `failed` / `cancelled`), keeping the small keys the counters and
 * the audit need (`userId`, `event`, `digest`, `externalId`, `digestOf`).
 *
 * Same safety convention as runRetention: dry-run by default (only counts).
 * Wiring: one call from packages/api/src/retention.ts `runRetention` (not this
 * package's file; proposed in docs/ux/wave3/H-05b-retention.patch).
 */
import { notificationsOutbox, sql, type Database } from '@restomatch/db';

export const OUTBOX_PAYLOAD_KEEP_DAYS = 30;
/** The heavy keys stripped after OUTBOX_PAYLOAD_KEEP_DAYS. */
export const OUTBOX_HEAVY_KEYS = ['__html', '__attachments'] as const;

export async function minimiseOutboxPayloads(
  db: Database,
  opts: { now?: Date; afterDays?: number; dryRun?: boolean } = {},
): Promise<{ dryRun: boolean; rows: number }> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? true;
  const cutoff = new Date(now.getTime() - (opts.afterDays ?? OUTBOX_PAYLOAD_KEEP_DAYS) * 86_400_000);
  const where = sql`${notificationsOutbox.status} in ('sent', 'failed', 'cancelled')
    and coalesce(${notificationsOutbox.sentAt}, ${notificationsOutbox.scheduledAt}) < ${cutoff.toISOString()}::timestamptz
    and (${notificationsOutbox.payload} ? '__html' or ${notificationsOutbox.payload} ? '__attachments')`;

  if (dryRun) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationsOutbox)
      .where(where);
    return { dryRun, rows: row?.n ?? 0 };
  }
  const updated = await db
    .update(notificationsOutbox)
    .set({ payload: sql`${notificationsOutbox.payload} - '__html' - '__attachments'` })
    .where(where)
    .returning({ id: notificationsOutbox.id });
  return { dryRun, rows: updated.length };
}
