'use client';

import { useSyncExternalStore } from 'react';

/**
 * Session-expiry store (perf-states-15). A tRPC call that comes back
 * `UNAUTHORIZED` parks its retry here and opens the re-auth sheet; the page
 * stays mounted, so in-memory work (counts, order lines, typed text) survives.
 * After a successful sign-in every parked retry runs once.
 */

type Retry = () => unknown;

let open = false;
let retries: Retry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open the sheet and remember what to re-run after sign-in. */
export function requestReauth(retry?: Retry) {
  if (retry) retries.push(retry);
  if (!open) {
    open = true;
    emit();
  }
}

/** Signed in again: close the sheet and replay the parked calls (each once). */
export function completeReauth(): number {
  const pending = retries;
  retries = [];
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
  retries = [];
  open = false;
  emit();
}

/** The sheet was dismissed without signing in: keep the parked calls for the next sign-in. */
export function dismissReauth() {
  if (!open) return;
  open = false;
  emit();
}

export function pendingRetries(): number {
  return retries.length;
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
