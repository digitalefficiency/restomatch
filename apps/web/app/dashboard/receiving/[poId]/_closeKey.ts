/** W2-05 · one close per intent, and the server's "not counted yet" answer. Pure (unit-tested). */

/**
 * The close's client mutation id: stable per receipt and open/close cycle on
 * this device (localStorage, so it survives a reload), so every retry of ONE
 * close intent replays it on the server instead of closing twice.
 */
export function closeKeyFor(grId: string, version: string | null): string {
  const key = `rm-rcv-close:${grId}:${version ?? '-'}`;
  try {
    const have = window.localStorage.getItem(key);
    if (have) return have;
    const id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: still one key for this attempt
  }
}

/** The close was confirmed: its key is no longer needed on this device. */
export function clearCloseKey(grId: string, version: string | null): void {
  try {
    window.localStorage.removeItem(`rm-rcv-close:${grId}:${version ?? '-'}`);
  } catch {
    /* storage blocked */
  }
}

/** PRECONDITION_FAILED {uncounted_lines: n} from submitReceipt → n; anything else → null. */
export function uncountedLinesOf(err: unknown): number | null {
  const e = err as { data?: { code?: string } | null; message?: string } | null;
  if (e?.data?.code !== 'PRECONDITION_FAILED' || typeof e.message !== 'string') return null;
  try {
    const n = (JSON.parse(e.message) as { uncounted_lines?: unknown }).uncounted_lines;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
