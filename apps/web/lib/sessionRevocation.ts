import 'server-only';
import IORedis from 'ioredis';
import { failFastRedisOptions, withDeadline } from '@restomatch/queue';
import { SESSION_TTL_LONG_SEC } from './sessionLifetime';

/**
 * Per-session revocation for an ordinary sign-out.
 *
 * Signing out only deletes THIS browser's cookie, but every authenticated
 * response re-issues the session cookie (rolling JWT). A request already in
 * flight when the user clicks "sign out" (a link prefetch, a tRPC query) can
 * land after the sign-out response and plant the still-valid JWT again — the
 * user is "signed out" and still in. So each JWT carries a random session id
 * (`sid`); sign-out deny-lists it here and the node jwt callback empties any
 * token whose sid is deny-listed. token_version stays for "log out everywhere"
 * (it would also end the user's other devices, which a plain sign-out must not).
 *
 * Redis when REDIS_URL is set (shared by every instance), else process-local.
 * Fails OPEN like the rate limiter: a Redis outage must not sign everyone out.
 */

/** A deny-list read sits on every authenticated request — keep its worst case small. */
export const REVOCATION_REDIS_DEADLINE_MS = 300;
const PREFIX = 'revoked-sid:';

export interface RevocationStore {
  add(sid: string, ttlSec: number): Promise<void>;
  has(sid: string): Promise<boolean>;
}

export class MemoryRevocationStore implements RevocationStore {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async add(sid: string, ttlSec: number): Promise<void> {
    this.until.set(sid, this.now() + ttlSec * 1000);
  }
  async has(sid: string): Promise<boolean> {
    const t = this.until.get(sid);
    if (t === undefined) return false;
    if (t <= this.now()) {
      this.until.delete(sid);
      return false;
    }
    return true;
  }
}

class RedisRevocationStore implements RevocationStore {
  constructor(private readonly redis: IORedis) {}
  private deadline<T>(p: Promise<T>): Promise<T> {
    return withDeadline(p, REVOCATION_REDIS_DEADLINE_MS, () => new Error('session-revocation redis timed out'));
  }
  async add(sid: string, ttlSec: number): Promise<void> {
    await this.deadline(this.redis.set(PREFIX + sid, '1', 'EX', ttlSec));
  }
  async has(sid: string): Promise<boolean> {
    return (await this.deadline(this.redis.exists(PREFIX + sid))) === 1;
  }
}

let store: RevocationStore | undefined;
function getStore(): RevocationStore {
  if (store) return store;
  const url = process.env.REDIS_URL;
  if (url) {
    const redis = new IORedis(url, failFastRedisOptions());
    redis.on('error', (err) => console.warn('[sessionRevocation] redis error:', err.message));
    store = new RedisRevocationStore(redis);
  } else {
    store = new MemoryRevocationStore();
  }
  return store;
}

/** Test seam: swap the store (and reset with `undefined`). */
export function setRevocationStoreForTests(s: RevocationStore | undefined): void {
  store = s;
}

/** Deny-list a session id for as long as any JWT carrying it could still be valid. */
export async function revokeSession(sid: string, ttlSec: number = SESSION_TTL_LONG_SEC): Promise<void> {
  try {
    await getStore().add(sid, Math.max(1, Math.ceil(ttlSec)));
  } catch (err) {
    console.warn('[sessionRevocation] revoke failed — cookie cleared, sid not deny-listed:', err instanceof Error ? err.message : err);
  }
}

export async function isSessionRevoked(sid: string): Promise<boolean> {
  try {
    return await getStore().has(sid);
  } catch (err) {
    console.warn('[sessionRevocation] check failed — failing open:', err instanceof Error ? err.message : err);
    return false;
  }
}
