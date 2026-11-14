import { useCallback, useSyncExternalStore } from 'react';

/**
 * "A phone" for the display preferences: no side menu (the shell shows it from
 * 1024 px), or a touch pointer. There density is fixed at the touch size
 * (SPEC §7, D4 "field mode fixed"; globals.css floors coarse pointers), and the
 * settings that do nothing (the side menu, single-key shortcuts) are absent.
 */
export const TOUCH_QUERY = '(max-width: 1023px), (pointer: coarse)';
/** No side menu: the shell shows it from 1024 px. Desk-only settings (side menu, single-key shortcuts) are absent below. */
export const NARROW_QUERY = '(max-width: 1023px)';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** A media query as React state: false on the server and during hydration (the first HTML always matches), then live. */
export function useMediaMatch(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  const snapshot = useCallback(() => (hasMatchMedia() ? window.matchMedia(query).matches : false), [query]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

const serverSnapshot = () => false;

export function useIsTouch(): boolean {
  return useMediaMatch(TOUCH_QUERY);
}

export function useIsNarrow(): boolean {
  return useMediaMatch(NARROW_QUERY);
}
