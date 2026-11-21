'use client';

import { useEffect, useState } from 'react';
import { Check, Delete, Minus, Plus } from 'lucide-react';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { Button } from '../Button';
import { cnMerge as cn } from '../cn';
import { StatusDot } from '../feedback/StatusChip';
import { keypadDotText, parseKeypadDot, typeKeypadKey, type KeypadKey } from '../form/parse';
import { Sheet } from './Sheet';

/** The pad's own keys, in its own order. A tapped key is looked up here, never read back from the page. */
const KEYS: readonly KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

/** What the pad holds while it is open: the typed text, whether the next key replaces it, the "פגום" chip. */
export interface QtyPadState {
  text: string;
  /** The value shown came from outside (opening, a chip, a step): the next key replaces it, ⌫ clears it. */
  first: boolean;
  damaged: boolean;
}

/**
 * Is a counted quantity far from the order? Beyond `threshold` percent either way. Missing (0) and
 * nothing typed are never "far": they say so themselves.
 */
export function qtyFar(value: number | null, ordered: number | undefined, threshold: number): { far: boolean; pct: number } {
  if (value === null || value === 0 || ordered === undefined || !(ordered > 0)) return { far: false, pct: 0 };
  const share = Math.abs(value - ordered) / ordered;
  return { far: share * 100 > threshold + 1e-9, pct: Math.round(share * 100) };
}

const STEP_BTN =
  'grid size-16 place-items-center rounded-card bg-surface text-fg ring-[1.5px] ring-inset ring-line-strong transition-transform duration-micro ease-standard active:scale-[.96] disabled:text-fg-tertiary motion-reduce:transform-none max-[360px]:size-[3.25rem] forced-colors:border forced-colors:border-[color:ButtonText]';
const CHIP =
  'inline-flex h-12 items-center gap-1.5 rounded-chip px-[1.125rem] text-base font-medium text-fg ring-[1.5px] ring-inset ring-line-strong transition-transform duration-micro ease-standard active:scale-[.98] motion-reduce:transform-none aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:active:scale-100 forced-colors:border forced-colors:border-[color:ButtonText]';
const KEY =
  'num grid h-16 place-items-center rounded-card bg-surface-sunken text-2xl font-medium text-fg ring-1 ring-inset ring-line-strong transition-transform duration-micro ease-standard active:scale-[.96] active:bg-surface-hover disabled:cursor-default disabled:opacity-35 disabled:active:scale-100 motion-reduce:transform-none forced-colors:border forced-colors:border-[color:ButtonText]';

/**
 * The number pad of the clean finish (SPEC §5 "Number pad key", §10.3 the quantity sheet; the
 * reference's `.stepper`, `.quick`, `.keys`): a −/+ stepper around the value, the quick choices
 * "חסר · פגום · כמו בהזמנה", a plain note when the count is far from the order, and 64 px keys with
 * a decimal point and ⌫ on 12 px corners. Controlled: the sheet (or a screen's own frame) owns the
 * state and the confirm button. No ₪ here: it counts goods.
 */
