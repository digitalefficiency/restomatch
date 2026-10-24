'use client';

import { useEffect, useReducer } from 'react';
import {
  IDLE,
  ROUTE_COMMIT_EVENT,
  ROUTE_START_EVENT,
  isCrossRouteClick,
  progressReducer,
  type Phase,
} from './routeProgressState';

export { isCrossRouteClick, startRouteProgress } from './routeProgressState';

/** Longest the bar waits for a commit (a cancelled navigation never commits). */
const MAX_MS = 6_000;
/** Length of the fade after a commit / timeout. */
const FADE_MS = 300;

const PHASE_CLASS: Record<Phase, string> = {
  // Collapsed, invisible, no transition (so the next start grows from zero).
  idle: 'opacity-0 [transform:scaleX(0)]',
  start: 'opacity-100 [transform:scaleX(0)]',
  // Creep towards 85% while the next page renders.
  run: 'opacity-100 [transform:scaleX(0.85)] transition-transform duration-[2500ms] ease-out motion-reduce:transition-none',
  // Landed (or superseded / timed out): fill and fade; reduced motion only fades.
  done: 'opacity-0 [transform:scaleX(1)] transition-[transform,opacity] duration-300 motion-reduce:transition-opacity',
};

let historyHooked = false;
/**
 * Every committed app-router navigation writes history (pushState/replaceState),
 * Back/Forward fire popstate. Announce all three as a "commit" so the bar ends on
 * ANY URL change — a superseded navigation, a redirect back to the same path, a
 * view-control replace — not only a pathname change. Installed once, passive.
 */
function hookHistory() {
  if (historyHooked || typeof window === 'undefined') return;
  historyHooked = true;
  // Deferred: Next writes history from a useInsertionEffect (HistoryUpdater),
  // where a synchronous dispatch would schedule a React update inside the commit
  // ("useInsertionEffect must not schedule updates"; during hydration of a
  // late-streamed segment it can also force React off the server HTML).
  const announce = () =>
    queueMicrotask(() => document.dispatchEvent(new Event(ROUTE_COMMIT_EVENT)));
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method];
    window.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      announce();
      return result;
    } as History['pushState'];
  }
  window.addEventListener('popstate', announce);
}

/**
 * Thin top progress bar for cross-route navigations. The dashboard routes no
 * longer have a loading.tsx skeleton (it stalled same-route navigations in
 * production builds — see scripts/check-soft-nav.mjs), so this gives feedback
 * while the next page renders. No Suspense boundary, no router calls, no
 * useSearchParams: it cannot hold up a navigation. Idle, it schedules nothing.
 */
export function RouteProgress() {
  const [state, dispatch] = useReducer(progressReducer, IDLE);

  useEffect(() => {
    hookHistory();
    const start = (target: string) => {
      dispatch({ type: 'start', target });
      requestAnimationFrame(() => requestAnimationFrame(() => dispatch({ type: 'frame' })));
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const link = { href: a.href, target: a.getAttribute('target'), download: a.hasAttribute('download') };
      if (isCrossRouteClick(link, e, window.location)) start(new URL(a.href).pathname);
    };
    const onStart = (e: Event) => {
      const target = (e as CustomEvent<{ target?: string }>).detail?.target;
      if (target) start(target);
    };
    const onCommit = () => dispatch({ type: 'commit' });
    // Capture phase: next/link calls preventDefault() in its own handler (it
    // navigates client-side), so a bubble listener would see every link click
    // as already handled.
    document.addEventListener('click', onClick, true);
    document.addEventListener(ROUTE_START_EVENT, onStart);
    document.addEventListener(ROUTE_COMMIT_EVENT, onCommit);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener(ROUTE_START_EVENT, onStart);
      document.removeEventListener(ROUTE_COMMIT_EVENT, onCommit);
    };
  }, []);

  // Timers only while the bar is up: the cap while loading, the fade after.
  useEffect(() => {
    if (state.phase === 'start' || state.phase === 'run') {
      const id = window.setTimeout(() => dispatch({ type: 'timeout' }), MAX_MS);
      return () => window.clearTimeout(id);
    }
    if (state.phase === 'done') {
      const id = window.setTimeout(() => dispatch({ type: 'reset' }), FADE_MS);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [state.phase, state.target]);

  return (
    <div aria-hidden="true" data-route-progress={state.phase} className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5">
      <div
        className={`h-full w-full origin-left bg-primary rtl:origin-right ${PHASE_CLASS[state.phase]}`}
      />
    </div>
  );
}
