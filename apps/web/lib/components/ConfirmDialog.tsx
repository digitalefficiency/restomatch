'use client';

import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import { Money } from './money/Money';

/**
 * The app's confirm step for destructive actions — a native modal <dialog>
 * (like the promo film's) instead of window.confirm(): it speaks the user's
 * language, follows the light tokens, and showModal() keeps focus inside and
 * returns it to the trigger on close. Esc / backdrop click / the keep button
 * all call onClose; only the confirm button calls onConfirm. The keep button
 * takes initial focus so a stray Enter never destroys anything. `!m-auto`:
 * a parent's space-y-* margins would otherwise pin the modal to the top.
 *
 * Money or data deletions name what is at stake (C10, R-8): pass `amount`
 * (shekels) and `party` and the dialog shows "‏1,240.00 ₪ · תנובה" above the
 * buttons; the confirm label should name them too ("מחק ₪1,240 מהדרישה לתנובה").
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  loading = false,
  amount,
  party,
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
  /** The ₪ at stake (shekels), shown with 2 dp. */
  amount?: number;
  /** Who it concerns (supplier, branch, person). */
  party?: React.ReactNode;
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
      aria-describedby={body || amount !== undefined || party ? bodyId : undefined}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="rm-dialog !m-auto w-[min(92vw,28rem)] rounded-overlay border border-line bg-surface p-0 text-ink shadow-e3"
    >
      {open && (
        <div className="space-y-3 p-5">
          <h2 id={titleId} className="text-base font-bold text-ink">
            {title}
          </h2>
          {body || amount !== undefined || party ? (
            <div id={bodyId} className="space-y-2 text-sm text-muted">
              {amount !== undefined || party ? (
                <p data-confirm-stake className="flex flex-wrap items-baseline gap-x-2 text-body font-semibold text-ink">
                  {amount !== undefined ? <Money value={amount} context="line" /> : null}
                  {amount !== undefined && party ? <span aria-hidden="true">·</span> : null}
                  {party ? <span>{party}</span> : null}
                </p>
              ) : null}
              {body}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="secondary" autoFocus onClick={onClose} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
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
