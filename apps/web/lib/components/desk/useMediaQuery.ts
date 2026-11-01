'use client';

import { useSyncExternalStore } from 'react';

/** `matchMedia` as React state. The server snapshot is `fallback` (desktop-first desk pages pass `true`). */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}
