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
 */
function useFocusClearOfBars() {
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest('[data-field-bar]')) return;
      const bars = [...document.querySelectorAll<HTMLElement>('[data-field-bar]')];
      if (bars.length === 0) return;
      const top = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
      if (el.getBoundingClientRect().bottom > top - 8) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
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