export function QtyPad({
  state,
  onChange,
  unit,
  ordered,
  step,
  whole = false,
  threshold = 3,
  quick = true,
  className,
}: {
  state: QtyPadState;
  onChange: (next: QtyPadState) => void;
  unit?: string;
  ordered?: number;
  /** The −/+ step; by default 1 for whole units, else 0.5 (the reference's kilograms). */
  step?: number;
  /** Counted in whole units: no decimal point. */
  whole?: boolean;
  /** Percent from the order beyond which the note says so (pass the restaurant's tolerance). */
  threshold?: number;
  /** Show "חסר · פגום · כמו בהזמנה". */
  quick?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  // The page's direction (ar is rtl although its base locale is en): the unit sits beside the figure as the sheet reads.
  const dir = useDir();
  const t = useT(components);
  const { text, first, damaged } = state;
  const value = parseKeypadDot(text);
  const by = step ?? (whole ? 1 : 0.5);
  const hurt = damaged && value !== 0;
  const { far, pct } = qtyFar(value, ordered, threshold);
  const orderedText = ordered !== undefined ? `${keypadDotText(ordered)}${unit ? ` ${unit}` : ''}` : '';
  const empty = text === '';

  const press = (k: KeypadKey) => onChange({ ...state, text: typeKeypadKey(text, first, k, whole), first: false });
  const nudge = (dir: 1 | -1) => {
    if (dir === -1 && value === null) return;
    onChange({ ...state, text: keypadDotText(Math.max(0, (value ?? 0) + dir * by)), first: true });
  };

  return (
    <div className={cn('flex flex-col', className)} data-qty-pad="">
      {/* The live region is always there, so a note that appears is announced (one that arrives already filled is
          not); empty, it takes no room. The note sits above the stepper: the pad is bottom-aligned, so it grows upward
          and no key moves under the thumb. */}
      <div role="status" aria-atomic="true" data-qty-note="">
      {far ? (
        <p className="mb-3 flex items-start gap-2 rounded-card bg-warn-subtle px-3 py-2.5 text-body-sm text-fg ring-1 ring-inset ring-warn-dot-ring">
          <StatusDot tone="warn" className="mt-1.5" />
          <span>
            {pct > 100 ? t('ds.keypad.farDouble', { qty: orderedText }) : t('ds.keypad.farPct', { pct: formatPercent(pct / 100, locale, 0), qty: orderedText })}
          </span>
        </p>
      ) : null}
      </div>

      <div className="grid grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-2.5 [direction:ltr] max-[360px]:grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] max-[360px]:gap-1">
        <button type="button" onClick={() => nudge(-1)} disabled={value === null} aria-label={t('ds.quantity.decrease')} className={STEP_BTN}>
          <Minus className="size-6" aria-hidden="true" />
        </button>
        <div dir={dir} aria-live="polite" className="flex min-w-0 items-baseline justify-center gap-1.5" data-qty-value="">
          <span
            data-selected={first && !empty ? '' : undefined}
            className={cn(
              'num rounded-control px-2 font-normal tracking-[-0.02em]',
              text.length > 5 ? 'text-[2rem] leading-10' : 'text-[3rem] leading-[3.75rem] max-[360px]:text-[2.375rem] max-[360px]:leading-[3rem]',
              empty ? 'text-fg-tertiary' : 'text-fg',
              first && !empty && 'bg-info-subtle ring-[1.5px] ring-inset ring-info forced-colors:outline forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[color:Highlight]',
            )}
          >
            {empty ? '—' : text}
          </span>
          {unit ? <small className="text-lg text-fg-secondary">{unit}</small> : null}
        </div>
        <button type="button" onClick={() => nudge(1)} aria-label={t('ds.quantity.increase')} className={STEP_BTN}>
          <Plus className="size-6" aria-hidden="true" />
        </button>
      </div>

      {quick ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onChange({ text: '0', first: true, damaged: false })} className={CHIP}>
            {t('ds.keypad.missing')}
          </button>
          <button
            type="button"
            aria-pressed={hurt}
            // Nothing arrived on a missing line, so nothing can be damaged: the chip waits for a count.
            aria-disabled={value === 0 || undefined}
            onClick={() => {
              if (value === 0) return;
              onChange({ ...state, damaged: !hurt });
            }}
            className={cn(CHIP, hurt && 'bg-fg text-on-bold ring-0')}
          >
            {hurt ? <Check className="size-4" strokeWidth={2.25} aria-hidden="true" /> : null}
            {t('ds.keypad.damaged')}
          </button>
          {ordered !== undefined ? (
            <button type="button" onClick={() => onChange({ ...state, text: keypadDotText(ordered), first: true })} className={CHIP}>
              {t('ds.keypad.asOrdered')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-1.5 [direction:ltr]" data-qty-keys="">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={k === '.' && whole}
            aria-label={k === 'del' ? t('ds.keypad.backspace') : k === '.' ? t('ds.keypad.decimal') : undefined}
            className={KEY}
          >
            {k === 'del' ? <Delete className="size-6" aria-hidden="true" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A quantity number pad in a bottom sheet, for receiving (SPEC §10.3): "כמה הגיע?", the item and what was
 * ordered, the pad, and one button that states the result ("אישור: 24 ק״ג", "אישור: חסר"). Opening on a
 * value shows it selected, so the first key replaces it. Far from the order, a plain note says so
 * (no second tap). `onConfirm` receives the quantity (0 = missing) and whether "פגום" is on.
 */
export function QtyKeypad({
  open,
  onClose,
  onConfirm,
  title,
  name,
  unit,
  ordered,
  initial,
  damaged = false,
  step,
  whole,
  threshold = 3,
  quick = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: number, meta: { damaged: boolean }) => void;
  /** Defaults to "כמה הגיע?". */
  title?: React.ReactNode;
  /** The item's name, for the line under the title ("עגבניות שרי, הוזמן 6.5 ק״ג"). */
  name?: string;
  unit?: string;
  ordered?: number;
  initial?: number | null;
  /** The "פגום" chip on opening. */
  damaged?: boolean;
  step?: number;
  whole?: boolean;
  /** Percent from the order beyond which the note says so (the restaurant's tolerance). */
  threshold?: number;
  quick?: boolean;
}) {
  const t = useT(components);
  const [state, setState] = useState<QtyPadState>({ text: '', first: false, damaged });

  useEffect(() => {
    if (open) setState({ text: initial == null ? '' : keypadDotText(initial), first: initial != null, damaged });
  }, [open, initial, damaged]);

  const value = parseKeypadDot(state.text);
  const hurt = state.damaged && value !== 0;
  const qtyText = value !== null ? `${keypadDotText(value)}${unit ? ` ${unit}` : ''}` : '';
  const orderedText = ordered !== undefined ? `${keypadDotText(ordered)}${unit ? ` ${unit}` : ''}` : '';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? t('ds.keypad.title')}
      description={
        ordered === undefined ? undefined : name ? t('ds.keypad.itemOrdered', { name, qty: orderedText }) : t('ds.keypad.ordered', { qty: orderedText })
      }
      detent="full"
      primary={
        <Button size="xl" className="w-full rounded-card" onClick={() => value !== null && onConfirm(value, { damaged: hurt })} disabled={value === null}>
          {value === null ? t('ds.keypad.confirmEmpty') : value === 0 ? t('ds.keypad.confirmMissing') : t('ds.keypad.confirmQty', { qty: qtyText })}
        </Button>
      }
    >
      <div className="flex min-h-full flex-col justify-end">
        <QtyPad state={state} onChange={setState} unit={unit} ordered={ordered} step={step} whole={whole} threshold={threshold} quick={quick} />
      </div>
    </Sheet>
  );
}
