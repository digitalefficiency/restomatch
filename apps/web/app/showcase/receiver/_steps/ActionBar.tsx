'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Field-mode sticky action bar (DoD-7, mobile-field §3.5): solid surface, a top
 * hairline, ONE full-width 56 px primary in the bottom third of the screen and
 * at most one line above it (a counter or one text button). Fixed to
 * `--rm-field-bar-bottom` — the dashboard sets it above its mobile bottom nav,
 * the showcase leaves it at 0. A spacer of the bar's own height keeps the last
 * line of content above it, and the bar publishes `--rm-actionbar-h` for
 * scroll-padding and toasts.
 */
export function ActionBar({ children, testId }: { children: React.ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      setH(next);
      root.style.setProperty('--rm-actionbar-h', `${next}px`);
    };
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--rm-actionbar-h');
    };
  }, []);

  return (
    <>
      <div aria-hidden="true" style={{ height: h || 88 }} />
      <div
        ref={ref}
        data-testid={testId}
        data-action-bar=""
        className="fixed inset-x-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        style={{ bottom: 'var(--rm-field-bar-bottom, 0px)' }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">{children}</div>
      </div>
    </>
  );
}

/** The one primary of a field step: full width, 56 px, the outcome in its label. */
export const PRIMARY_56 =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-bold text-on-primary transition-[filter,background-color] duration-150 hover:brightness-110 disabled:bg-surface-2 disabled:text-muted disabled:hover:brightness-100';

/** A secondary action above the primary: a 48 px text button. */
export const SECONDARY_48 =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold text-primary underline-offset-4 hover:underline';
