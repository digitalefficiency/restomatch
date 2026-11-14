'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/components';
import { NUM_ALIGN } from '@/lib/components/money/format';

/**
 * The two settings controls the shared kit does not have yet (reference
 * `.sw`, `.numf`). Promote to shared (DS3-01 slice 2: "the field, switch and
 * number field with steppers").
 */

/** On/off switch: a 44 × 24 track (44 × 64 on a touch screen); the whole row may also toggle it (the caller wires that). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name (the visible state word sits next to it). */
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-short',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-60',
        '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-16',
        checked ? 'justify-end bg-primary' : 'justify-start bg-line-strong',
      )}
    >
      <span aria-hidden="true" className="block aspect-square h-full rounded-pill bg-surface shadow-e1" />
    </button>
  );
}

/**
 * A number with − / + steppers around a typed field (inputMode decimal, never
 * type=number: "7,5" must work). The steppers clamp to the limits; typing is
 * validated by the caller, which says the limits when a value is out of range.
 * 36 px at the desk, 44 px touch targets on a phone.
 */
export function NumberStepper({
  id,
  value,
  onChange,
  onStep,
  canDecrease,
  canIncrease,
  unit,
  label,
  lessLabel,
  moreLabel,
  disabled,
  invalid,
  describedBy,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (raw: string) => void;
  onStep: (direction: 1 | -1) => void;
  canDecrease: boolean;
  canIncrease: boolean;
  unit: '%' | '₪' | '';
  label: string;
  lessLabel: string;
  moreLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const btn = cn(
    'inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-micro',
    'hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
    '[@media(pointer:coarse)]:size-11',
  );
  return (
    <div
      dir="ltr"
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex items-center rounded-control bg-surface ring-1 ring-inset',
        invalid ? 'ring-danger' : 'ring-line-strong',
        disabled && 'opacity-70',
      )}
    >
      <button type="button" className={btn} onClick={() => onStep(-1)} disabled={disabled || !canDecrease} aria-label={lessLabel}>
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="relative flex items-center">
        {unit === '₪' ? (
          <span aria-hidden="true" className="pointer-events-none absolute start-1 text-caption text-subtle">
            ₪
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          dir="ltr"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && canIncrease) {
              e.preventDefault();
              onStep(1);
            } else if (e.key === 'ArrowDown' && canDecrease) {
              e.preventDefault();
              onStep(-1);
            }
          }}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-9 w-20 bg-transparent px-4 text-body-sm font-medium tabular-nums text-ink outline-none',
            'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
            '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-body',
            NUM_ALIGN,
          )}
        />
        {unit === '%' ? (
          <span aria-hidden="true" className="pointer-events-none absolute end-1 text-caption text-subtle">
            %
          </span>
        ) : null}
      </div>
      <button type="button" className={btn} onClick={() => onStep(1)} disabled={disabled || !canIncrease} aria-label={moreLabel}>
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
