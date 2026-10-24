'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from './cn';

type ToastKind = 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const noop: ToastApi = { success: () => {}, error: () => {} };
const ToastContext = createContext<ToastApi>(noop);
// Cast wrapper: two @types/react majors are hoisted in the workspace (STATE.md).
const ToastCtxProvider = ToastContext.Provider as unknown as React.ComponentType<{
  value: ToastApi;
  children?: React.ReactNode;
}>;

const DURATION_MS = { success: 3500, error: 7000 } as const;

/**
 * App-wide success/failure toasts. Mounted once in the dashboard layout;
 * `useToast()` anywhere below it. Announced through an aria-live region
 * (polite for success, assertive for failures). Anchored to the inline-end
 * bottom corner so it sits correctly in both RTL and LTR.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useT(components);
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), DURATION_MS[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m) }),
    [push],
  );

  return (
    <ToastCtxProvider value={api}>
      {children}
      <div
        role="region"
        aria-label={t('toast.region')}
        className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-6 sm:end-6 sm:w-96 md:bottom-6"
      >
        {items.map((it) => (
          <div
            key={it.id}
            role={it.kind === 'error' ? 'alert' : 'status'}
            aria-live={it.kind === 'error' ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur',
              it.kind === 'success'
                ? 'border-primary/30 bg-surface/95 text-ink'
                : 'border-danger/40 bg-surface/95 text-ink',
            )}
          >
            {it.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1">{it.message}</p>
            <button
              type="button"
              onClick={() => dismiss(it.id)}
              aria-label={t('toast.dismiss')}
              className="rounded text-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtxProvider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
