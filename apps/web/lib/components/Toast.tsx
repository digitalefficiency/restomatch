'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, XCircle } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from './cn';
import { AnnouncerProvider, useAnnounce } from './feedback/LiveRegion';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastOptions {
  /** One action (Undo…). A toast with an action stays at least 10 s. */
  action?: ToastAction;
  /** Override the timeout in ms (never below the R-6 floors). */
  duration?: number;
}
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  duration: number;
}
export interface ToastApi {
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const noop: ToastApi = { success: () => {}, error: () => {}, info: () => {}, dismiss: () => {} };
const ToastContext = createContext<ToastApi>(noop);
// Cast wrapper: two @types/react majors are hoisted in the workspace (STATE.md).
const ToastCtxProvider = ToastContext.Provider as unknown as React.ComponentType<{
  value: ToastApi;
  children?: React.ReactNode;
}>;

/** R-6 timings: 5 s plain, ≥10 s with an action, errors persist until dismissed. */
export const TOAST_MS = { plain: 5000, action: 10000 } as const;
export const TOAST_MAX = 3;

export function toastDuration(kind: ToastKind, opts: ToastOptions = {}): number {
  if (kind === 'error') return Number.POSITIVE_INFINITY;
  const floor = opts.action ? TOAST_MS.action : TOAST_MS.plain;
  return Math.max(floor, opts.duration ?? 0);
}

/**
 * App-wide toasts (v2). `useToast()` anywhere below the provider:
 * `success`/`info`/`error`, each with an optional action. Errors persist; every
 * timer pauses while the toast is hovered or focused; at most 3 stack. Messages
 * are announced through persistent live regions (polite; assertive for errors),
 * and `useAnnounce()` is available below this provider too. The stack sits at
 * the inline-start bottom, above the bottom nav, the consent bar and the safe area.
 * DS3 (kit "הודעה עם ביטול"): the dark toast, white words and focus ring, the
 * action ("ביטול") beside the message, and a line that shows the time left.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <AnnouncerProvider>
      <ToastStack>{children}</ToastStack>
    </AnnouncerProvider>
  );
}

function ToastStack({ children }: { children: React.ReactNode }) {
  const t = useT(components);
  const announce = useAnnounce();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-(TOAST_MAX - 1)), { id, kind, message, action: opts.action, duration: toastDuration(kind, opts) }]);
      announce(message, kind === 'error' ? 'assertive' : 'polite');
    },
    [announce],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastCtxProvider value={api}>
      {children}
      <section
        aria-label={t('toast.region')}
        className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--rm-bottomnav-h,0px)+var(--consent-h,0px)+env(safe-area-inset-bottom)+1rem)] z-snackbar flex flex-col items-stretch gap-2 sm:inset-x-auto sm:start-6 sm:w-96"
      >
        {items.map((it) => (
          <ToastCard key={it.id} item={it} onDismiss={() => dismiss(it.id)} dismissLabel={t('toast.dismiss')} />
        ))}
      </section>
    </ToastCtxProvider>
  );
}

function ToastCard({ item, onDismiss, dismissLabel }: { item: ToastItem; onDismiss: () => void; dismissLabel: string }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const lineRef = useRef<HTMLElement>(null);
  const line = useRef<Animation | null>(null);
  const [lineOn, setLineOn] = useState(false);
  // DS3 (SPEC §8): the time left to undo is visible — a thin line that shortens over the toast's
  // real duration and pauses with its timer. Only for a toast with an action; an enhancement where
  // the Web Animations API exists; off under reduced motion (everything appears in place).
  const timed = Boolean(item.action) && Number.isFinite(item.duration);

  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return;
    const started = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onDismiss]);

  useEffect(() => {
    const el = lineRef.current;
    if (!timed || !el || typeof el.animate !== 'function') return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: item.duration,
      easing: 'linear',
      fill: 'forwards',
    });
    line.current = anim;
    setLineOn(true);
    return () => {
      anim.cancel();
      line.current = null;
    };
  }, [timed, item.duration]);

  useEffect(() => {
    const anim = line.current;
    if (!anim) return;
    if (paused) anim.pause();
    else anim.play();
  }, [paused]);

  return (
    <div
      data-toast={item.kind}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      className="pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden rounded-card bg-fg px-3.5 py-2.5 text-body-sm text-on-bold shadow-e2 motion-safe:animate-[rm-toast-in_var(--dur-medium)_var(--ease-enter)]"
    >
      {item.kind === 'error' ? <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <p className="min-w-0 flex-1">{item.message}</p>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick();
            onDismiss();
          }}
          className="inline-flex min-h-7 shrink-0 items-center rounded-control px-1 font-medium text-on-bold underline-offset-2 transition-colors duration-micro ease-standard hover:underline focus-visible:outline-on-bold [@media(pointer:coarse)]:min-h-11"
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="-m-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-on-bold transition-colors duration-micro ease-standard hover:bg-on-bold/15 focus-visible:outline-on-bold [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {timed ? (
        <i
          ref={lineRef}
          aria-hidden="true"
          data-toast-timer=""
          hidden={!lineOn}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-on-bold/60 ltr:origin-left rtl:origin-right"
        />
      ) : null}
    </div>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export { useAnnounce };
