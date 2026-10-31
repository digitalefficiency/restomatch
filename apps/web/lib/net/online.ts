'use client';

import { useSyncExternalStore } from 'react';

/**
 * Connectivity store (perf-states-08, lens §2.5). `navigator.onLine` lies on
 * captive Wi-Fi and some VPNs, so an `online` event is only believed once a
 * `HEAD /api/healthz` answers within 3 s. `offline` is believed at once — the
 * cost of a false "no connection" chip is a few seconds of calm grey text; the
 * cost of a missed one is a money button that spins forever.
 */

const PROBE_URL = '/api/healthz';
const PROBE_TIMEOUT_MS = 3_000;
/** While the probe says "still down", look again this often. */
const REPROBE_MS = 5_000;

let online = true;
let started = false;
let reprobe: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === online) return;
  online = next;
  for (const l of listeners) l();
}

/** True if the server answers — a HEAD with a timeout, never cached. */
export async function probe(fetchImpl: typeof fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PROBE_URL, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function confirmOnline() {
  if (reprobe) clearTimeout(reprobe);
  reprobe = null;
  const ok = await probe();
  if (ok) set(true);
  else if (typeof navigator !== 'undefined' && navigator.onLine) reprobe = setTimeout(confirmOnline, REPROBE_MS);
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  online = navigator.onLine;
  window.addEventListener('offline', () => {
    if (reprobe) clearTimeout(reprobe);
    reprobe = null;
    set(false);
  });
  window.addEventListener('online', () => void confirmOnline());
}

/**
 * A request failed at the network layer (fetch threw). Re-check instead of
 * waiting for the browser to notice: a dead Wi-Fi often fires no event.
 */
export function reportNetworkFailure() {
  if (typeof window === 'undefined') return;
  void probe().then((ok) => {
    if (ok) return;
    set(false);
    if (navigator.onLine) reprobe ??= setTimeout(confirmOnline, REPROBE_MS);
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current connectivity; `true` on the server (SSR renders the online UI). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => online,
    () => true,
  );
}

/** Non-hook read, for event handlers. */
export function isOnline(): boolean {
  start();
  return online;
}
