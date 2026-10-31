'use client';

import { ChevronDown, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';

/**
 * A filter pill ("ספק: הכל ▾"): 32 px on desk, 44 on touch. Active =
 * `primary-subtle` + optional count + a separate × that clears it. The chip
 * itself is the popover trigger (`expanded`).
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
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-pill border text-body-sm font-semibold',
        active ? 'border-primary-subtle bg-primary-subtle text-primary' : 'border-line-strong bg-surface text-ink',
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        className="inline-flex min-h-8 items-center gap-1.5 px-3 transition-colors duration-micro hover:bg-surface-2/60 [@media(pointer:coarse)]:min-h-11"
      >
        {label}
        {typeof count === 'number' && count > 0 ? <span className="num rounded-pill bg-surface px-1.5 text-caption">{count}</span> : null}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {active && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('ds.filterChip.remove', { label })}
          className="inline-flex min-h-8 items-center border-s border-primary-subtle px-2 transition-colors duration-micro hover:bg-primary-subtle-hover [@media(pointer:coarse)]:min-h-11"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
