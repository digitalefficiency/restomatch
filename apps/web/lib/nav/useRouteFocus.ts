'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** The page heading the shell focuses after a client navigation. */
export const PAGE_H1_SELECTOR = '#main-content h1';

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/**
 * After a client-side route change, move focus to the page `<h1>` (or to
 * `#main-content` when a page has none) without scrolling, so keyboard and
 * screen-reader users start at the new page instead of on the link they used.
 * Skipped on the first render and when the user is typing somewhere in the page.
 */
export function useRouteFocus(): void {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const active = document.activeElement;
    const main = document.getElementById('main-content');
    if (isEditable(active) && main?.contains(active)) return;
    const focus = (target: HTMLElement) => {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    // Untouched since the navigation: focus is still on the link, the body or main.
    const untouched = () => {
      const el = document.activeElement;
      return !el || el === document.body || el === main || el === active;
    };
    const h1Now = document.querySelector<HTMLElement>(PAGE_H1_SELECTOR);
    if (h1Now) {
      focus(h1Now);
      return;
    }
    // A streamed page (loading.tsx) commits its heading later: hold focus on
    // main meanwhile, then hand it to the h1 when it arrives (≤ 3 s).
    if (main) focus(main);
    const observer = new MutationObserver(() => {
      const h1 = document.querySelector<HTMLElement>(PAGE_H1_SELECTOR);
      if (!h1) return;
      observer.disconnect();
      if (untouched()) focus(h1);
    });
    if (main) observer.observe(main, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), 3_000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
  }, [pathname]);
}

/** Mount point for the hook in a server layout. */
export function RouteFocus() {
  useRouteFocus();
  return null;
}
