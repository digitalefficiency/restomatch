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
          className="adjust-card mb-4 w-full text-right rounded-2xl border border-emerald-200/60 bg-emerald-50/40 px-5 py-3 flex items-center justify-between hover:bg-emerald-50/70 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Check className="w-4 h-4" strokeWidth={3} />
            </div>
            <div>
              <div className="text-sm font-semibold text-emerald-900">
                {matchedLines.length} שורות תואמות — אישור אוטומטי
              </div>
              <div className="text-xs text-emerald-800/70">לחץ להרחבה</div>
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-emerald-600 transition-transform ${showMatched ? 'rotate-180' : ''}`}
          />
        </button>
      ) : null}

      {showMatched ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-700">
          <ul className="space-y-1.5">
            {matchedLines.map((l) => (
              <li key={l.productName} className="flex items-center justify-between">
                <span className="font-medium">{l.productName}</span>
                <span className="text-slate-500 tabular-nums">
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
      <div className="sticky bottom-0 pb-4 pt-4 -mx-6 px-6 bg-gradient-to-t from-white via-white to-transparent">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-800 underline underline-offset-4 decoration-slate-300"
          >
            חזור לתוצאות
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={stats.pending > 0}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl px-5 py-3 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.25)] disabled:shadow-none transition-all"
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
      className={`adjust-card rounded-2xl border bg-white/90 backdrop-blur-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)] ${mark.touched ? 'border-slate-200' : accent.border}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-slate-900">{line.productName}</div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {line.poQty !== null ? (
              <span>הוזמן: {line.poQty} {line.poUnit}</span>
            ) : (
              <span className="text-red-600">לא בהזמנה</span>
            )}
            {line.invoiceQty !== null ? (
              <>
                <span className="text-slate-300 mx-1.5">·</span>
                <span>חויב: {line.invoiceQty} {line.invoiceUnit}</span>
              </>
            ) : null}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${accent.tint}`}>
          {accent.icon}
          <span>{accent.label}</span>
        </span>
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between bg-slate-50 rounded-xl p-2 mb-3">
        <button
          type="button"
          onClick={() => incrementQty(-1)}
          className="w-10 h-10 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 active:scale-95 transition-all flex items-center justify-center"
        >
          <Minus className="w-4 h-4 text-slate-700" strokeWidth={2.5} />
        </button>
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={mark.qtyReceived}
            onChange={(e) => setQty(Number(e.target.value))}
            className="w-20 text-center text-2xl font-bold tabular-nums bg-transparent border-0 focus:outline-none text-slate-900"
            min={0}
            step={0.1}
          />
          <span className="text-sm text-slate-500">{line.invoiceUnit ?? line.poUnit ?? ''}</span>
        </div>
        <button
          type="button"
          onClick={() => incrementQty(1)}
          className="w-10 h-10 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 active:scale-95 transition-all flex items-center justify-center"
        >
          <Plus className="w-4 h-4 text-slate-700" strokeWidth={2.5} />
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
        <div className="mt-3 text-xs text-emerald-700 flex items-center gap-1">
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
      ? 'bg-blue-600 text-white border-blue-600'
      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
    red: active
      ? 'bg-red-600 text-white border-red-600'
      : 'bg-white text-red-700 border-red-200 hover:bg-red-50',
    amber: active
      ? 'bg-amber-600 text-white border-amber-600'
      : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${tones[tone]}`}
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
        tint: 'bg-amber-50 text-amber-700 border-amber-200',
        border: 'border-amber-200/60',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    case 'price_diff':
      return {
        label: 'מחיר שונה',
        tint: 'bg-orange-50 text-orange-700 border-orange-200',
        border: 'border-orange-200/60',
        icon: <Zap className="w-3 h-3" />,
      };
    case 'unordered':
      return {
        label: 'לא בהזמנה',
        tint: 'bg-red-50 text-red-700 border-red-200',
        border: 'border-red-200/60',
        icon: <Plus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'missing_from_invoice':
      return {
        label: 'חסר בחשבונית',
        tint: 'bg-slate-100 text-slate-700 border-slate-200',
        border: 'border-slate-200/60',
        icon: <X className="w-3 h-3" strokeWidth={3} />,
      };
    default:
      return {
        label: 'תואם',
        tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        border: 'border-emerald-200/60',
        icon: <Check className="w-3 h-3" strokeWidth={3} />,
      };
  }
}
