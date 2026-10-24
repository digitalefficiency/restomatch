'use client';

import { useEffect } from 'react';

/** How long after a click a scroll may take to start before nothing is armed. */
const START_TIMEOUT_MS = 400;
/** How long a settle may wait for the smooth scroll to end before giving up. */
const SETTLE_TIMEOUT_MS = 1500;

/**
 * In-page anchor links (#lead, #how…) smooth-scroll past sections that use
 * `content-visibility: auto` (.rm-defer). Those render at their real height
 * only as the scroll passes them, so the first scroll can stop short of the
 * target. When that scroll ends, nudge once more if the target isn't at its
 * scroll margin — the sections in between are rendered by then, so the second
 * pass is short and lands exactly.
 *
 * Armed only when a scroll actually starts within 400 ms of the click (an
 * already-aligned target arms nothing), and disarmed on timeout, on any user scroll input (wheel, touch,
 * keys), on the next click and on unmount — so it can never yank a later,
 * manual scroll. The nudge uses the page's `scroll-behavior` (smooth, or
 * instant under prefers-reduced-motion).
 */
export function AnchorScrollFix() {
  useEffect(() => {
    let pending: AbortController | null = null;
    const disarm = () => {
      pending?.abort();
      pending = null;
    };

    const settle = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      if (Math.abs(el.getBoundingClientRect().top - margin) > 4) el.scrollIntoView({ block: 'start' });
    };

    const onClick = (e: MouseEvent) => {
      // Not checking defaultPrevented: Next's <Link> prevents the default and scrolls itself.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href*="#"]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self')) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      const id = decodeURIComponent(url.hash.slice(1));
      disarm();
      const ctrl = new AbortController();
      pending = ctrl;
      const { signal } = ctrl;
      // Any user scroll input from here on cancels everything: never yank a manual scroll.
      for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
        window.addEventListener(type, disarm, { once: true, passive: true, signal });
      }
      // Arm only if the click actually starts a scroll (Next's <Link> scrolls
      // after its router transition, a few frames later); an already-aligned
      // target never scrolls, so nothing stays armed.
      const noScroll = setTimeout(disarm, START_TIMEOUT_MS);
      signal.addEventListener('abort', () => clearTimeout(noScroll));
      window.addEventListener(
        'scroll',
        () => {
          clearTimeout(noScroll);
          const done = () => {
            if (signal.aborted) return;
            disarm();
            settle(id);
          };
          if ('onscrollend' in window) window.addEventListener('scrollend', done, { once: true, signal });
          const settleTimer = setTimeout(done, SETTLE_TIMEOUT_MS); // also Safari's path (no scrollend yet)
          signal.addEventListener('abort', () => clearTimeout(settleTimer));
        },
        { once: true, passive: true, signal },
      );
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      disarm();
    };
  }, []);
  return null;
}
