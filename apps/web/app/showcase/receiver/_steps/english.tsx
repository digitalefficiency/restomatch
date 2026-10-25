'use client';

/**
 * "Receiver in English" display primitives shared by the showcase demo and the
 * authenticated receiving wizard.
 *
 * In English the worker sees the English item name as the primary label and the
 * Hebrew original underneath (lang="he" dir="rtl") so they can find the same
 * line on the paper invoice. The "Show Hebrew original" toggle is remembered per
 * device (localStorage — a viewer convenience only). Hebrew UI is unchanged.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import { unitLabelFor } from '@restomatch/translate/units';
import { useAppLocale, useDir, useLocale, useT } from '@/lib/i18n/client';
import { isReceiverLocale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';

const KEY = 'rm_show_hebrew_original';
const EVENT = 'rm-show-hebrew-change';

function readShowHebrew(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Whether to show the Hebrew original under English names (default: yes). */
export function useShowHebrew(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(subscribe, readShowHebrew, () => true);
  const set = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* private mode — the toggle still works for this render via the event */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [value, set];
}

/** Toggle shown only in English. Big touch target (receivers use phones). */
export function HebrewToggle({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const t = useT(receiving);
  const [show, setShow] = useShowHebrew();
  if (locale !== 'en') return null;
  return (
    <label
      className={`inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink ${className}`}
    >
      <Languages className="h-4 w-4 text-primary" aria-hidden="true" />
      <input
        type="checkbox"
        className="h-5 w-5 accent-primary"
        checked={show}
        onChange={(e) => setShow(e.target.checked)}
        data-testid="toggle-hebrew-original"
      />
      <span>{t('english.showHebrew')}</span>
    </label>
  );
}

/**
 * An item name. English UI: English primary + Hebrew original underneath (when
 * the toggle is on). Falls back to the Hebrew alone when no translation exists.
 * Hebrew UI: the Hebrew name only.
 */
export function ItemName({
  he,
  en,
  className = '',
  strike = false,
}: {
  he: string;
  en?: string | null;
  className?: string;
  strike?: boolean;
}) {
  const locale = useLocale();
  // Receiver languages (S14): the primary name is in ar/ru/th/ti, tagged so it
  // shapes/reads correctly (the base locale is 'en', so the layout is shared).
  const appLocale = useAppLocale();
  const [showHebrew] = useShowHebrew();
  const strikeCls = strike ? 'line-through opacity-70' : '';
  if (locale !== 'en') return <span className={`${className} ${strikeCls}`}>{he}</span>;
  const english = en && en.trim() !== '' && en !== he ? en : null;
  if (!english) {
    return (
      <span lang="he" dir="rtl" className={`${className} ${strikeCls}`} data-testid="item-name-he-only">
        {he}
      </span>
    );
  }
  return (
    <span className={`flex flex-col ${className}`}>
      <span className={strikeCls} data-testid="item-name-en" lang={appLocale} dir="auto">
        {english}
      </span>
      {showHebrew ? (
        <span lang="he" dir="rtl" className="text-start text-xs font-normal text-muted" data-testid="item-name-he">
          {he}
        </span>
      ) : null}
    </span>
  );
}

/** Unit label in the active language (ק״ג → kg in English; ארגז → صندوق in Arabic). */
export function useUnitLabel(): (unit: string | null | undefined) => string {
  const appLocale = useAppLocale();
  return useCallback((unit) => unitLabelFor(unit, appLocale), [appLocale]);
}

/** "12 kg" / "12 ק״ג" — isolated in the page direction, number first. */
export function Qty({ qty, unit }: { qty: number | null; unit?: string | null }) {
  const locale = useLocale();
  const appLocale = useAppLocale();
  const dir = useDir();
  const label = useUnitLabel();
  if (qty === null) return <span>—</span>;
  // Quantities use the text font with tabular digits (never the mono "token"
  // face); receiver-language unit words keep the text font explicitly.
  const unitCls = isReceiverLocale(appLocale) ? 'font-sans' : undefined;
  // Page direction, not a forced LTR: in Hebrew "37.5 ליטר" must keep the
  // number first (to the right), it read "ליטר 37.5" inside an LTR isolate.
  return (
    <bdi dir={dir} className="whitespace-nowrap tabular-nums">
      {formatNumber(qty, locale, { maximumFractionDigits: 3 })}
      {unit ? <span className={unitCls}>{` ${label(unit)}`}</span> : ''}
    </bdi>
  );
}
