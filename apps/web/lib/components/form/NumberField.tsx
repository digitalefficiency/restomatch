'use client';

import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { parseQuantityInput } from './parse';

/**
 * The number field with steppers (DS3 SPEC §5 `.numf`): ONE frame holding "less", the value and
 * "more"; 36 px at the desk, 44 px on coarse pointers. It holds its limits and says them: the
 * steppers stop at the limits, a typed value is brought back inside them on blur, and the limits
 * are written under the field and linked to it ("בין 0 ל־20"). Typing accepts a decimal comma or
 * point, like every number field of the product (form/parse). The value posts as a number.
 */
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  decimals = 0,
  unit,
  label,
  id: idProp,
  disabled = false,
  showLimits = true,
  className,
  'aria-describedby': describedBy,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Decimals a typed value keeps. */
  decimals?: number;
  /** The unit after the value ("%", "יח׳"). */
  unit?: string;
  /** Accessible name when no <Field> labels it. */
  label?: string;
  id?: string;
  disabled?: boolean;
  /** Write the limits under the field (default). Turn off only where the screen states them. */
  showLimits?: boolean;
  className?: string;
  'aria-describedby'?: string;
}) {
  const t = useT(components);
  const locale = useLocale();
  const auto = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const id = idProp ?? `nf-${auto}`;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const shown = (n: number) => formatNumber(n, locale, { maximumFractionDigits: decimals, useGrouping: false });
  const [text, setText] = useState(shown(value));
  useEffect(() => setText(shown(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (n: number) => {
    const next = clamp(Math.round(n * 10 ** decimals) / 10 ** decimals);
    setText(shown(next));
    if (next !== value) onValueChange(next);
  };
  const limitsId = `${id}-limits`;
  const described = [describedBy, showLimits ? limitsId : null].filter(Boolean).join(' ') || undefined;
  const stepBtn =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center text-fg-secondary transition-colors duration-micro ease-standard hover:bg-surface-sunken hover:text-fg disabled:cursor-not-allowed disabled:text-fg-tertiary disabled:hover:bg-transparent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)} data-number-field="">
      <span
        role="group"
        aria-label={label}
        className="inline-flex items-stretch overflow-hidden rounded-control border border-line-strong bg-surface [direction:ltr]"
      >
        <button
          type="button"
          className={stepBtn}
          onClick={() => commit(value - step)}
          disabled={disabled || value <= min}
          aria-label={t('ds.quantity.decrease')}
          aria-controls={id}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="inline-flex min-w-16 items-center justify-center gap-1 border-x border-line px-2">
          <input
            id={id}
            type="text"
            inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            autoComplete="off"
            value={text}
            disabled={disabled}
            aria-describedby={described}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const n = parseQuantityInput(text, decimals);
              if (n === null) setText(shown(value));
              else commit(n);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                commit(value + step);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                commit(value - step);
              } else if (e.key === 'Enter') {
                const n = parseQuantityInput(text, decimals);
                if (n !== null) commit(n);
              }
            }}
            className="num w-12 bg-transparent text-center text-body-sm font-medium text-fg outline-none [@media(pointer:coarse)]:text-body"
          />
          {unit ? (
            <span aria-hidden="true" className="text-caption text-fg-secondary">
              {unit}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className={stepBtn}
          onClick={() => commit(value + step)}
          disabled={disabled || value >= max}
          aria-label={t('ds.quantity.increase')}
          aria-controls={id}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
      {showLimits ? (
        <span id={limitsId} className="text-caption text-fg-secondary">
          {t('ds.numberField.limits', { min: shown(min), max: shown(max) })}
        </span>
      ) : null}
    </span>
  );
}
