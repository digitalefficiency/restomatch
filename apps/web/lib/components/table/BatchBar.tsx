'use client';

import { X } from 'lucide-react';
import { useLocale } from '@/lib/i18n/client';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { deskCopy } from './copy';

export interface BatchBarAction {
  id: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  /** Shown beside the bar while the action is disabled (never a silent grey button). */
  disabledReason?: string;
  onRun: () => void;
}

/**
 * "N נבחרו · ₪Σ · [primary] [clear · Esc]" (RUBRIC C2). It replaces the table
 * toolbar while rows are selected and stays sticky above the rows. The ₪ is
 * Σ|amount| of the selected rows with a known amount. A disabled action always
 * shows its reason (an approve/pay action over the ₪200 cap, an unknown amount,
 * or no server enforcement yet), linked through aria-describedby.
 */
export function BatchBar({
  count,
  sumAgorot,
  notes = [],
  actions,
  onClear,
  className,
}: {
  count: number;
  sumAgorot?: number;
  /** Short status lines under the count (held-back rows, failures). */
  notes?: string[];
  actions: BatchBarAction[];
  onClear: () => void;
  className?: string;
}) {
  const locale = useLocale();
  const copy = deskCopy(locale);
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label={copy.selected(count)}
      data-batchbar=""
      onKeyDown={(e) => {
        // Esc clears from anywhere in the bar too, not only from the rows.
        if (e.key === 'Escape') {
          e.preventDefault();
          onClear();
        }
      }}
      className={cn(
        'sticky top-0 z-[45] flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/40 bg-surface px-3 py-1.5 shadow-card',
        className,
      )}
    >
      <p aria-live="polite" className="text-sm font-semibold text-ink">
        <span data-batch-count>{copy.selected(count)}</span>
        {sumAgorot != null ? (
          <>
            {' · '}
            <bdi data-batch-sum className="tabular-nums lining-nums">
              {formatIls(sumAgorot / 100, { maximumFractionDigits: 2, locale })}
            </bdi>
          </>
        ) : null}
      </p>
      {notes.map((n) => (
        <p key={n} className="text-xs text-warn" data-batch-note="">
          {n}
        </p>
      ))}
      {actions
        .filter((a) => a.disabled && a.disabledReason)
        .map((a) => (
          <p key={a.id} id={`batch-why-${a.id}`} data-batch-why={a.id} className="text-xs font-semibold text-warn">
            {a.disabledReason}
          </p>
        ))}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={a.disabled}
            aria-describedby={a.disabled && a.disabledReason ? `batch-why-${a.id}` : undefined}
            data-batch-action={a.id}
            onClick={a.onRun}
            className={cn(
              'inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info',
              a.primary ? 'bg-primary text-on-primary hover:bg-primary/90' : 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
            )}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
        >
          <X aria-hidden className="h-4 w-4" />
          {copy.clear}
          <kbd className="rounded border border-line px-1 text-xs font-normal">{copy.clearHint}</kbd>
        </button>
      </div>
    </div>
  );
}
