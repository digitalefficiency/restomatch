import type { OutboundMsgT } from '../golden/schema';

export interface OutboxRow {
  /** `wa:<inbound wamid>:<n>`: the G-05 idempotency key shape. A redelivered webhook maps to the same keys. */
  key: string;
  to: string;
  msg: OutboundMsgT;
}

/** In-memory stand-in for the outbox + mock notifier (no network, no Meta). */
export class MockNotifier {
  readonly rows: OutboxRow[] = [];
  private readonly keys = new Set<string>();

  /** Returns false when the key was already enqueued (a replay / double tap). */
  enqueue(row: OutboxRow): boolean {
    if (this.keys.has(row.key)) return false;
    this.keys.add(row.key);
    this.rows.push(row);
    return true;
  }
}
