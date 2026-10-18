'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Should a click on this link show the route-progress bar? Only plain left
 * clicks on same-origin links that change the PATH (cross-route navigations —
 * same-route search-param changes commit in place and need no bar).
 * Pure, for tests.
 */
export function isCrossRouteClick(
  link: { href: string; target?: string | null; download?: boolean },
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  current: { origin: string; pathname: string },
): boolean {
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((link.target && link.target !== '_self') || link.download) return false;
  let url: URL;
  try {
    url = new URL(link.href, current.origin);
  } catch {
    return false;
  }
  return url.origin === current.origin && url.pathname !== current.pathname;
}

/** Longest the bar stays up if a navigation never lands (e.g. it was cancelled). */
const MAX_MS = 10_000;

type Phase = 'idle' | 'start' | 'run' | 'done';

const PHASE_CLASS: Record<Phase, string> = {
  // Collapsed, invisible, no transition (so the next start grows from zero).
  idle: 'opacity-0 [transform:scaleX(0)]',
  start: 'opacity-100 [transform:scaleX(0)]',
  // Creep towards 85% while the next page renders.
  run: 'opacity-100 [transform:scaleX(0.85)] transition-transform duration-[2500ms] ease-out motion-reduce:transition-none',
  // Landed: fill and fade.
  done: 'opacity-0 [transform:scaleX(1)] transition-[transform,opacity] duration-300',
};

/**
 * Thin top progress bar for cross-route navigations. The dashboard routes no
 * longer have a loading.tsx skeleton (it stalled same-route navigations in
 * production builds — see scripts/check-soft-nav.mjs), so this gives feedback
 * while the next page renders. It only listens for link clicks and watches the
 * pathname: no Suspense boundary, no router calls, so it cannot hold up a
 * navigation.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const go = isCrossRouteClick(
        { href: a.href, target: a.getAttribute('target'), download: a.hasAttribute('download') },
        e,
        window.location,
      );
      if (!go) return;
      setPhase('start');
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase((p) => (p === 'start' ? 'run' : p))));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPhase('idle'), MAX_MS);
    };
    // Capture phase: next/link calls preventDefault() in its own handler (it
    // navigates client-side), so a bubble listener would see every link click
    // as already handled.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // The new route rendered → fill, fade, reset.
  useEffect(() => {
    setPhase((p) => (p === 'idle' ? p : 'done'));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase('idle'), 350);
  }, [pathname]);

  return (
    <div
      aria-hidden="true"
      data-route-progress={phase}
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden"
    >
      <div className={`h-full w-full origin-left bg-primary shadow-glow-primary rtl:origin-right ${PHASE_CLASS[phase]}`} />
    </div>
  );
}
