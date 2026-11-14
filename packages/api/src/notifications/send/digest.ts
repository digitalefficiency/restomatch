/**
 * Fold G-06's over-cap alerts into one digest per person, channel and local day.
 *
 * G-06 notify() enforces "at most 6 per person per day": from the 7th alert on,
 * it moves the row to the next allowed slot and marks `payload.digest = true`.
 * H-05 sends those rows as ONE message instead of N. The fold only lists the
 * items: it never sums ₪ across them (each item keeps the text notify()
 * rendered for that recipient, already redacted for roles without money view).
 */
import { DEFAULT_TZ, localDateKey } from './calendar';
import type { NotificationChannel } from '../types';

export interface DigestCandidate {
  id: string;
  restaurantId: string;
  channel: NotificationChannel;
  target: string;
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  scheduledAt: Date;
}

export interface DigestMessage {
  /** Idempotency key of the folded message. */
  dedupeKey: string;
  restaurantId: string;
  channel: NotificationChannel;
  target: string;
  subject: string;
  body: string;
  /** The outbox rows this message replaces (the dispatcher closes them as folded). */
  rowIds: string[];
}

/** Items listed in full; the rest are counted ("ועוד N"). */
export const DIGEST_MAX_ITEMS = 12;

export function isDigestRow(row: Pick<DigestCandidate, 'payload'>): boolean {
  return row.payload?.digest === true;
}

function itemLine(row: DigestCandidate): string {
  const first = row.body.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  const text = row.subject?.trim() || first;
  return `• ${text.length > 120 ? `${text.slice(0, 119)}…` : text}`;
}

/** Group digest rows by (restaurant, person, channel, local day) and render one message each. */
export function foldDigest(rows: readonly DigestCandidate[], tz: string = DEFAULT_TZ): DigestMessage[] {
  const groups = new Map<string, DigestCandidate[]>();
  for (const row of rows) {
    if (!isDigestRow(row)) continue;
    const who = typeof row.payload?.userId === 'string' ? row.payload.userId : row.target;
    const key = `digest:${row.restaurantId}:${who}:${row.channel}:${localDateKey(row.scheduledAt, tz)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const out: DigestMessage[] = [];
  for (const [dedupeKey, list] of groups) {
    list.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id));
    const shown = list.slice(0, DIGEST_MAX_ITEMS).map(itemLine);
    const more = list.length - shown.length;
    const head = list[0]!;
    out.push({
      dedupeKey,
      restaurantId: head.restaurantId,
      channel: head.channel,
      target: head.target,
      subject: `סיכום עדכונים · ${list.length}`,
      body: [
        `${list.length} עדכונים שחיכו לך מאתמול:`,
        ...shown,
        ...(more > 0 ? [`ועוד ${more} במסך המשימות.`] : []),
      ].join('\n'),
      rowIds: list.map((r) => r.id),
    });
  }
  return out;
}
