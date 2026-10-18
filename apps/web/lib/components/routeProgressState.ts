/**
 * Route-progress bar state, kept pure so it can be unit tested (the component
 * in RouteProgress.tsx only wires DOM events to `progressReducer`).
 */

/** Event a programmatic navigation dispatches so the bar shows (see startRouteProgress). */
export const ROUTE_START_EVENT = 'rm:route-start';
/** Event the history hook dispatches whenever a navigation commits a URL. */
export const ROUTE_COMMIT_EVENT = 'rm:route-commit';

/**
 * Should a click on this link show the bar? Only plain primary clicks on
 * same-origin links that change the PATH (cross-route navigations; same-route
 * search-param / hash changes commit in place and need no bar).
 */
export function isCrossRouteClick(
  link: { href: string; target?: string | null; download?: boolean },
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  current: { origin: string; pathname: string; href?: string },
): boolean {
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((link.target && link.target !== '_self') || link.download) return false;
  let url: URL;
  try {
    // Relative hrefs ('#x', '?p=') resolve against the current page, like the browser does.
    url = new URL(link.href, current.href ?? current.origin);
  } catch {
    return false;
  }
  // mailto:/javascript:/tel: have an opaque ("null") origin and never match.
  return url.origin === current.origin && url.pathname !== current.pathname;
}

export type Phase = 'idle' | 'start' | 'run' | 'done';

export interface ProgressState {
  phase: Phase;
  /** Pathname being navigated to (re-clicks on the same target are ignored). */
  target: string | null;
}

export type ProgressEvent =
  | { type: 'start'; target: string }
  /** Two frames after start: begin the slow creep. */
  | { type: 'frame' }
  /** Any committed URL change (push/replace/pop): the navigation landed or was superseded. */
  | { type: 'commit' }
  /** The cap elapsed without a commit (cancelled navigation): fade out. */
  | { type: 'timeout' }
  /** The fade finished. */
  | { type: 'reset' };

export const IDLE: ProgressState = { phase: 'idle', target: null };

const active = (s: ProgressState) => s.phase === 'start' || s.phase === 'run';

export function progressReducer(state: ProgressState, event: ProgressEvent): ProgressState {
  switch (event.type) {
    case 'start':
      // Re-clicking the target that is already loading keeps the bar where it is.
      if (active(state) && state.target === event.target) return state;
      return { phase: 'start', target: event.target };
    case 'frame':
      return state.phase === 'start' ? { ...state, phase: 'run' } : state;
    case 'commit':
    case 'timeout':
      return active(state) ? { phase: 'done', target: null } : state;
    case 'reset':
      return state.phase === 'done' ? IDLE : state;
  }
}

/**
 * Show the bar for a programmatic navigation (router.push after a mutation,
 * search results …). Call it right before `router.push(href)`.
 */
export function startRouteProgress(href: string): void {
  if (typeof document === 'undefined') return;
  let target = href;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
    target = url.pathname;
  } catch {
    return;
  }
  document.dispatchEvent(new CustomEvent(ROUTE_START_EVENT, { detail: { target } }));
}
