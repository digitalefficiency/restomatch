'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { AlertTriangle, Check, ChevronDown, Minus, Plus, X, Zap } from 'lucide-react';
import { useRef, useState } from 'react';
import type { LineStatus, ReconciliationResult } from '../_mock';
import {
  type LineMark,
  lineKey,
  nonMatchedLines,
  pendingMarksCount,
} from '../_state';
import { StepHeader } from './SupplierSelect';

interface Props {
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
  onUpdateMark: (key: string, patch: Partial<LineMark>) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function AdjustQuantities({ result, marks, onUpdateMark, onSubmit, onBack }: Props) {
  const ref = useRef<HTMLDivElement>(null);
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
    <div ref={ref} dir="rtl">
      <StepHeader
        eyebrow="צעד 5 מתוך 5"
        title="כמה הגיע באמת?"
        subtitle={`${stats.pending} שורות עוד מחכות להתאמה · ${stats.total - stats.pending} כבר עודכנו · ${stats.matched} תואמות אוטומטית`}
      />

      {/* Matched summary collapsed */}
      {matchedLines.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowMatched(!showMatched)}
          className="adjust-card mb-4 w-full text-right rounded-2xl border border-primary/25 bg-primary/8 px-5 py-3 flex items-center justify-between hover:bg-primary/12 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Check className="w-4 h-4" strokeWidth={3} />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">
                {matchedLines.length} שורות תואמות — אישור אוטומטי
              </div>
              <div className="text-xs text-muted">לחץ להרחבה</div>
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
              <li key={l.productName} className="flex items-center justify-between">
                <span className="font-medium">{l.productName}</span>
                <span className="text-muted font-mono tabular-nums">
                  {l.invoiceQty} {l.invoiceUnit} × ₪{l.invoiceUnitPrice}
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
            className="text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
          >
            חזור לתוצאות
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={stats.pending > 0}
            className="inline-flex items-center gap-2 bg-primary hover:brightness-110 disabled:bg-surface-2 disabled:text-subtle text-on-primary rounded-xl px-5 py-3 font-medium shadow-glow-primary disabled:shadow-none transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
          >
            <Check className="w-5 h-5" strokeWidth={3} />
            {stats.pending > 0
              ? `סדר עוד ${stats.pending} שורות`
              : 'סגור קבלה ושמור'}
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
}

function AdjustCard({ line, mark, onUpdate }: AdjustCardProps) {
  const accent = statusAccent(line.status);

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
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-ink">{line.productName}</div>
          <div className="text-xs text-muted mt-1 font-mono tabular-nums">
            {line.poQty !== null ? (
              <span>הוזמן: {line.poQty} {line.poUnit}</span>
            ) : (
              <span className="text-danger">לא בהזמנה</span>
            )}
            {line.invoiceQty !== null ? (
              <>
                <span className="text-subtle mx-1.5">·</span>
                <span>חויב: {line.invoiceQty} {line.invoiceUnit}</span>
              </>
            ) : null}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${accent.tint}`}>
          {accent.icon}
          <span>{accent.label}</span>
        </span>
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between bg-surface-2 rounded-xl p-2 mb-3">
        <button
          type="button"
          onClick={() => incrementQty(-1)}
          className="w-10 h-10 rounded-lg bg-surface border border-line hover:border-primary/40 active:scale-95 transition-all flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Minus className="w-4 h-4 text-ink" strokeWidth={2.5} />
        </button>
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={mark.qtyReceived}
            onChange={(e) => setQty(Number(e.target.value))}
            className="w-20 text-center text-2xl font-bold font-mono tabular-nums bg-transparent border-0 focus:outline-none text-ink"
            min={0}
            step={0.1}
          />
          <span className="text-sm text-muted">{line.invoiceUnit ?? line.poUnit ?? ''}</span>
        </div>
        <button
          type="button"
          onClick={() => incrementQty(1)}
          className="w-10 h-10 rounded-lg bg-surface border border-line hover:border-primary/40 active:scale-95 transition-all flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Plus className="w-4 h-4 text-ink" strokeWidth={2.5} />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {line.poQty !== null ? (
          <Chip
            label={`= הזמנה (${line.poQty})`}
            onClick={() => setQty(line.poQty!)}
            active={mark.qtyReceived === line.poQty}
          />
        ) : null}
        {line.invoiceQty !== null ? (
          <Chip
            label={`= חשבונית (${line.invoiceQty})`}
            onClick={() => setQty(line.invoiceQty!)}
            active={mark.qtyReceived === line.invoiceQty}
          />
        ) : null}
        <Chip
          label="חסר"
          onClick={() => {
            setQty(0);
            onUpdate({ condition: 'rejected', qtyRejected: line.poQty ?? 0 });
          }}
          tone="red"
          active={mark.condition === 'rejected'}
        />
        <Chip
          label="פגום"
          onClick={() => onUpdate({ condition: 'damaged' })}
          tone="amber"
          active={mark.condition === 'damaged'}
        />
      </div>

      {mark.touched ? (
        <div className="mt-3 text-xs text-primary flex items-center gap-1">
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
          סודר
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
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

function statusAccent(status: LineStatus) {
  switch (status) {
    case 'qty_diff':
      return {
        label: 'כמות שונה',
        tint: 'bg-warn/12 text-warn ring-1 ring-warn/25',
        border: 'border-warn/30',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    case 'price_diff':
      return {
        label: 'מחיר שונה',
        tint: 'bg-warn/12 text-warn ring-1 ring-warn/25',
        border: 'border-warn/30',
        icon: <Zap className="w-3 h-3" />,
      };
    case 'unordered':
      return {
        label: 'לא בהזמנה',
        tint: 'bg-danger/12 text-danger ring-1 ring-danger/25',
        border: 'border-danger/30',
        icon: <Plus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'missing_from_invoice':
      return {
        label: 'חסר בחשבונית',
        tint: 'bg-surface-2 text-muted ring-1 ring-line',
        border: 'border-line',
        icon: <X className="w-3 h-3" strokeWidth={3} />,
      };
    default:
      return {
        label: 'תואם',
        tint: 'bg-primary/12 text-primary ring-1 ring-primary/25',
        border: 'border-primary/30',
        icon: <Check className="w-3 h-3" strokeWidth={3} />,
      };
  }
}
