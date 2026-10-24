import 'server-only';
import { sql, type Database } from '@restomatch/db';
import { SESSION_TTL_LONG_SEC } from './sessionLifetime';

/**
 * Per-session revocation for an ordinary sign-out.
 *
 * Signing out only deletes THIS browser's cookie, but every authenticated
 * response re-issues the session cookie (rolling JWT). A request already in
 * flight when the user clicks "sign out" (a link prefetch, a tRPC query) can
 * land after the sign-out response and plant the still-valid JWT again — the
 * user is "signed out" and still in. So each JWT carries a random session id
 * (`sid`); sign-out records it in `revoked_sessions` (migration 0060) and the
 * node jwt callback empties any token whose sid is listed. token_version stays
 * for "log out everywhere" (it would also end the user's other devices, which a
 * plain sign-out must not).
 *
 * Identity trust zone: read/written only through the privileged auth
 * connection (the tenant app role has no access — RLS on, no policies).
 * Fails OPEN on any DB error (table missing, timeout): a deny-list outage must
 * never sign everyone out or 500 every request — it only reopens the race.
 */

/** The deny-list read sits on every authenticated request — keep its worst case small. */
export const REVOCATION_DEADLINE_MS = 300;

export interface RevocationStore {
  add(sid: string, ttlSec: number): Promise<void>;
  has(sid: string): Promise<boolean>;
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`session-revocation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres-backed store over the privileged auth connection. */
export class PgRevocationStore implements RevocationStore {
  constructor(
    private readonly db: Database,
    private readonly deadlineMs: number = REVOCATION_DEADLINE_MS,
  ) {}

  async add(sid: string, ttlSec: number): Promise<void> {
    await withDeadline(
      (async () => {
        await this.db.execute(sql`
          insert into revoked_sessions (sid, expires_at)
          values (${sid}::uuid, now() + make_interval(secs => ${ttlSec}))
          on conflict (sid) do update set expires_at = greatest(revoked_sessions.expires_at, excluded.expires_at)`);
        // Opportunistic purge (indexed): rows past expiry name JWTs that are dead anyway.
        await this.db.execute(sql`delete from revoked_sessions where expires_at < now()`);
      })(),
      this.deadlineMs,
    );
  }

  async has(sid: string): Promise<boolean> {
    const rows = await withDeadline(
      this.db.execute(sql`select 1 as hit from revoked_sessions where sid = ${sid}::uuid and expires_at > now() limit 1`),
      this.deadlineMs,
    );
    return (rows as unknown as unknown[]).length > 0;
  }
}

let store: RevocationStore | undefined;
async function getStore(): Promise<RevocationStore> {
  if (store) return store;
  // Lazy: authDb throws at import without DATABASE_URL.
  const { authDb } = await import('./authDb');
  store = new PgRevocationStore(authDb);
  return store;
}

/** Test seam: swap the store (and reset with `undefined`). */
export function setRevocationStoreForTests(s: RevocationStore | undefined): void {
  store = s;
}

/** Deny-list a session id for as long as any JWT carrying it could still be valid. */
export async function revokeSession(sid: string, ttlSec: number = SESSION_TTL_LONG_SEC): Promise<void> {
  if (!UUID_RE.test(sid)) return;
  try {
    await (await getStore()).add(sid, Math.max(1, Math.ceil(ttlSec)));
  } catch (err) {
    console.warn(
      '[sessionRevocation] revoke failed — cookie cleared, sid not deny-listed:',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function isSessionRevoked(sid: string): Promise<boolean> {
  if (!UUID_RE.test(sid)) return false;
  try {
    return await (await getStore()).has(sid);
  } catch (err) {
    console.warn('[sessionRevocation] check failed — failing open:', err instanceof Error ? err.message : err);
    return false;
  }
}
