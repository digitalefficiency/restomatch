'use client';

import { useEffect } from 'react';

/**
 * Publishes the sticky chrome's height as CSS variables on <html> so
 * `scroll-padding` keeps a focused control clear of it (WCAG 2.4.11, a11y-03):
 *   --rm-header-h     a sticky/fixed bar at the top    ([data-rm-chrome="header"] or a sticky <header>)
 *   --rm-bottomnav-h  a fixed bar at the bottom        ([data-rm-chrome="bottomnav"] or a fixed bottom <nav>)
 * Hidden chrome (e.g. the bottom nav from lg) counts as 0. The action bars own
 * `--rm-actionbar-h` and the consent banner `--consent-h`. Mounted once, in
 * the root layout; measurement is batched per frame.
 */
export function ChromeMetrics() {
  useEffect(() => {
    const root = document.documentElement;
    const observed = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());

    function visible(el: Element): el is HTMLElement {
      return el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function find(kind: 'header' | 'bottomnav'): HTMLElement | null {
      const marked = [...document.querySelectorAll(`[data-rm-chrome="${kind}"]`)].find(visible);
      if (marked) return marked;
      const candidates = document.querySelectorAll(kind === 'header' ? 'body header' : 'body nav');
      for (const el of candidates) {
        if (!visible(el)) continue;
        const pos = getComputedStyle(el).position;
        const rect = el.getBoundingClientRect();
        if (kind === 'header' && (pos === 'sticky' || pos === 'fixed') && rect.top <= 1) return el;
        if (kind === 'bottomnav' && pos === 'fixed' && rect.top > window.innerHeight / 2)
          return el;
      }
      return null;
    }
    function measure() {
      frame = 0;
      for (const [kind, prop] of [
        ['header', '--rm-header-h'],
        ['bottomnav', '--rm-bottomnav-h'],
      ] as const) {
        const el = find(kind);
        if (el && !observed.has(el)) {
          observed.add(el);
          resize.observe(el);
        }
        root.style.setProperty(prop, `${el ? Math.round(el.getBoundingClientRect().height) : 0}px`);
      }
    }
    let frame = 0;
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
      root.style.removeProperty('--rm-header-h');
      root.style.removeProperty('--rm-bottomnav-h');
    };
  }, []);
  return null;
}
