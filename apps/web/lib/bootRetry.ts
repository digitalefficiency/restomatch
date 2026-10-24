/**
 * Retry for the startup DB guards (instrumentation.node.ts).
 *
 * Next.js caches a rejected instrumentation `register()` for the life of the
 * server instance: every later request on it answers 500 "An error occurred
 * while loading instrumentation hook". So one dropped connection at boot (a
 * pooler timeout while Vercel froze the instance mid-handshake, seen in
 * production as `write CONNECT_TIMEOUT …` / SCRAM timeouts) used to take the
 * instance down until it was recycled.
 *
 * Only connection-level failures are retried. A guard VERDICT (role bypasses
 * RLS, RLS disabled) is a plain Error with no such code and still fails the
 * boot on the first attempt, as before.
 */

/** postgres.js connection codes plus the Node socket errnos it surfaces. */
const TRANSIENT_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  // SQLSTATE: too_many_connections, admin/crash shutdown, cannot_connect_now.
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

/** True when `err` (or any error in its `cause` chain) is a connection-level failure. */
export function isTransientDbError(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (
    let e = err;
    typeof e === 'object' && e !== null && !seen.has(e);
    e = (e as { cause?: unknown }).cause
  ) {
    seen.add(e);
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && (TRANSIENT_CODES.has(code) || code.startsWith('08')))
      return true;
  }
  return false;
}

export async function retryTransientDb<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransientDbError(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[boot] ${label}: transient DB error (${(err as Error).message}); retry ${attempt}/${attempts - 1} in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
