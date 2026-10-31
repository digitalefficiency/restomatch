'use client';

import { useSyncExternalStore } from 'react';

/**
 * Who shows the "no connection" chip. One chip per screen: a route with a
 * richer offline chip claims the spot (W1-06's ReceiverPwa on receiving routes
 * — it carries "saved on the phone · N waiting"), and the shell's generic chip
 * yields so it never paints over it or announces "offline" twice.
 * Counted, so a StrictMode double-mount or two owners release cleanly.
 */

let claims = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Claim the offline chip spot; call the returned function on unmount. */
export function claimOfflineChip(): () => void {
  claims += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    emit();
  };
}

export function isOfflineChipClaimed(): boolean {
  return claims > 0;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOfflineChipClaimed(): boolean {
  return useSyncExternalStore(subscribe, isOfflineChipClaimed, () => false);
}
