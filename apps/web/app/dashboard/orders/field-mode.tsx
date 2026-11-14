'use client';

import { useEffect } from 'react';
import { nav } from '@/lib/i18n/messages/nav';

/**
 * Field mode for the order wizard and capture (DoD-7): the page is a task, so the
 * phone bottom bar steps aside and the task's own sticky bar takes the thumb zone.
 * Until the nav registry hides the bar on field routes itself (W1-03), the bar is
 * hidden here by its accessible name — the same in every locale it can render in.
 */
const MOBILE_NAV_LABELS = [
  nav.he.mobileLabel,
  nav.en.mobileLabel,
  ...Object.values(nav.extra ?? {}).map((o) => o?.mobileLabel),
].filter((l): l is string => typeof l === 'string' && l.length > 0);

/**
 * Focus Not Obscured (WCAG 2.4.11): a control that takes focus under a sticky task
 * bar (marked `data-field-bar`) is scrolled to the middle. Browsers don't scroll an
 * element that is technically inside the viewport, even when the bar covers it.
 *
 * A pointer press focuses on pointerdown, before its click: scrolling then moves the
 * control out from under the pointer, the release lands elsewhere and the tap is
 * lost (a catalog item near the bar added nothing). So focus from a pointer waits
 * for the release; keyboard focus (Tab) still scrolls at once.
 */
function useFocusClearOfBars() {
  useEffect(() => {
    let pressing = false;
    let pending: HTMLElement | null = null;
    const clear = (el: HTMLElement) => {
      if (!el.isConnected || el.closest('[data-field-bar]')) return;
      const bars = [...document.querySelectorAll<HTMLElement>('[data-field-bar]')];
      if (bars.length === 0) return;
      const top = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
      if (el.getBoundingClientRect().bottom > top - 8) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (pressing) pending = el;
      else clear(el);
    };
    const onDown = () => {
      pressing = true;
    };
    const onUp = () => {
      pressing = false;
      const el = pending;
      pending = null;
      // After the click has been dispatched to the element that was pressed.
      if (el) window.setTimeout(() => document.activeElement === el && clear(el), 0);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
  }, []);
}

export function FieldMode({ children, className }: { children: React.ReactNode; className?: string }) {
  useFocusClearOfBars();
  const css = `@media (max-width: 1023.98px){${MOBILE_NAV_LABELS.map(
    (l) => `nav[aria-label="${l.replace(/["\\]/g, '\\$&')}"]`,
  ).join(',')}{display:none!important}}`;
  return (
    <div data-mode="field" className={className}>
      <style>{css}</style>
      {children}
    </div>
  );
}
