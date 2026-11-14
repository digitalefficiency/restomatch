'use client';

import { useId } from 'react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';

/**
 * The switch (DS3 SPEC §5 `.sw`): a 44 px track with a white knob, brand when on, the control
 * colour when off, and the state written beside it ("פעיל" / "כבוי", decorative). The WHOLE row is
 * the click target: the row is the switch's <label>, so a click anywhere on it toggles once and
 * the label names the control. `role="switch"` + `aria-checked`; a hint is linked by
 * `aria-describedby`. A disabled switch keeps its contrast (no opacity) and says why in the hint.
 * It saves nothing itself: whether a change applies at once is the screen's decision.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled = false,
  id: idProp,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const t = useT(components);
  const auto = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const id = idProp ?? `sw-${auto}`;
  return (
    <label
      htmlFor={id}
      data-switch=""
      className={cn(
        'flex min-h-11 items-center justify-between gap-6 py-1',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-body-sm font-medium text-fg">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="block text-caption text-fg-secondary">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-2">
        <span aria-hidden="true" className={cn('text-caption', disabled ? 'text-fg-tertiary' : 'text-fg-secondary')}>
          {checked ? t('ds.switch.on') : t('ds.switch.off')}
        </span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className={cn(
            'inline-flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-short ease-standard',
            disabled ? 'bg-line' : checked ? 'bg-action hover:bg-action-hover' : 'bg-line-strong',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-5 rounded-full bg-surface shadow-e1 transition-transform duration-short ease-standard',
              checked && 'ltr:translate-x-5 rtl:-translate-x-5',
            )}
          />
        </button>
      </span>
    </label>
  );
}
