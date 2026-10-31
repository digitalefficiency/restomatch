'use client';

import { useEffect, useRef, useState } from 'react';
import type { LineMark } from '@/app/showcase/receiver/_state';
import { requestReauth } from '@/lib/net/reauth';
import { createAuthGate, type AuthGate } from '@/lib/pwa/authGate';
import { isTransientFailure } from '@/lib/pwa/offlineQueue';
import { useReauthResumed } from '@/lib/pwa/useReauthResumed';
import { grLineForMark } from './_adapters';
import { grLineIsCounted } from './_count';
import {
  createLineOutbox,
  localStorageOutbox,
  type GrLinePayload,
  type LineOutbox,
  type LineSaveState,
  type RowStamp,
  type RowStatus,
} from '@/lib/pwa/lineOutbox';

/** How often queued (offline) line saves are retried while the wizard is open. */
const RETRY_EVERY_MS = 15_000;

/** The full gr_line row for a mark (through the count model). An unresolved line is the fresh row. */
export function payloadFor(grLineId: string, mark: LineMark): GrLinePayload {
  return { grLineId, ...grLineForMark(mark) };
}

/** Is this unsent payload a resolved line (vs a reset to "not counted")? */
export function payloadIsCounted(p: GrLinePayload): boolean {
  return grLineIsCounted({ ...p, condition: p.condition ?? 'ok' });
}

/**
 * The Delivery Check's line outbox (lib/pwa/lineOutbox) bound to
 * receiving.markGrLine: saved on change, kept on the phone while offline,
 * retried on `online` and every 15 s. Storage is per user + PO. For a receipt
 * that is already closed, stale unsent rows are dropped, never retried into it.
 * An expired session (401) opens W1-04's re-auth sheet — these calls bypass the
 * QueryClient's caches — keeps the row queued, and holds the automatic retries
 * until the receiver signs in again; then everything unsent goes at once.
 */
export function useLineSaves(
  storageKey: string,
  send: (p: GrLinePayload) => Promise<unknown>,
  closed = false,
  /** Is a stored row for the receipt as it is now (not counted before a close / reopen)? */
  rowStatus?: (p: GrLinePayload) => RowStatus,
): { outbox: LineOutbox; states: Record<string, LineSaveState>; pending: number; authGate: AuthGate } {
  const sendRef = useRef(send);
  sendRef.current = send;
  const [states, setStates] = useState<Record<string, LineSaveState>>({});
  const [pending, setPending] = useState(0);
  const statusRef = useRef(rowStatus);
  statusRef.current = rowStatus;
  const boxRef = useRef<LineOutbox | null>(null);
  const gateRef = useRef<AuthGate | null>(null);
  if (!gateRef.current) gateRef.current = createAuthGate(() => requestReauth());
  const authGate = gateRef.current;
  if (!boxRef.current) {
    const box: LineOutbox = createLineOutbox({
      send: authGate.wrap((p: GrLinePayload) => sendRef.current(p)),
      rowStatus: (p) => statusRef.current?.(p) ?? 'current',
      // No network, or signed out mid-count (401): kept on the phone, retried — never "failed".
      isNetworkError: isTransientFailure,
      storage: typeof window === 'undefined' ? undefined : localStorageOutbox(storageKey),
      onChange: (s) => {
        setStates(s);
        setPending(box.pendingCount());
      },
    });
    if (closed) box.clear();
    boxRef.current = box;
  }
  const outbox = boxRef.current;

  useEffect(() => {
    if (closed) return;
    setPending(outbox.pendingCount());
    setStates(outbox.states());
    const retry = () => {
      if (navigator.onLine && authGate.shouldAutoRetry() && outbox.pendingCount() > 0) void outbox.retry();
    };
    retry();
    window.addEventListener('online', retry);
    const id = window.setInterval(retry, RETRY_EVERY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(id);
    };
  }, [outbox, closed, authGate]);

  // Signed in again (the sheet closed with a session): send everything unsent now.
  useReauthResumed(() => {
    authGate.resume();
    if (!closed && outbox.pendingCount() > 0) void outbox.retry();
  });

  return { outbox, states, pending, authGate };
}

/** What the wizard remembers per PO on this device so a reload resumes (grId, the invoice being read). */
export interface ReceiptDraft {
  grId: string;
  invoiceId: string | null;
  savedAt: number;
  /** The receipt's version (open/close cycle) the draft belongs to. */
  version?: string | null;
}

export function readDraft(key: string): ReceiptDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    const d = raw ? (JSON.parse(raw) as Partial<ReceiptDraft>) : null;
    return d && typeof d.grId === 'string'
      ? { grId: d.grId, invoiceId: d.invoiceId ?? null, savedAt: d.savedAt ?? 0, version: d.version ?? null }
      : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, draft: ReceiptDraft | null): void {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    /* storage blocked: the server keeps the counts; only the invoice link is lost */
  }
}

