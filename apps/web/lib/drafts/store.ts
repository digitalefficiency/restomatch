/**
 * The device-side draft store behind `useFormDraft` / `useServerDraft`.
 *
 * - Keys are scoped `rm.draft:<userId>:<restaurantId>:<key>`, so two people on
 *   one shared tablet never see each other's drafts, and `clearDraftsForUser`
 *   can drop all of one person's drafts at sign-out.
 * - Every storage access is in try/catch. When `localStorage` is missing or
 *   throws (private mode, quota, blocked site data) the store keeps drafts in
 *   memory for the life of the tab instead, so typing still survives a
 *   re-render or an in-app navigation, never crashes the screen.
 * - A draft carries the caller's `version`. A mismatch (the form's shape
 *   changed) or an expired `ttlMs` drops the draft instead of restoring it.
 *
 * Pure module (no React): unit-tested with a fake or throwing storage.
 */

export const DRAFT_PREFIX = 'rm.draft:';

/** Who a draft belongs to. Both ids are required for anything to be persisted. */
export interface DraftScope {
  userId: string;
  restaurantId: string;
}

/** What is stored per key. `v` is the caller's version, `at` the save time (ms). */
export interface DraftEnvelope<T> {
  v: string | number;
  at: number;
  data: T;
}

export interface DraftReadOptions {
  version: string | number;
  /** Drop drafts older than this. Omit for no expiry. */
  ttlMs?: number;
  now?: number;
}

/** The subset of `Storage` the store uses (so tests can pass a fake). */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** In-memory twin used when the real storage is missing or throws. Shared per tab. */
const memory = new Map<string, string>();

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // accessing `localStorage` itself throws with blocked site data
  }
}

export function draftKey(scope: DraftScope, key: string): string {
  return `${DRAFT_PREFIX}${scope.userId}:${scope.restaurantId}:${key}`;
}

export function isCompleteScope(scope: Partial<DraftScope> | null | undefined): scope is DraftScope {
  return !!scope && typeof scope.userId === 'string' && scope.userId !== '' && typeof scope.restaurantId === 'string' && scope.restaurantId !== '';
}

function rawGet(full: string, storage: StorageLike | null): string | null {
  if (storage) {
    try {
      const v = storage.getItem(full);
      if (v !== null) return v;
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(full) ?? null;
}

function rawSet(full: string, value: string, storage: StorageLike | null): void {
  if (storage) {
    try {
      storage.setItem(full, value);
      memory.delete(full);
      return;
    } catch {
      /* quota or blocked: keep it in memory */
    }
  }
  memory.set(full, value);
}

function rawRemove(full: string, storage: StorageLike | null): void {
  memory.delete(full);
  if (!storage) return;
  try {
    storage.removeItem(full);
  } catch {
    /* nothing to do */
  }
}

/** Read a draft; a wrong version, an expired one or unreadable JSON is dropped and reads as null. */
export function readDraftEnvelope<T>(
  scope: DraftScope,
  key: string,
  opts: DraftReadOptions,
  storage: StorageLike | null = browserStorage(),
): DraftEnvelope<T> | null {
  const full = draftKey(scope, key);
  const raw = rawGet(full, storage);
  if (raw === null) return null;
  let env: DraftEnvelope<T> | null = null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftEnvelope<T>> | null;
    if (parsed && 'data' in parsed && typeof parsed.at === 'number' && parsed.v !== undefined) {
      env = parsed as DraftEnvelope<T>;
    }
  } catch {
    env = null;
  }
  const now = opts.now ?? Date.now();
  const stale = !env || env.v !== opts.version || (opts.ttlMs !== undefined && now - env.at > opts.ttlMs);
  if (stale) {
    rawRemove(full, storage);
    return null;
  }
  return env;
}

export function writeDraftEnvelope<T>(
  scope: DraftScope,
  key: string,
  data: T,
  version: string | number,
  storage: StorageLike | null = browserStorage(),
  now: number = Date.now(),
): DraftEnvelope<T> {
  const env: DraftEnvelope<T> = { v: version, at: now, data };
  let raw: string;
  try {
    raw = JSON.stringify(env);
  } catch {
    return env; // not serialisable: nothing to keep across a reload
  }
  rawSet(draftKey(scope, key), raw, storage);
  return env;
}

export function removeDraft(scope: DraftScope, key: string, storage: StorageLike | null = browserStorage()): void {
  rawRemove(draftKey(scope, key), storage);
}

/**
 * Drop every draft of one user, in every restaurant (call it on sign-out).
 * Returns how many keys were removed.
 */
export function clearDraftsForUser(userId: string, storage: StorageLike | null = browserStorage()): number {
  if (!userId) return 0;
  const prefix = `${DRAFT_PREFIX}${userId}:`;
  const doomed = new Set<string>();
  for (const k of memory.keys()) if (k.startsWith(prefix)) doomed.add(k);
  if (storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(prefix)) doomed.add(k);
      }
    } catch {
      /* storage unreadable: memory keys are still cleared */
    }
  }
  for (const k of doomed) rawRemove(k, storage);
  return doomed.size;
}

/** Test-only: forget the in-memory fallback. */
export function __resetDraftMemory(): void {
  memory.clear();
}
