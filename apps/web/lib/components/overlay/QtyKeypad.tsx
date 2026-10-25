'use client';

import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { Button } from '../Button';
import { cn } from '../cn';
import { parseQuantityInput } from '../form/parse';
import { Sheet } from './Sheet';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'] as const;

/**
 * A quantity keypad in a sheet, for weighed units (ק״ג, ליטר): a 3×4 grid of
 * 64 px keys with "," and ⌫, the unit, a reference line ("הוזמן 12 ק״ג") and a
 * live variance. Over `threshold` % it asks a second time before confirming.
 */
export function QtyKeypad({
  open,
  onClose,
  onConfirm,
  title,
  unit,
  ordered,
  initial,
  threshold = 10,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: number) => void;
  title: React.ReactNode;
  unit?: string;
  ordered?: number;
  initial?: number | null;
  /** Variance (%) above which confirming needs a second tap. */
  threshold?: number;
}) {
  const locale = useLocale();
  const t = useT(components);
  const [text, setText] = useState('');
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (open) {
      setText(initial == null ? '' : String(initial).replace('.', ','));
      setArmed(false);
    }
  }, [open, initial]);

  const value = parseQuantityInput(text);
  const variance = value !== null && ordered ? (value - ordered) / ordered : null;
  const over = variance !== null && Math.abs(variance) * 100 > threshold;

  function press(k: (typeof KEYS)[number]) {
    setArmed(false);
    if (k === 'back') return setText((s) => s.slice(0, -1));
    if (k === ',' && text.includes(',')) return;
    setText((s) => (s === '0' && k !== ',' ? k : s + k));
  }

  function confirm() {
    if (value === null) return;
    if (over && !armed) return setArmed(true);
    onConfirm(value);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      detent="full"
      primary={
        <Button size="xl" onClick={confirm} disabled={value === null} variant={armed ? 'danger' : 'primary'}>
          {armed ? t('ds.keypad.confirmAgain', { pct: `${threshold}%` }) : t('ds.keypad.confirm')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div dir="ltr" className="flex items-baseline justify-center gap-2 rounded-card bg-surface-2 px-4 py-3" aria-live="polite">
          <span className="num text-metric-lg text-ink">{text || '0'}</span>
          {unit ? <span className="text-body text-muted">{unit}</span> : null}
        </div>
        {ordered !== undefined ? (
          <p className="flex justify-between text-body-sm text-muted">
            <span>{t('ds.keypad.ordered', { qty: `${formatNumber(ordered, locale)}${unit ? ` ${unit}` : ''}` })}</span>
            {variance !== null ? (
              <span className={cn('num font-semibold', over ? 'text-warn' : 'text-muted')}>
                {t('ds.keypad.variance', {
                  pct: formatNumber(variance, locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
                })}
              </span>
            ) : null}
          </p>
        ) : null}
        <div dir="ltr" className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              aria-label={k === 'back' ? t('ds.keypad.backspace') : undefined}
              className="num inline-flex h-16 items-center justify-center rounded-card border border-line bg-surface text-metric-md text-ink transition-colors duration-micro active:bg-surface-2"
            >
              {k === 'back' ? <Delete className="h-6 w-6" aria-hidden="true" /> : k}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
