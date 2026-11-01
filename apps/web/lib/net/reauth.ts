'use client';

import { useSyncExternalStore } from 'react';

/**
 * Session-expiry store (perf-states-15). A tRPC call that comes back
 * `UNAUTHORIZED` opens the re-auth sheet; the page stays mounted, so in-memory
 * work (counts, order lines, typed text) survives.
 *
 * Only READS are parked for replay (deduped by query key). A mutation is never
 * parked: it fails to its own caller ("not sent"), and the user re-taps after
 * signing in — so a money decision runs at most once, from the user's hand,
 * against the branch they are looking at (W1-04 review, blockers 1–2).
 */

type Retry = () => unknown;

let open = false;
let retries = new Map<string, Retry>();
let anon = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open the sheet; `retry` (a read, keyed) re-runs once after sign-in. */
export function requestReauth(retry?: Retry, key?: string) {
  if (retry) retries.set(key ?? `anon:${anon++}`, retry);
  if (!open) {
    open = true;
    emit();
  }
}

/** Signed in again: close the sheet and replay the parked calls (each once). */
export function completeReauth(): number {
  const pending = [...retries.values()];
  retries = new Map();
  open = false;
  emit();
  for (const r of pending) {
    try {
      const out = r();
      if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch(() => {});
    } catch {
      // A retry that fails again re-opens the sheet through the same path.
    }
  }
  return pending.length;
}

/** Drop the parked calls (a different user signed in — never replay their work). */
export function abandonReauth() {
  retries = new Map();
  open = false;
  emit();
}

/** The sheet was dismissed without signing in. Parked reads are dropped (nothing stale replays later). */
export function dismissReauth() {
  retries = new Map();
  if (!open) return;
  open = false;
  emit();
}

export function pendingRetries(): number {
  return retries.size;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReauthOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
