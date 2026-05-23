'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { AlertTriangle, ArrowLeft, Check, Minus, Plus, X, Zap } from 'lucide-react';
import { useRef } from 'react';
import type { LineStatus, ReconciliationResult } from '../_mock';
import { StepHeader } from './SupplierSelect';

interface Props {
  result: ReconciliationResult;
  onQuickConfirm: () => void;
  onContinueAdjust: () => void;
  onRetake: () => void;
}

export function Reconciliation({ result, onQuickConfirm, onContinueAdjust, onRetake }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.kpi-card', {
        y: 16,
        opacity: 0,
        stagger: 0.05,
        duration: 0.4,
        ease: 'power3.out',
      });
      gsap.from('.recon-row', {
        x: -12,
        opacity: 0,
        stagger: 0.03,
        duration: 0.35,
        ease: 'power2.out',
        delay: 0.2,
      });
    },
    { scope: ref },
  );

  const allGood =
    result.summary.qtyDiffCount +
      result.summary.priceDiffCount +
      result.summary.unorderedCount +
      result.summary.missingCount ===
    0;

  return (
    <div ref={ref} dir="rtl">
      <StepHeader
        eyebrow="צעד 4 מתוך 5"
        title="תוצאת ההצלבה"
        subtitle={`חשבונית ${result.invoiceMeta.invoiceNumber} · ביטחון OCR ${Math.round(result.invoiceMeta.ocrConfidence * 100)}%`}
      />

      {/* KPI Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="תואם"
          value={result.summary.matchedCount}
          icon={<Check className="w-5 h-5" />}
          tone="emerald"
        />
        <KpiTile
          label="שונה"
          value={result.summary.qtyDiffCount + result.summary.priceDiffCount}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="amber"
        />
        <KpiTile
          label="לא הוזמן"
          value={result.summary.unorderedCount}
          icon={<Plus className="w-5 h-5" />}
          tone="red"
        />
        <KpiTile
          label="חסר בחשבונית"
          value={result.summary.missingCount}
          icon={<Minus className="w-5 h-5" />}
          tone="slate"
        />
      </div>

      {/* Headline delta */}
      {result.summary.headlineDelta > 0 ? (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 flex items-center gap-3">
          <Zap className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">
              הפסד פוטנציאלי מההפרשים:{' '}
              <span className="tabular-nums">
                ₪{result.summary.headlineDelta.toLocaleString('he-IL')}
              </span>
            </div>
            <div className="text-xs text-amber-800/70 mt-0.5">
              עבור להתאמת כמויות כדי לקבע מה באמת הגיע ולהגדיל את החיסכון המוקפא.
            </div>
          </div>
        </div>
      ) : null}

      {/* Comparison table */}
      <div className="rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)] mb-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/70 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-right p-3 font-semibold">מוצר</th>
              <th className="text-right p-3 font-semibold">בהזמנה</th>
              <th className="text-right p-3 font-semibold">בחשבונית</th>
              <th className="text-right p-3 font-semibold">סטטוס</th>
              <th className="text-right p-3 font-semibold">פער ₪</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line, i) => (
              <tr
                key={`${line.productName}-${i}`}
                className={`recon-row border-t border-slate-100 ${rowTone(line.status)}`}
              >
                <td className="p-3 font-medium text-slate-900">
                  <span className={line.status === 'missing_from_invoice' ? 'line-through opacity-70' : ''}>
                    {line.productName}
                  </span>
                </td>
                <td className="p-3 tabular-nums text-slate-700">
                  {line.poQty !== null ? `${line.poQty} ${line.poUnit ?? ''}` : '—'}
                  {line.poUnitPrice !== null ? (
                    <span className="text-xs text-slate-400 mr-1">
                      × ₪{line.poUnitPrice}
                    </span>
                  ) : null}
                </td>
                <td className="p-3 tabular-nums text-slate-700">
                  {line.invoiceQty !== null ? `${line.invoiceQty} ${line.invoiceUnit ?? ''}` : '—'}
                  {line.invoiceUnitPrice !== null ? (
                    <span className="text-xs text-slate-400 mr-1">
                      × ₪{line.invoiceUnitPrice}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">
                  <StatusBadge status={line.status} />
                </td>
                <td className="p-3 tabular-nums">
                  {line.deltaIls > 0 ? (
                    <span className="text-red-600 font-semibold">
                      +₪{line.deltaIls.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom CTAs */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRetake}
          className="text-sm text-slate-500 hover:text-slate-800 underline underline-offset-4 decoration-slate-300"
        >
          צלם חשבונית מחדש
        </button>
        <div className="flex gap-2">
          {allGood ? (
            <button
              onClick={onQuickConfirm}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-5 py-2.5 font-medium shadow-[0_4px_12px_rgba(5,150,105,0.25)] transition-all"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              הכל תקין — אישור מהיר
            </button>
          ) : null}
          <button
            onClick={onContinueAdjust}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-2.5 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.25)] transition-all"
          >
            המשך להתאמת כמויות
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function rowTone(status: LineStatus): string {
  switch (status) {
    case 'matched':
      return 'bg-white';
    case 'qty_diff':
      return 'bg-amber-50/50';
    case 'price_diff':
      return 'bg-orange-50/50';
    case 'unordered':
      return 'bg-red-50/50';
    case 'missing_from_invoice':
      return 'bg-slate-50';
  }
}

function StatusBadge({ status }: { status: LineStatus }) {
  const map: Record<LineStatus, { label: string; tint: string; icon: React.ReactNode }> = {
    matched: {
      label: 'תואם',
      tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <Check className="w-3 h-3" strokeWidth={3} />,
    },
    qty_diff: {
      label: 'כמות שונה',
      tint: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    price_diff: {
      label: 'מחיר שונה',
      tint: 'bg-orange-50 text-orange-700 border-orange-200',
      icon: <Zap className="w-3 h-3" />,
    },
    unordered: {
      label: 'לא בהזמנה',
      tint: 'bg-red-50 text-red-700 border-red-200',
      icon: <Plus className="w-3 h-3" strokeWidth={3} />,
    },
    missing_from_invoice: {
      label: 'חסר בחשבונית',
      tint: 'bg-slate-100 text-slate-700 border-slate-200',
      icon: <X className="w-3 h-3" strokeWidth={3} />,
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${info.tint}`}
    >
      {info.icon}
      <span>{info.label}</span>
    </span>
  );
}

function KpiTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'emerald' | 'amber' | 'red' | 'slate';
}) {
  const tints = {
    emerald: { bg: 'bg-emerald-50/60', border: 'border-emerald-200/60', icon: 'text-emerald-600' },
    amber: { bg: 'bg-amber-50/60', border: 'border-amber-200/60', icon: 'text-amber-600' },
    red: { bg: 'bg-red-50/60', border: 'border-red-200/60', icon: 'text-red-600' },
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', icon: 'text-slate-500' },
  };
  const t = tints[tone];
  return (
    <div className={`kpi-card rounded-2xl border ${t.border} ${t.bg} p-4`}>
      <div className={`mb-2 ${t.icon}`}>{icon}</div>
      <div className="text-xs text-slate-500 font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
