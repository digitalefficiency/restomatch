'use client';

import { useId, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { Button } from '@/lib/components/Button';
import { Textarea } from '@/lib/components/Input';
import { Money } from '@/lib/components/money/Money';
import { costOf } from './desk-facts';
import { qtyText } from './desk-text';
import type { DeskMode, How, QueueItem } from './desk-types';
import { Template } from './rich-message';
import { displayName, waiveReasons, type WaiveReason } from './vocab';

/** Two literal class maps (§4.0): the landing ('single') takes the narrow values unprefixed. */
const CHIP: Record<DeskMode, string> = {
  desk: 'inline-flex min-h-8 items-center rounded-pill border border-line-strong bg-surface px-3 text-body-sm text-fg transition-colors duration-micro ease-standard hover:bg-surface-hover max-xl:min-h-11 max-xl:px-3.5',
  single:
    'inline-flex min-h-11 items-center rounded-pill border border-line-strong bg-surface px-3.5 text-body-sm text-fg transition-colors duration-micro ease-standard hover:bg-surface-hover',
};
/** "חזרה" (Button merges with cnMerge: the size override is safe). */
const BACK: Record<DeskMode, string> = {
  desk: 'ms-auto max-xl:order-last max-xl:min-h-11 max-xl:[&_[data-kbd]]:hidden',
  single: 'order-last ms-auto min-h-11 [&_[data-kbd]]:hidden',
};
/** The "אחר" buttons: 44 px on a phone and on the landing. */
const OTHER_BTN: Record<DeskMode, string> = {
  desk: 'max-xl:min-h-11',
  single: 'min-h-11',
};

/** pointer click (detail ≥ 1) · keyboard-activated button (detail 0). */
const howOf = (e: React.MouseEvent): How => (e.detail === 0 ? 'keyboard' : 'pointer');

export interface ReasonsRowProps {
  g: QueueItem;
  mode: DeskMode;
  /** usePrefs().singleKeys. "חזרה" keeps its Esc cap either way: Escape always works. */
  singleKeys: boolean;
  onPick: (code: WaiveReason, reason: string, how: How) => void;
  onBack: () => void;
}

/**
 * The reasons row before paying as billed (DS3-04 spec §4.5): it replaces the decision bar's content. The cost line
 * says what paying costs ("תשלמו ל{ספק} ₪X …", the amount with its basis), then the question, the product's reason
 * chips for the type (the same `reasonCode`s; chips are buttons, never a change handler), "אחר" with its text, and
 * "חזרה". DOM order cost → question → chips → "חזרה", so the first chip is the first button (W1-07:228); the
 * controller moves focus there (§5.3) — the row never focuses anything on mount. Escape closes it from any control
 * inside (its own handler stops the event, so the desk's keys do not see it).
 */
export function ReasonsRow({ g, mode, onPick, onBack }: ReasonsRowProps) {
  const t = useT(approvals);
  const locale = useLocale();
  const [otherOpen, setOtherOpen] = useState(false);
  const [text, setText] = useState('');
  const otherId = useId();

  const cost = costOf(g);
  const supplier = displayName(locale, g.supplierName, g.supplierNameEn);
  // The cost sentence with its amount left as {amount}: Template puts the <Money> in its place (one text node).
  const costLine = t(`desk.cost.${cost.form}`, {
    supplier: supplier.trim() ? supplier : t('desk.cost.supplierFallback'),
    qty: cost.qty4 != null ? qtyText(locale, cost.qty4, cost.unit ?? null) : '',
  });

  return (
    <div
      id="desk-reasons"
      role="group"
      aria-labelledby="desk-reasons-cost desk-reasons-q"
      data-testid="waive-reasons"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onBack();
        }
      }}
      className="flex w-full flex-wrap items-center gap-2"
    >
      <p id="desk-reasons-cost" data-testid="desk-cost-line" className="w-full text-body-sm text-fg-secondary">
        <Template
          text={costLine}
          values={{
            amount: (
              <b className="font-semibold text-fg">
                <Money agorot={Number(cost.amountAgorot)} context="line" />
              </b>
            ),
          }}
        />
      </p>
      <p id="desk-reasons-q" className="me-auto text-body-sm font-medium text-fg">
        {t('reasons.title')}
      </p>
      <div className="flex w-full flex-wrap gap-2">
        {waiveReasons(g.type).map((code) => (
          <button
            type="button"
            data-reason-chip=""
            key={code}
            aria-pressed={code === 'other' ? otherOpen : undefined}
            className={CHIP[mode]}
            onClick={(e) => {
              if (code === 'other') setOtherOpen((o) => !o);
              else if (e.detail <= 1) onPick(code, t(`reasons.${code}`), howOf(e));
            }}
          >
            {t(`reasons.${code}`)}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          kbd="Esc"
          aria-keyshortcuts="Escape"
          data-testid="reasons-back"
          className={BACK[mode]}
          onClick={onBack}
        >
          {t('desk.actions.back')}
        </Button>
      </div>
      {otherOpen ? (
        <div className="w-full space-y-2">
          <label htmlFor={otherId} className="block text-body-sm font-medium text-fg">
            {t('reasons.otherLabel')}
          </label>
          <Textarea id={otherId} autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="md" className={OTHER_BTN[mode]} onClick={onBack}>
              {t('reasons.cancel')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={!text.trim()}
              className={OTHER_BTN[mode]}
              onClick={(e) => {
                if (e.detail <= 1) onPick('other', text.trim(), howOf(e));
              }}
            >
              {t('reasons.otherConfirm')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
