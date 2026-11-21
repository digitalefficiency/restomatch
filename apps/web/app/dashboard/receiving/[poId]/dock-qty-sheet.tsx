'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { Button, Sheet } from '@/lib/components';
import type { ReconciliationLine } from '@/app/showcase/receiver/_mock';
import { DAMAGED_PATCH, MISSING_PATCH, qtyPatch, type LineMark } from '@/app/showcase/receiver/_state';
import { qtyInputText, type QtyTolerance } from '@/app/showcase/receiver/_steps/qtyEntry';
import { useUnitLabel } from '@/app/showcase/receiver/_steps/english';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import { farNote, isHurt } from './_dock';
import { initialPadText, isWhole, padKeyFromKeyboard, padStep, padValue, sanitizeTyped, stepText, typeKey, type PadKey } from './_keypad';
import { DockKeypad } from './dock-keypad';
import { PHONE_CTA } from './_phone';

/**
 * "כמה הגיע?" (SPEC §10.3): the quantity sheet rises from the bottom with the
 * product's own number pad (the same digits and point in all six languages; the
 * phone's own keyboard stays closed), a −/+ stepper for a small correction, the
 * quick choices "חסר" / "פגום" / "כמו בהזמנה", and a plain statement when the
 * number is far from the order, above the field so no key moves under the
 * thumb. Nothing is saved until the button that says what it confirms ("אישור:
 * 24 ק״ג"); closing the sheet saves nothing.
 *
 * The sheet is the shared native modal dialog, rendered INSIDE its row: focus is
 * trapped, Esc closes, and focus returns to the row's control when it closes
 * (SPEC: saving returns focus to the row); the row's scope
 * (data-testid="count-line") holds every control of its sheet.
 *
 * It opens on the count, else on the ordered quantity selected (today), or
 * empty when the restaurant counts blind (`blind`, flag `dockCountFirst`).
 */
