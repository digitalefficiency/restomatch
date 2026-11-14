import { useSyncExternalStore } from 'react';

/**
 * "A phone" for the display preferences: no side menu (the shell shows it from
 * 1024 px), or a touch pointer. There density is fixed at the touch size
 * (SPEC §7, D4 "field mode fixed"; globals.css floors coarse pointers), and the
 * settings that do nothing (the side menu, single-key shortcuts) are absent.
 */
export const TOUCH_QUERY = '(max-width: 1023px), (pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(TOUCH_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(TOUCH_QUERY).matches
    : false;
}

/** False on the server and during hydration (so the first HTML always matches), then the real answer. */
export function useIsTouch(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
