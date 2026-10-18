/**
 * Wait for the OCR worker to read an invoice (EN-4).
 *
 * Real invoices can take well over 30 s (Claude Vision on a multi-page PDF, a
 * cold worker, a queue backlog). The wizard used to poll for ~30 s and then
 * silently fall back with no way to see the result. This polls for up to
 * `maxMs` (default 120 s) with a gentle back-off, reports progress, can be
 * cancelled (retake / skip / unmount), and tells the caller HOW it ended.
 */
export type PollOutcome = 'ready' | 'failed' | 'timeout' | 'cancelled';

export interface PolledInvoice {
  status: string;
  ocrFailed?: boolean;
}

export interface PollOptions<T extends PolledInvoice> {
  fetch: () => Promise<T>;
  maxMs?: number;
  /** Called after every fetch with the elapsed milliseconds. */
  onTick?: (elapsedMs: number) => void;
  /** Return true to stop early (e.g. the receiver tapped "continue"). */
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_POLL_MS = 120_000;

/** 1 s for the first 10 s, then 2 s, then 4 s after a minute. */
export function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 10_000) return 1_000;
  if (elapsedMs < 60_000) return 2_000;
  return 4_000;
}

export async function pollInvoiceUntilRead<T extends PolledInvoice>(
  opts: PollOptions<T>,
): Promise<{ outcome: PollOutcome; invoice: T | null }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxMs = opts.maxMs ?? DEFAULT_POLL_MS;
  const start = now();
  let last: T | null = null;
  for (;;) {
    if (opts.isCancelled?.()) return { outcome: 'cancelled', invoice: last };
    last = await opts.fetch();
    const elapsed = now() - start;
    opts.onTick?.(elapsed);
    if (last.ocrFailed) return { outcome: 'failed', invoice: last };
    if (last.status !== 'ocr_pending') return { outcome: 'ready', invoice: last };
    if (elapsed >= maxMs) return { outcome: 'timeout', invoice: last };
    await sleep(pollDelay(elapsed));
  }
}