export function DockQtySheet({
  open,
  line,
  mark,
  name,
  tolerance,
  blind,
  onSave,
  onClose,
}: {
  open: boolean;
  line: ReconciliationLine;
  mark: LineMark;
  name: string;
  tolerance?: QtyTolerance;
  blind: boolean;
  onSave: (patch: Partial<LineMark>) => void;
  onClose: () => void;
}) {
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const unit = useUnitLabel();
  const u = line.poUnit ?? line.invoiceUnit;
  const unitText = u ? unit(u) : '';
  const onOrder = line.poLineId !== null && line.poQty !== null;
  const step = padStep(u);
  const whole = isWhole(u, line.poQty);
  const shown = (v: number) => `${formatNumber(v, locale, { maximumFractionDigits: 3 })}${unitText ? ` ${unitText}` : ''}`;

  const [text, setText] = useState('');
  // A value put there for the receiver reads as selected: the first key replaces it.
  const [replace, setReplace] = useState(false);
  const [damaged, setDamaged] = useState(false);
  /** What the row said when the sheet opened (damaged, or rejected on an earlier visit). */
  const [damagedAtOpen, setDamagedAtOpen] = useState(false);
  // Every opening starts from the line as it stands (React's "adjust state when a prop changes").
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const start = initialPadText(mark, blind);
      setText(start);
      setReplace(start !== '');
      // The chip starts from what the row says: "פגום" for damaged and for rejected on an earlier visit.
      const hurtNow = mark.touched && isHurt(mark);
      setDamaged(hurtNow);
      setDamagedAtOpen(hurtNow);
    }
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const noteId = useId();
  const value = padValue(text);
  const note = farNote(line, value, tolerance);

  // The dialog took focus on open; the field is where the eye and a screen reader belong.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (el.value) el.select();
      // A very short screen where the sheet still scrolls: the keys and the button open whole and stay
      // put while typing (what gives way is the top, the note's reserved row).
      const scroller = el.closest('[data-testid="count-editor"]')?.parentElement;
      if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the field's selection in step: selected while the next key replaces, else the caret at the end.
  useEffect(() => {
    const el = inputRef.current;
    if (!open || !el || document.activeElement !== el) return;
    if (replace && el.value) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [open, text, replace]);

  const press = useCallback(
    (k: PadKey) => {
      setText((t) => typeKey(t, k, replace, whole));
      setReplace(false);
    },
    [replace, whole],
  );

  const bump = useCallback(
    (dir: 1 | -1) => {
      if (!step) return;
      setText((t) => stepText(t, dir * step));
      setReplace(true);
    },
    [step],
  );

  const save = useCallback(() => {
    if (value === null) return;
    if (value === 0) {
      onSave(MISSING_PATCH);
      return;
    }
    const base = qtyPatch(mark, value);
    // "פגום" left as the row said: keep what was recorded (a rejection on an earlier visit stays one).
    if (onOrder && damaged && damagedAtOpen) onSave({ ...base, condition: mark.condition, qtyRejected: mark.qtyRejected, rejectReason: mark.rejectReason });
    else if (onOrder && damaged) onSave({ ...base, ...DAMAGED_PATCH });
    else onSave({ ...base, condition: 'ok', rejectReason: null });
  }, [value, mark, onOrder, damaged, damagedAtOpen, onSave]);

  // A hardware key pressed while focus is on a button of the sheet still types into the field.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target === inputRef.current) return;
      // Only keys pressed in THIS sheet: a dialog stacked on top (the sign-in sheet) keeps its own
      // keys, and another field never loses its typing to the count.
      const target = e.target instanceof HTMLElement ? e.target : null;
      const dialog = inputRef.current?.closest('dialog');
      if (!target || !dialog || (target !== document.body && !dialog.contains(target))) return;
      if (target.isContentEditable || target.closest('input, textarea, select')) return;
      if (e.key === 'Enter') {
        if (target.tagName === 'BUTTON') return; // a focused button handles its own Enter
        e.preventDefault();
        save();
        return;
      }
      const k = padKeyFromKeyboard(e.key);
      if (!k) return;
      e.preventDefault();
      press(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, press, save]);

  const ordered = onOrder ? qtyInputText(line.poQty!) : null;
  const cta =
    value === null
      ? td('delivery.count.confirmQty')
      : value === 0
        ? onOrder
          ? td('delivery.dock.actions.saveMissing')
          : td('delivery.dock.actions.saveNotArrived')
        : td('delivery.dock.actions.save', { qty: shown(value) });

  const chip = (active: boolean) =>
    `inline-flex min-h-12 items-center justify-center gap-1.5 rounded-pill border px-[18px] text-body font-medium transition-colors duration-micro ease-standard ${
      active ? 'border-ink bg-ink text-on-bold' : 'border-line-strong bg-surface text-ink active:bg-surface-2 disabled:border-line disabled:text-subtle'
    }`;
  const stepper =
    'inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-card border border-line-strong bg-surface text-ink transition-colors duration-micro ease-standard active:bg-surface-2 disabled:border-line disabled:text-subtle [@media(max-height:640px)]:h-[3.25rem] [@media(max-height:640px)]:w-[3.25rem]';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent="full"
      title={td('delivery.dock.sheet.title')}
      description={onOrder ? td('delivery.dock.sheet.sub', { name, qty: shown(line.poQty!) }) : td('delivery.dock.sheet.subNotOrdered', { name })}
      primary={
        <Button size="xl" onClick={save} disabled={value === null} className={PHONE_CTA} data-testid="count-done">
          {cta}
        </Button>
      }
    >
      {/*
        Bottom-aligned, and sized to fit with the note (the keys shrink with the screen's height, never
        under 44 px): a note that appears grows the content upward, so no key moves under the thumb. On a
        short screen (640 px or less) the note's row is kept even when empty, for the same reason.
      */}
      <div className="flex min-h-full flex-col" data-testid="count-editor">
        <div className="mt-auto flex flex-col gap-2 pt-1">
          <div>
          {/* Mounted while the sheet is open, so a note that appears is a change a screen reader speaks. */}
          <div id={noteId} role="status" className="[@media(max-height:640px)]:min-h-[2.625rem]">
            {note ? (
              <p className="mb-2 flex items-center gap-2 rounded-card border border-warn-subtle bg-warn-subtle px-3 py-1.5 text-body-sm text-ink" data-testid="count-tolerance">
                <span className="h-2 w-2 shrink-0 rounded-pill border-[1.5px] border-warn-dot-ring bg-warn-dot" aria-hidden="true" />
                <span>
                  {note.kind === 'double'
                    ? td('delivery.dock.sheet.double', { ordered: shown(note.ordered) })
                    : td('delivery.dock.sheet.far', { pct: formatPercent(note.pct, locale, 0), ordered: shown(note.ordered) })}
                </span>
              </p>
            ) : null}
          </div>
          {/* The pad's keys keep a screen reader on the key: the number being built is spoken here. */}
          <p className="sr-only" aria-live="polite">
            {value === null ? '' : cta}
          </p>

          <div className="flex items-center gap-2">
            {step ? (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => bump(-1)}
                disabled={value === null || value === 0}
                aria-label={td('delivery.count.decreaseFor', { name })}
                className={stepper}
              >
                <Minus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : null}
            <label
              // The box shows focus (the field inside it is only as wide as its digits).
              className={`flex h-16 min-w-0 flex-1 cursor-text items-center justify-center gap-1.5 rounded-card border-2 px-2 [@media(max-height:640px)]:h-[3.25rem] transition-colors duration-micro ease-standard focus-within:[outline-offset:var(--focus-offset,2px)] focus-within:[outline:var(--focus-width,2px)_solid_rgb(var(--c-focus))] ${
                // "The next key replaces it": the colour, and the selection ring too (its width, not only its hue).
                replace && text !== '' ? 'border-info bg-info-subtle [box-shadow:var(--ring-selected)]' : 'border-line-strong bg-surface'
              }`}
            >
              <input
                ref={inputRef}
                type="text"
                // The product's pad types; the phone's own keyboard (and its local digits) stays closed.
                inputMode="none"
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                role={step ? 'spinbutton' : undefined}
                aria-valuenow={step && value !== null ? value : undefined}
                aria-valuemin={step ? 0 : undefined}
                aria-label={td('delivery.count.qtyFor', { name, unit: unitText || '—' })}
                aria-describedby={note ? noteId : undefined}
                placeholder="—"
                value={text}
                onChange={(e) => {
                  const next = sanitizeTyped(e.target.value, whole);
                  if (next === null) return;
                  setText(next);
                  setReplace(false);
                }}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  setReplace(el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                  } else if (step && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    // As the − button: nothing below an empty field or 0 (0 is "missing", a choice of its own).
                    if (e.key === 'ArrowDown' && (value === null || value === 0)) return;
                    bump(e.key === 'ArrowUp' ? 1 : -1);
                  }
                }}
                // As wide as its digits (the unit sits right beside them), never under a 48 px target.
                style={{ width: `${Math.max(text.length, 1) + 1}ch` }}
                className={`num h-full min-w-12 max-w-full bg-transparent text-center font-medium text-ink caret-primary outline-none placeholder:text-muted focus-visible:!outline-none ${
                  text.length > 7 ? 'text-metric-md' : 'text-metric-lg'
                }`}
                data-testid="count-qty"
              />
              {unitText ? <span className="shrink-0 text-body text-muted">{unitText}</span> : null}
            </label>
            {step ? (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => bump(1)}
                aria-label={td('delivery.count.increaseFor', { name })}
                className={stepper}
              >
                <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              aria-pressed={value === 0}
              onClick={() => {
                setText('0');
                setReplace(true);
                setDamaged(false);
              }}
              className={chip(value === 0)}
              data-testid="chip-missing"
            >
              {onOrder ? td('delivery.count.missingTag') : td('delivery.count.notArrived')}
            </button>
            {onOrder ? (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                aria-pressed={damaged && value !== 0}
                // Off while the line is "missing": nothing arrived to be damaged, and a press would hide a state.
                disabled={value === 0}
                onClick={() => setDamaged((d) => !d)}
                className={chip(damaged && value !== 0)}
                data-testid="chip-damaged"
              >
                {damaged && value !== 0 ? <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden="true" /> : null}
                {td('delivery.count.damagedTag')}
              </button>
            ) : null}
            {ordered !== null ? (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                aria-pressed={value !== null && text === ordered}
                onClick={() => {
                  setText(ordered);
                  setReplace(true);
                }}
                className={chip(value !== null && text === ordered)}
                data-testid="chip-as-ordered"
              >
                {td('delivery.dock.actions.asOrdered')}
              </button>
            ) : null}
          </div>

          <DockKeypad onKey={press} whole={whole} labels={{ point: td('delivery.dock.aria.point'), del: td('delivery.dock.aria.del') }} />
        </div>
      </div>
    </Sheet>
  );
}
