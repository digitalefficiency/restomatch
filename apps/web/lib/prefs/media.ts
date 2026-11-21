'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { NARROW_QUERY, PHONE_QUERY } from './schema';

const hasMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * A media query as React state. `serverValue` is the snapshot for the server
 * and for hydration (so both render the same HTML); after hydration the live
 * value takes over. The queries themselves live in ./schema (server-safe).
 */
export function useMediaMatch(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  const snapshot = useCallback(
    () => (hasMatchMedia() ? window.matchMedia(query).matches : serverValue),
    [query, serverValue],
  );
  return useSyncExternalStore(subscribe, snapshot, () => serverValue);
}

/** Below 1024 px: no side menu (its setting is absent). */
export function useIsNarrow(): boolean {
  return useMediaMatch(NARROW_QUERY);
}

/** A phone (narrow and touch): no keyboard, so no single-key shortcuts setting. */
export function useIsPhone(): boolean {
  return useMediaMatch(PHONE_QUERY);
}

const noSubscribe = () => () => {};

/**
 * False on the server and during hydration, true after: for a value that only
 * the browser knows (the single-key switch lives in localStorage), so the
 * control appears once, with its real state, instead of flipping after load.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
