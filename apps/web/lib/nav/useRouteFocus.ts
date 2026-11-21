'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** The page heading the shell focuses after a client navigation. */
export const PAGE_H1_SELECTOR = '#main-content h1';

/** How many frames to wait for a closing layer to release the page (about one second). */
const LAYER_FRAMES = 60;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** An open modal dialog makes everything outside it inert without an `inert` attribute. */
function openModal(): Element | null {
  try {
    return document.querySelector('dialog:modal');
  } catch {
    // An engine without :modal: any open dialog counts.
    return document.querySelector('dialog[open]');
  }
}

/**
 * True while a layer still holds the page: an `inert` ancestor (the 1024–1279
 * overlay sets it on the page column, the phone sheet on `#rm-app`) or an open
 * modal dialog that the page is not inside. Focus cannot land on the page then.
 */
function heldByLayer(main: HTMLElement | null): boolean {
  if (!main) return false;
  if (main.closest('[inert]')) return true;
  const modal = openModal();
  return !!modal && !modal.contains(main);
}

/**
 * After a client-side route change, move focus to the page `<h1>` (or to
 * `#main-content` when a page has none) without scrolling, so keyboard and
 * screen-reader users start at the new page instead of on the link they used.
 * Skipped on the first render and when the user is typing somewhere in the page.
 *
 * A layer that closes on the same navigation (the phone's "עוד" sheet, the
 * 1024–1279 overlay) still holds the page inert for a frame or two, and a
 * native modal `<dialog>` hands focus back to its opener when it closes; so
 * focus lands only once the page is free again (waiting at most ~1 s).
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
    let observer: MutationObserver | null = null;
    let stop: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const land = () => {
      const h1Now = document.querySelector<HTMLElement>(PAGE_H1_SELECTOR);
      if (h1Now) {
        focus(h1Now);
        return;
      }
      // A streamed page (loading.tsx) commits its heading later: hold focus on
      // main meanwhile, then hand it to the h1 when it arrives (≤ 3 s).
      if (main) focus(main);
      const watch = new MutationObserver(() => {
        const h1 = document.querySelector<HTMLElement>(PAGE_H1_SELECTOR);
        if (!h1) return;
        watch.disconnect();
        if (untouched()) focus(h1);
      });
      observer = watch;
      if (main) watch.observe(main, { childList: true, subtree: true });
      stop = setTimeout(() => watch.disconnect(), 3_000);
    };
    let frames = 0;
    const attempt = () => {
      if (heldByLayer(main) && frames < LAYER_FRAMES) {
        frames += 1;
        frame = requestAnimationFrame(attempt);
        return;
      }
      land();
    };
    attempt();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      clearTimeout(stop);
    };
  }, [pathname]);
}

/** Mount point for the hook in a server layout. */
export function RouteFocus() {
  useRouteFocus();
  return null;
}
