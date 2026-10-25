'use client';

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { Maximize2, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n/client';
import { cn } from '../cn';
import { deskCopy } from '../table/copy';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Quick-look side panel (lens-exec-desktop §3.6, Linear Peek). It slides in
 * from the inline-end edge (the left in Hebrew), 480 px wide (520 at xl).
 * Content renders from data the list already holds, so it opens in one frame.
 * Space or Esc closes it; focus is trapped while open and goes back to the
 * element that opened it (the row). "Open full page" is a real link
 * (Ctrl/⌘+Enter inside the panel follows it).
 */
export function Peek({
  open,
  title,
  onClose,
  fullHref,
  returnFocus,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  fullHref?: string;
  /** Where focus goes on close; defaults to whatever had focus when it opened. */
  returnFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
}) {
  const copy = deskCopy(useLocale());
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const full = useRef<HTMLAnchorElement>(null);
  const titleId = useId();
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useLayoutEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      const target = returnRef.current?.() ?? opener.current;
      target?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-50 bg-ink/10" onMouseDown={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-peek=""
        onKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (e.code === 'Space' && target === panel.current) {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.code === 'Enter' && (e.ctrlKey || e.metaKey) && full.current) {
            e.preventDefault();
            full.current.click();
            return;
          }
          if (e.key !== 'Tab') return;
          const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
          if (items.length === 0) {
            e.preventDefault();
            return;
          }
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        className={cn(
          'fixed inset-y-0 end-0 z-50 flex w-full max-w-[480px] flex-col border-s border-line bg-surface shadow-card outline-none xl:max-w-[520px]',
        )}
      >
        <header className="flex items-start gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-bold text-ink">
            {title}
          </h2>
          {fullHref ? (
            <Link
              ref={full}
              href={fullHref}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-primary hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
            >
              <Maximize2 aria-hidden className="h-4 w-4" />
              {copy.openFull}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </>
  );
}
