'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/lib/components';
import { parsePositive, parsePriceInput } from './order-logic';

/**
 * Quantity / price as text with the decimal keypad (never `type="number"`: it
 * swallows "7," and scroll-wheels values). The text the user types is kept while
 * focused; the parsed number goes up on every keystroke. Selects on focus so a
 * tap replaces the old value.
 */
export function DecimalInput({
  value,
  kind,
  onValue,
  className,
  ...rest
}: {
  value: number | undefined;
  kind: 'qty' | 'price';
  /** qty: the number, or 0 when blank/invalid (the line then reads invalid); price: number or undefined. */
  onValue: (v: number | undefined) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const show = (v: number | undefined) => (v == null || !Number.isFinite(v) || (kind === 'qty' && v === 0) ? '' : String(v));
  const [text, setText] = useState(() => show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const bad = kind === 'qty' ? parsePositive(text) == null : parsePriceInput(text) === 'invalid';
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      enterKeyHint="next"
      autoComplete="off"
      value={text}
      aria-invalid={bad || undefined}
      className={className}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(show(value));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (kind === 'qty') onValue(parsePositive(raw) ?? 0);
        else {
          const p = parsePriceInput(raw);
          if (p !== 'invalid') onValue(p ?? undefined);
        }
      }}
    />
  );
}
