'use client';

import { useEffect } from 'react';

/**
 * In-page anchor links (#lead, #how…) smooth-scroll past sections that use
 * `content-visibility: auto` (.rm-defer). Those render at their real height
 * only as the scroll passes them, so the first scroll can stop short of the
 * target. After the scroll settles, nudge once more if the target isn't at its
 * scroll margin — the sections in between are rendered by then, so the second
 * pass is short and lands exactly. No-op when the first scroll was right.
 */
export function AnchorScrollFix() {
  useEffect(() => {
    const settle = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      if (Math.abs(el.getBoundingClientRect().top - margin) > 4) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href*="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      const id = decodeURIComponent(url.hash.slice(1));
      if ('onscrollend' in window) {
        window.addEventListener('scrollend', () => settle(id), { once: true });
      } else {
        setTimeout(() => settle(id), 1000); // Safari: no scrollend event yet
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
