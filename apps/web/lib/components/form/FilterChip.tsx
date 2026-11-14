'use client';

import { ChevronDown, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';

/**
 * A filter pill ("ספק: הכל ▾"): 32 px on desk, 44 on touch, white with the control border (DS3 kit
 * "לשוניות ומסננים": brand green is kept for the one primary action). Active = the label set
 * heavier, an optional quiet count and a × that clears it, so an active filter stays on screen as
 * a removable chip. The chip itself is the popover trigger (`expanded`).
 */
export function FilterChip({
  label,
  active = false,
  count,
  expanded,
  onClick,
  onRemove,
  className,
}: {
  label: string;
  active?: boolean;
  count?: number;
  expanded?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  const t = useT(components);
  return (
    <span
      data-active={active || undefined}
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-pill border border-line-strong bg-surface text-body-sm text-fg',
        active ? 'font-medium' : 'font-normal',
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        className="inline-flex min-h-8 items-center gap-1.5 px-3 transition-colors duration-micro ease-standard hover:bg-surface-sunken [@media(pointer:coarse)]:min-h-11"
      >
        {label}
        {typeof count === 'number' && count > 0 ? <span className="num text-fg-tertiary">{count}</span> : null}
        <ChevronDown className="h-3.5 w-3.5 text-fg-secondary" aria-hidden="true" />
      </button>
      {active && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('ds.filterChip.remove', { label })}
          className="inline-flex min-h-8 items-center px-2 text-fg-secondary transition-colors duration-micro ease-standard hover:bg-surface-sunken hover:text-fg [@media(pointer:coarse)]:min-h-11"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
