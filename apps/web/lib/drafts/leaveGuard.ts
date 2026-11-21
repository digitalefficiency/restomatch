'use client';

import { useEffect, useRef } from 'react';

export type LeaveTarget = { kind: 'href'; href: string } | { kind: 'back' };

/** The browser surface the guard touches (so tests can pass a fake window/document). */
export interface LeaveGuardEnv {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'history' | 'location'>;
  document: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

/** Mutable state shared between the listeners and the hook (refs in React). */
export interface LeaveGuardState {
  dirty: boolean;
  ask: (target: LeaveTarget) => void;
  guardPushed: boolean;
  bypass: boolean;
}

/**
 * Hoisted 1:1 from `app/dashboard/receiving/[poId]/_fieldHooks.ts` (`useLeaveGuard`,
 * RCV-02, mobile-field §3.5) so every field screen shares one implementation:
 * `beforeunload`, in-app links (the back link, the nav) and the browser back
 * button all stop at the leave sheet. The back button is caught with one
 * duplicate history entry, pushed only while work is unsent.
 *
 * Returns the cleanup. The React hook below is a thin wrapper.
 */
export function attachLeaveGuard(env: LeaveGuardEnv, s: LeaveGuardState): () => void {
  const { window: win, document: doc } = env;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!s.dirty || s.bypass) return;
    e.preventDefault();
    e.returnValue = '';
  };
  const onClick = (e: MouseEvent) => {
    if (!s.dirty || s.bypass || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, win.location.href);
    if (url.origin !== win.location.origin || url.pathname === win.location.pathname) return;
    e.preventDefault();
    e.stopPropagation();
    s.ask({ kind: 'href', href: url.pathname + url.search + url.hash });
  };
  const onPop = () => {
    if (s.bypass) return;
    if (s.dirty && s.guardPushed) {
      // Stay: put the guard entry back and ask.
      win.history.pushState(win.history.state, '', win.location.href);
      s.ask({ kind: 'back' });
    } else if (s.guardPushed) {
      // Everything was saved since the guard entry went in: this back press only
      // left the duplicate entry — take the real step back so it isn't a dead press.
      s.guardPushed = false;
      win.history.back();
    }
  };
  win.addEventListener('beforeunload', onBeforeUnload as EventListener);
  doc.addEventListener('click', onClick as EventListener, true);
  win.addEventListener('popstate', onPop);
  return () => {
    win.removeEventListener('beforeunload', onBeforeUnload as EventListener);
    doc.removeEventListener('click', onClick as EventListener, true);
    win.removeEventListener('popstate', onPop);
  };
}

/** Push the one duplicate entry (same URL, same router state) the first time work becomes unsent. */
export function syncGuardEntry(env: Pick<LeaveGuardEnv, 'window'>, s: LeaveGuardState): void {
  if (s.dirty && !s.guardPushed) {
    env.window.history.pushState(env.window.history.state, '', env.window.location.href);
    s.guardPushed = true;
  }
}

/** Leave for real: no more asking; a back leave skips the guard entry too. */
export function leaveNow(env: Pick<LeaveGuardEnv, 'window'>, s: LeaveGuardState, target: LeaveTarget): void {
  s.bypass = true;
  if (target.kind === 'href') env.window.location.assign(target.href);
  else env.window.history.go(s.guardPushed ? -2 : -1);
}

/**
 * Never leave silently while work is not saved yet. `onAsk` opens your leave
 * sheet (reuse `overlay/Sheet`); its "leave anyway" button calls `leave(target)`.
 * Same signature and semantics as the receiving wizard's hook it was hoisted from.
 */
export function useLeaveGuard(dirty: boolean, onAsk: (target: LeaveTarget) => void): { leave: (target: LeaveTarget) => void } {
  const state = useRef<LeaveGuardState>({ dirty, ask: onAsk, guardPushed: false, bypass: false });
  state.current.dirty = dirty;
  state.current.ask = onAsk;

  useEffect(() => attachLeaveGuard({ window, document }, state.current), []);

  useEffect(() => {
    syncGuardEntry({ window }, state.current);
  }, [dirty]);

  return {
    leave(target) {
      leaveNow({ window }, state.current, target);
    },
  };
}
