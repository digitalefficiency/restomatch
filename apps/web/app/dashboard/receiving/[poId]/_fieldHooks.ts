'use client';

import { useEffect, useRef, useState } from 'react';
import type { LineMark } from '@/app/showcase/receiver/_state';
import { isNetworkError } from '@/lib/pwa/offlineQueue';
import {
  createLineOutbox,
  localStorageOutbox,
  type GrLinePayload,
  type LineOutbox,
  type LineSaveState,
} from '@/lib/pwa/lineOutbox';

/** How often queued (offline) line saves are retried while the wizard is open. */
const RETRY_EVERY_MS = 15_000;

/** The full gr_line row for a mark. An unresolved line is the fresh row (nothing counted). */
export function payloadFor(grLineId: string, mark: LineMark): GrLinePayload {
  if (!mark.touched) return { grLineId, qtyReceived: 0, qtyRejected: 0, condition: 'ok' };
  return {
    grLineId,
    qtyReceived: mark.qtyReceived,
    qtyRejected: mark.qtyRejected,
    ...(mark.rejectReason ? { rejectReason: mark.rejectReason } : {}),
    condition: mark.condition,
    ...(mark.notes ? { conditionNotes: mark.notes } : {}),
  };
}

/** Is this unsent payload a resolved line (vs a reset to "not counted")? */
export function payloadIsCounted(p: GrLinePayload): boolean {
  return p.qtyReceived > 0 || p.qtyRejected > 0 || Boolean(p.rejectReason) || p.condition === 'damaged';
}

/**
 * The Delivery Check's line outbox (lib/pwa/lineOutbox) bound to
 * receiving.markGrLine: saved on change, kept on the phone while offline,
 * retried on `online` and every 15 s. Storage is per user + PO.
 */
export function useLineSaves(
  storageKey: string,
  send: (p: GrLinePayload) => Promise<unknown>,
): { outbox: LineOutbox; states: Record<string, LineSaveState>; pending: number } {
  const sendRef = useRef(send);
  sendRef.current = send;
  const [states, setStates] = useState<Record<string, LineSaveState>>({});
  const [pending, setPending] = useState(0);
  const boxRef = useRef<LineOutbox | null>(null);
  if (!boxRef.current) {
    const box: LineOutbox = createLineOutbox({
      send: (p) => sendRef.current(p),
      isNetworkError,
      storage: typeof window === 'undefined' ? undefined : localStorageOutbox(storageKey),
      onChange: (s) => {
        setStates(s);
        setPending(box.pendingCount());
      },
    });
    boxRef.current = box;
  }
  const outbox = boxRef.current;

  useEffect(() => {
    setPending(outbox.pendingCount());
    setStates(outbox.states());
    const retry = () => {
      if (navigator.onLine && outbox.pendingCount() > 0) void outbox.retry();
    };
    retry();
    window.addEventListener('online', retry);
    const id = window.setInterval(retry, RETRY_EVERY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(id);
    };
  }, [outbox]);

  return { outbox, states, pending };
}

/** What the wizard remembers per PO on this device so a reload resumes (grId, the invoice being read). */
export interface ReceiptDraft {
  grId: string;
  invoiceId: string | null;
  savedAt: number;
}

export function readDraft(key: string): ReceiptDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    const d = raw ? (JSON.parse(raw) as Partial<ReceiptDraft>) : null;
    return d && typeof d.grId === 'string' ? { grId: d.grId, invoiceId: d.invoiceId ?? null, savedAt: d.savedAt ?? 0 } : null;
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
      } else {
        guardPushed.current = false;
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
      const offset = top < window.innerHeight ? `${Math.round(window.innerHeight - top)}px` : 'var(--consent-h, 0px)';
      root.style.setProperty('--rm-field-bar-bottom', offset);
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
