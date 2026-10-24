'use client';

import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';

/**
 * The app's confirm step for destructive actions — a native modal <dialog>
 * (like the promo film's) instead of window.confirm(): it speaks the user's
 * language, follows the light tokens, and showModal() keeps focus inside and
 * returns it to the trigger on close. Esc / backdrop click / the keep button
 * all call onClose; only the confirm button calls onConfirm. The keep button
 * takes initial focus so a stray Enter never destroys anything. `!m-auto`:
 * a parent's space-y-* margins would otherwise pin the modal to the top.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel: React.ReactNode;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="!m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/50"
    >
      {open && (
        <div className="space-y-3 p-5">
          <h2 id={titleId} className="text-base font-bold text-ink">
            {title}
          </h2>
          {body ? (
            <div id={bodyId} className="space-y-2 text-sm text-muted">
              {body}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" autoFocus onClick={onClose} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              size="sm"
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
