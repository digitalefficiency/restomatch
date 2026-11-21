'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Publishes the sticky decision bar's height as `--rm-actionbar-h` on <html> while `enabled` (DS3-04 §2.3, §4.5),
 * so `scroll-padding-bottom` keeps a focused control above the bar (W1-01 "focus not obscured"). A ResizeObserver
 * follows the bar as it wraps; the property is removed when disabled and on unmount. The same publisher as the
 * receiving flow's ActionBar (app/showcase/receiver/_steps/ActionBar.tsx).
 */
export function useActionBarHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--rm-actionbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--rm-actionbar-h');
    };
  }, [ref, enabled]);
}
