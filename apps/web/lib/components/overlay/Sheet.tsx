'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';

export type SheetDetent = 'half' | 'full';

/**
 * Modal bottom sheet (lens-mobile-field §3.8). A native `<dialog>` opened with
 * showModal(): focus is trapped inside, Esc closes, focus returns to the
 * trigger, the scrim is `::backdrop`. Detents 50 % / 92 % with a grabber (tap
 * to toggle, drag down to shrink or close, drag up to expand). The primary
 * action is pinned at the bottom (56 px). Replaces `window.confirm` and inline
 * expansions on phones; on wide screens it is a centred, bottom-anchored panel.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  primary,
  detent: initialDetent = 'half',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Pinned footer action(s) — usually one `<Button size="xl">`. */
  primary?: React.ReactNode;
  detent?: SheetDetent;
  className?: string;
}) {
  const t = useT(components);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const [detent, setDetent] = useState<SheetDetent>(initialDetent);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (open && !d.open) {
      setDetent(initialDetent);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, initialDetent]);

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerUp(e: React.PointerEvent) {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) < 8) return setDetent((d) => (d === 'half' ? 'full' : 'half')); // a tap toggles
    if (dy > 80) return detent === 'full' ? setDetent('half') : onClose();
    if (dy < -60) setDetent('full');
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal="true"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      data-detent={detent}
      className={cn(
        'rm-sheet fixed inset-x-0 bottom-0 top-auto z-sheet m-0 mx-auto w-full max-w-xl flex-col rounded-t-overlay border border-b-0 border-line bg-surface p-0 text-ink shadow-e3 open:flex',
        'transition-[height] duration-long ease-standard',
        detent === 'full' ? 'h-[92dvh]' : 'h-[50dvh]',
        className,
      )}
    >
      {open ? (
        <>
          <div className="relative flex shrink-0 items-start gap-2 px-4 pb-2 pt-1">
            <button
              type="button"
              aria-label={t('ds.sheet.resize')}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') setDetent('full');
                if (e.key === 'ArrowDown') setDetent('half');
              }}
              className="absolute inset-x-0 top-0 mx-auto flex h-12 w-24 touch-none items-start justify-center pt-2"
            >
              <span aria-hidden="true" className="h-1 w-8 rounded-pill bg-line-strong" />
            </button>
            <div className="min-w-0 flex-1 pt-8">
              <h2 id={titleId} className="text-heading-sm text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-body-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('ds.sheet.close')}
              className="relative mt-5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          {primary ? (
            <div className="shrink-0 border-t border-line bg-surface px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              {primary}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
