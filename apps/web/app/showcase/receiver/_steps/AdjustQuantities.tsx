'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Check, ChevronDown, Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { LineStatus, ReconciliationResult } from '../_mock';
import {
  type LineMark,
  lineKey,
  nonMatchedLines,
  pendingMarksCount,
} from '../_state';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import type { Translator } from '@/lib/i18n/translate';
import { formatIls } from '@/lib/money';
import { HebrewToggle, ItemName, Qty, useUnitLabel } from './english';
import { StatusBadge } from './Reconciliation';
import { StepHeader } from './SupplierSelect';

type T = Translator<typeof receiving.he>;

interface Props {
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
  onUpdateMark: (key: string, patch: Partial<LineMark>) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function AdjustQuantities({ result, marks, onUpdateMark, onSubmit, onBack }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT(receiving);
  const locale = useLocale();
  const dir = useDir();
  const [showMatched, setShowMatched] = useState(false);
  const stats = pendingMarksCount(result, marks);
  const lines = nonMatchedLines(result);
  const matchedLines = result.lines.filter((l) => l.status === 'matched');

  useGSAP(
    () => {
      gsap.from('.adjust-card', {
        y: 12,
        opacity: 0,
        stagger: 0.05,
        duration: 0.4,
        ease: 'power3.out',
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} dir={dir}>
      <StepHeader
        eyebrow={t('steps.stepOf', { current: 5, total: 5 })}
        title={t('steps.adjust.title')}
        subtitle={t('steps.adjust.subtitle', {
          pending: stats.pending,
          done: stats.total - stats.pending,
          matched: stats.matched,
        })}
      />

      <div className="mb-3 flex justify-end">
        <HebrewToggle />
      </div>

      {/* Matched summary collapsed */}
      {matchedLines.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowMatched(!showMatched)}
          className="adjust-card mb-4 w-full min-h-14 text-start rounded-2xl border border-primary/25 bg-primary/8 px-5 py-3 flex items-center justify-between hover:bg-primary/12 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Check className="w-4 h-4" strokeWidth={3} />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">
                {t('steps.adjust.matchedSummary', { count: matchedLines.length })}
              </div>
              <div className="text-xs text-muted">{t('steps.adjust.tapToExpand')}</div>
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-primary transition-transform ${showMatched ? 'rotate-180' : ''}`}
          />
        </button>
      ) : null}

      {showMatched ? (
        <div className="mb-4 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink">
          <ul className="space-y-1.5">
            {matchedLines.map((l) => (
              <li key={l.productName} className="flex items-center justify-between gap-3">
                <ItemName he={l.productName} en={l.productNameEn} className="font-medium" />
                <span className="text-muted">
                  <Qty qty={l.invoiceQty} unit={l.invoiceUnit} />
                  {l.invoiceUnitPrice !== null ? (
                    <bdi dir="ltr" className="font-mono tabular-nums">
                      {' '}× {formatIls(l.invoiceUnitPrice, { locale, maximumFractionDigits: 2 })}
                    </bdi>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Non-matched lines */}
      <div className="space-y-3 mb-6">
        {lines.map((line) => {
          const key = lineKey(line);
          const mark = marks[key];
          if (!mark) return null;
          return (
            <AdjustCard
              key={key}
              line={line}
              mark={mark}
              onUpdate={(patch) => onUpdateMark(key, patch)}
              t={t}
              locale={locale}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 pb-4 pt-4 -mx-6 px-6 bg-gradient-to-t from-bg via-bg to-transparent">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="min-h-11 text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
          >
            {t('steps.adjust.backToResults')}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={stats.pending > 0}
            data-testid="close-receipt"
            className="inline-flex min-h-12 items-center gap-2 bg-primary hover:brightness-110 disabled:bg-surface-2 disabled:text-subtle text-on-primary rounded-xl px-5 py-3 font-medium shadow-glow-primary disabled:shadow-none transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
          >
            <Check className="w-5 h-5" strokeWidth={3} />
            {stats.pending > 0
              ? t('steps.adjust.fixRemaining', { count: stats.pending })
              : t('steps.adjust.closeAndSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AdjustCardProps {
  line: ReconciliationResult['lines'][number];
  mark: LineMark;
  onUpdate: (patch: Partial<LineMark>) => void;
  t: T;
  locale: 'he' | 'en';
}

function AdjustCard({ line, mark, onUpdate, t, locale }: AdjustCardProps) {
  const accent = statusAccent(line.status);
  const unit = useUnitLabel();
  const qtyText = (q: number, u: string | null) =>
    `${formatNumber(q, locale, { maximumFractionDigits: 3 })}${u ? ` ${unit(u)}` : ''}`;

  function setQty(value: number) {
    const safe = Math.max(0, Number(value.toFixed(2)));
    onUpdate({ qtyReceived: safe });
  }

  function incrementQty(delta: number) {
    setQty(mark.qtyReceived + delta);
  }

  return (
    <div
      className={`adjust-card rounded-2xl border bg-surface p-4 shadow-card ${mark.touched ? 'border-line' : accent.border}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <ItemName he={line.productName} en={line.productNameEn} className="text-base font-semibold text-ink" />
          <div className="text-xs text-muted mt-1 tabular-nums">
            {line.poQty !== null ? (
              <span>{t('steps.adjust.ordered', { qty: qtyText(line.poQty, line.poUnit) })}</span>
            ) : (
              <span className="text-danger">{t('steps.adjust.notOrdered')}</span>
            )}
            {line.invoiceQty !== null ? (
              <>
                <span className="text-subtle mx-1.5">·</span>
                <span>{t('steps.adjust.billed', { qty: qtyText(line.invoiceQty, line.invoiceUnit) })}</span>
              </>
            ) : null}
          </div>
        </div>
        <StatusBadge status={line.status} t={t} />
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between bg-surface-2 rounded-xl p-2 mb-3" dir="ltr">
        <button
          type="button"
          onClick={() => incrementQty(-1)}
          aria-label={t('steps.adjust.decrease')}
          className="w-12 h-12 rounded-lg bg-surface border border-line hover:border-primary/40 active:scale-95 transition-all flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Minus className="w-4 h-4 text-ink" strokeWidth={2.5} />
        </button>
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={mark.qtyReceived}
            onChange={(e) => setQty(Number(e.target.value))}
            aria-label={t('steps.adjust.qtyLabel')}
            className="w-20 text-center text-2xl font-bold font-mono tabular-nums bg-transparent border-0 focus:outline-none text-ink"
            min={0}
            step={0.1}
          />
          <span className="text-sm text-muted">{unit(line.invoiceUnit ?? line.poUnit ?? '')}</span>
        </div>
        <button
          type="button"
          onClick={() => incrementQty(1)}
          aria-label={t('steps.adjust.increase')}
          className="w-12 h-12 rounded-lg bg-surface border border-line hover:border-primary/40 active:scale-95 transition-all flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Plus className="w-4 h-4 text-ink" strokeWidth={2.5} />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {line.poQty !== null ? (
          <Chip
            label={t('steps.adjust.asOrdered', { qty: formatNumber(line.poQty, locale) })}
            onClick={() => setQty(line.poQty!)}
            active={mark.qtyReceived === line.poQty}
          />
        ) : null}
        {line.invoiceQty !== null ? (
          <Chip
            label={t('steps.adjust.asInvoiced', { qty: formatNumber(line.invoiceQty, locale) })}
            onClick={() => setQty(line.invoiceQty!)}
            active={mark.qtyReceived === line.invoiceQty}
          />
        ) : null}
        <Chip
          label={t('steps.adjust.missing')}
          onClick={() => {
            setQty(0);
            onUpdate({ condition: 'rejected', qtyRejected: line.poQty ?? 0 });
          }}
          tone="red"
          active={mark.condition === 'rejected'}
        />
        <Chip
          label={t('steps.adjust.damaged')}
          onClick={() => onUpdate({ condition: 'damaged' })}
          tone="amber"
          active={mark.condition === 'damaged'}
        />
      </div>

      {mark.touched ? (
        <div className="mt-3 text-xs text-primary flex items-center gap-1">
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
          {t('steps.adjust.settled')}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  onClick,
  tone = 'neutral',
  active,
}: {
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'red' | 'amber';
  active?: boolean;
}) {
  const tones = {
    neutral: active
      ? 'bg-primary text-on-primary border-primary'
      : 'bg-surface-2 text-muted border-line hover:border-primary/40 hover:text-primary',
    red: active
      ? 'bg-danger text-on-primary border-danger'
      : 'bg-surface-2 text-danger border-danger/30 hover:bg-danger/10',
    amber: active
      ? 'bg-warn text-on-primary border-warn'
      : 'bg-surface-2 text-warn border-warn/30 hover:bg-warn/10',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 text-sm font-medium px-4 py-2 rounded-full border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

function statusAccent(status: LineStatus): { border: string } {
  switch (status) {
    case 'qty_diff':
    case 'price_diff':
      return { border: 'border-warn/30' };
    case 'unordered':
      return { border: 'border-danger/30' };
    case 'missing_from_invoice':
      return { border: 'border-line' };
    default:
      return { border: 'border-primary/30' };
  }
}
