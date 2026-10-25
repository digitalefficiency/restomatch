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
  onRun: () => void;
}

/**
 * "N נבחרו · ₪Σ · [primary] [clear · Esc]" (RUBRIC C2). Never an approve or pay
 * action — the owner rejected bulk approval (REVIEW-REPORT §8). It replaces the table
 * toolbar while rows are selected and stays sticky above the rows. The ₪ is
 * Σ|amount| of the rows the actions will touch; rows above the per-item cap
 * are counted but named as held back (R-12).
 */
export function BatchBar({
  count,
  sumAgorot,
  overCapCount = 0,
  capAgorot,
  actions,
  onClear,
  className,
}: {
  count: number;
  sumAgorot?: number;
  overCapCount?: number;
  capAgorot?: number | null;
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
      {overCapCount > 0 && capAgorot != null ? (
        <p className="text-xs text-warn">{copy.overCap(overCapCount, formatIls(capAgorot / 100, { locale }))}</p>
      ) : null}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={a.disabled}
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
