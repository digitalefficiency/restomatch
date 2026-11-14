'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Sheet } from '@/lib/components';
import type { ReconciliationLine } from '@/app/showcase/receiver/_mock';
import { lineKey } from '@/app/showcase/receiver/_state';
import { ItemName, useUnitLabel } from '@/app/showcase/receiver/_steps/english';
import { useLocale, useT } from '@/lib/i18n/client';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import { isWhole, padKeyFromKeyboard, padValue, sanitizeTyped, typeKey, type PadKey } from './_keypad';
import { DockKeypad } from './dock-keypad';
import { PHONE_CTA } from './_phone';

/**
 * The blind spot check before any bulk "as ordered" (owner decision 20): up to
 * two lines picked at random, counted on the pad with the ordered quantity out
 * of sight — the sheet covers the list, so it is blind for real. The bulk goes
 * through only when every count agrees with the order (the caller decides, with
 * the wizard's own confirmSpotCheck). Confirming with a field left empty says
 * so and moves to it (SPEC §10.3, the reference's "רשמו כמות לכל פריט").
 */
export function DockSpotSheet({
  lines,
  onConfirm,
  onCancel,
}: {
  /** The picked lines; null = closed. */
  lines: ReconciliationLine[] | null;
  onConfirm: (counts: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const td = useT(receivingDelivery);
  const open = lines !== null && lines.length > 0;
  const picked = useMemo(() => (open ? lines : []), [open, lines]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [at, setAt] = useState(0);
  const [askAll, setAskAll] = useState(false);
  const [wasKey, setWasKey] = useState('');
  const sessionKey = picked.map(lineKey).join('|');
  if (sessionKey !== wasKey) {
    setWasKey(sessionKey);
    setTexts({});
    setAt(0);
    setAskAll(false);
  }
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const cur = picked[at] ?? picked[0];
  const whole = cur ? isWhole(cur.poUnit) : false;

  // The dialog took focus on open; the first field is where the count starts.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => refs.current[0]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open, sessionKey]);

  const press = useCallback(
    (k: PadKey) => {
      if (!cur) return;
      const key = lineKey(cur);
      setTexts((t) => ({ ...t, [key]: typeKey(t[key] ?? '', k, false, whole) }));
      setAskAll(false);
    },
    [cur, whole],
  );

  const confirm = useCallback(() => {
    const counts: Record<string, number> = {};
    for (const [i, l] of picked.entries()) {
      const v = padValue(texts[lineKey(l)] ?? '');
      if (v === null) {
        setAskAll(true);
        setAt(i);
        refs.current[i]?.focus({ preventScroll: true });
        return;
      }
      counts[lineKey(l)] = v;
    }
    onConfirm(counts);
  }, [picked, texts, onConfirm]);

  // A hardware key pressed while focus is on a button of the sheet types into the current field.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || refs.current.includes(e.target as HTMLInputElement)) return;
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault();
        confirm();
        return;
      }
      const k = padKeyFromKeyboard(e.key);
      if (!k) return;
      e.preventDefault();
      press(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, press, confirm]);

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      detent="full"
      title={td('delivery.count.spotTitle')}
      description={td('delivery.count.spotHint')}
    >
      {open ? (
        <SpotBody
          lines={picked}
          texts={texts}
          at={at}
          askAll={askAll}
          refs={refs}
          whole={whole}
          onFocusLine={setAt}
          onType={(key, raw, lineWhole) => {
            const next = sanitizeTyped(raw, lineWhole);
            if (next === null) return;
            setTexts((t) => ({ ...t, [key]: next }));
            setAskAll(false);
          }}
          onEnter={(i) => {
            const empty = picked.findIndex((l, j) => j !== i && padValue(texts[lineKey(l)] ?? '') === null);
            if (empty >= 0 && padValue(texts[lineKey(picked[i]!)] ?? '') !== null) {
              setAt(empty);
              refs.current[empty]?.focus({ preventScroll: true });
            } else confirm();
          }}
          onKey={press}
          onConfirm={confirm}
          onCancel={onCancel}
        />
      ) : null}
    </Sheet>
  );
}