/**
 * Marks on lines that are only on the invoice (not ordered) have no gr_line to
 * save to; they are kept on this device per PO so a reload never loses them —
 * stamped with the receipt's open/close cycle, and only restored into that
 * same cycle (never into a receipt closed or reopened since).
 */
export function readLocalMarks(key: string, stamp: RowStamp | null): Record<string, LineMark> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = (raw ? JSON.parse(raw) : null) as { stamp?: RowStamp; marks?: Record<string, LineMark> } | null;
    if (!stamp || !parsed?.stamp || !parsed.marks) return {};
    return parsed.stamp.grId === stamp.grId && parsed.stamp.version === stamp.version ? parsed.marks : {};
  } catch {
    return {};
  }
}

export function writeLocalMarks(key: string, marks: Record<string, LineMark> | null, stamp: RowStamp | null = null): void {
  try {
    if (!marks || Object.keys(marks).length === 0 || !stamp) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ stamp, marks }));
  } catch {
    /* storage blocked: these marks live in memory until the close */
  }
}

/** Keep the screen on while the receiver counts (mobile-field-22); re-acquired when the tab is shown again. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    type Sentinel = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!wl) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      wl.request('screen')
        .then((s) => {
          if (cancelled) void s.release().catch(() => null);
          else sentinel = s;
        })
        .catch(() => null);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => null);
    };
  }, [active]);
}

export type LeaveTarget = { kind: 'href'; href: string } | { kind: 'back' };

/**
 * Never leave silently while counts are not on the server yet (RCV-02,
 * mobile-field §3.5): `beforeunload`, in-app links (the back link, the nav)
 * and the browser back button all stop at the leave sheet. The back button is
 * caught with one duplicate history entry, pushed only while work is unsent.
 */
export function useLeaveGuard(dirty: boolean, onAsk: (target: LeaveTarget) => void): { leave: (target: LeaveTarget) => void } {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  const guardPushed = useRef(false);
  const bypass = useRef(false);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || bypass.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || bypass.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      askRef.current({ kind: 'href', href: url.pathname + url.search + url.hash });
    };
    const onPop = () => {
      if (bypass.current) return;
      if (dirtyRef.current && guardPushed.current) {
        // Stay: put the guard entry back and ask.
        window.history.pushState(window.history.state, '', window.location.href);
        askRef.current({ kind: 'back' });
      } else if (guardPushed.current) {
        // Everything was sent since the guard entry went in: this back press only
        // left the duplicate entry — take the real step back so it isn't a dead press.
        guardPushed.current = false;
        window.history.back();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  // Push one duplicate entry (same URL, same router state) while work is unsent.
  useEffect(() => {
    if (dirty && !guardPushed.current) {
      window.history.pushState(window.history.state, '', window.location.href);
      guardPushed.current = true;
    }
  }, [dirty]);

  return {
    leave(target) {
      bypass.current = true;
      if (target.kind === 'href') window.location.assign(target.href);
      else window.history.go(guardPushed.current ? -2 : -1);
    },
  };
}

/**
 * Where the field action bar sits: right on top of whatever fixed bar is at the
 * bottom of the screen (the dashboard's phone nav, the consent bar), measured —
 * the shell's `--rm-bottomnav-h` wins once the shell publishes it. Sets
 * `--rm-field-bar-bottom` on `el`.
 */
export function useFieldBarOffset(el: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const measure = () => {
      const published = getComputedStyle(document.documentElement).getPropertyValue('--rm-bottomnav-h').trim();
      if (published) {
        root.style.setProperty('--rm-field-bar-bottom', `calc(${published} + var(--consent-h, 0px))`);
        return;
      }
      // The lowest fixed nav (it already sits above the consent bar); else the consent bar alone.
      let top = window.innerHeight;
      for (const n of document.querySelectorAll<HTMLElement>('nav.fixed, [data-bottom-bar]')) {
        const r = n.getBoundingClientRect();
        if (r.height > 0 && r.top > window.innerHeight / 2 && getComputedStyle(n).display !== 'none') top = Math.min(top, r.top);
      }
      if (top < window.innerHeight) root.style.setProperty('--rm-field-bar-bottom', `${Math.round(window.innerHeight - top)}px`);
      else root.style.removeProperty('--rm-field-bar-bottom'); // no bottom nav: the CSS default (lg: consent only)
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    for (const n of document.querySelectorAll<HTMLElement>('nav.fixed')) ro?.observe(n);
    window.addEventListener('resize', measure);
    const id = window.setInterval(measure, 2_000); // the consent bar comes and goes
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.clearInterval(id);
    };
  }, [el]);
}
