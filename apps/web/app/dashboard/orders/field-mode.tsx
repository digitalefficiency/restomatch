'use client';

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

export function FieldMode({ children, className }: { children: React.ReactNode; className?: string }) {
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