function SpotBody({
  lines,
  texts,
  at,
  askAll,
  refs,
  whole,
  onFocusLine,
  onType,
  onEnter,
  onKey,
  onConfirm,
  onCancel,
}: {
  lines: ReconciliationLine[];
  texts: Record<string, string>;
  at: number;
  askAll: boolean;
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  whole: boolean;
  onFocusLine: (i: number) => void;
  onType: (key: string, raw: string, whole: boolean) => void;
  onEnter: (i: number) => void;
  onKey: (k: PadKey) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const unit = useUnitLabel();
  return (
    <div className="flex min-h-full flex-col" data-testid="spot-check">
      <div className="mt-auto flex flex-col gap-2 pt-1">
        {askAll ? (
          <p role="alert" className="flex items-center gap-2 rounded-card border border-warn-subtle bg-warn-subtle px-3 py-1.5 text-body-sm text-ink" data-testid="spot-fill-all">
            <span className="h-2 w-2 shrink-0 rounded-pill bg-warn-bold" aria-hidden="true" />
            {td('delivery.dock.spot.fillAll')}
          </p>
        ) : null}
        {lines.map((l, i) => {
          const key = lineKey(l);
          const t = texts[key] ?? '';
          const u = l.poUnit ? unit(l.poUnit) : '';
          const name = locale === 'en' && l.productNameEn ? l.productNameEn : l.productName;
          const active = i === at;
          return (
            <label
              key={key}
              data-testid="spot-line"
              data-key={key}
              data-active={active ? 'true' : 'false'}
              className={`flex min-h-14 cursor-text items-center justify-between gap-3 rounded-card border-2 px-3 py-0.5 transition-colors duration-micro ease-standard focus-within:[outline-offset:var(--focus-offset,2px)] focus-within:[outline:var(--focus-width,2px)_solid_rgb(var(--c-focus))] ${
                active ? 'border-info bg-surface' : 'border-line-strong bg-surface'
              }`}
            >
              <ItemName he={l.productName} en={l.productNameEn} className="min-w-0 flex-1 text-title-sm text-ink" />
              <span className="flex h-[52px] shrink-0 items-center gap-1.5 rounded-card border border-line-strong bg-surface-2 px-2">
                <input
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="text"
                  inputMode="none"
                  enterKeyHint={i === lines.length - 1 ? 'done' : 'next'}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  dir="ltr"
                  aria-label={td('delivery.count.spotQtyFor', { name, unit: u || '—' })}
                  placeholder={td('delivery.dock.spot.empty')}
                  value={t}
                  onFocus={() => onFocusLine(i)}
                  onChange={(e) => onType(key, e.target.value, isWhole(l.poUnit))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onEnter(i);
                    }
                  }}
                  className="num h-full w-20 bg-transparent text-center text-metric-md font-medium text-ink caret-primary outline-none placeholder:text-body placeholder:font-normal placeholder:text-muted focus-visible:!outline-none"
                  data-testid="spot-qty"
                />
                {u ? <span className="text-body text-muted">{u}</span> : null}
              </span>
            </label>
          );
        })}
        <DockKeypad onKey={onKey} whole={whole} labels={{ point: td('delivery.dock.aria.point'), del: td('delivery.dock.aria.del') }} />
      </div>
      {/* Pinned under the keys inside the panel (the spot check is one region): the confirm never leaves the screen. */}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 flex gap-2 border-t border-line bg-surface px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <Button size="xl" variant="secondary" onClick={onCancel} className={`flex-1 px-3 ${PHONE_CTA}`} data-testid="spot-cancel">
          {td('delivery.count.spotCancel')}
        </Button>
        <Button size="xl" onClick={onConfirm} className={`flex-[2] px-3 ${PHONE_CTA}`} data-testid="spot-confirm">
          {td('delivery.count.spotConfirm')}
        </Button>
      </div>
    </div>
  );
}
