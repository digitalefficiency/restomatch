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
          tone="primary"
        />
        <KpiTile
          label="שונה"
          value={result.summary.qtyDiffCount + result.summary.priceDiffCount}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="warn"
        />
        <KpiTile
          label="לא הוזמן"
          value={result.summary.unorderedCount}
          icon={<Plus className="w-5 h-5" />}
          tone="danger"
        />
        <KpiTile
          label="חסר בחשבונית"
          value={result.summary.missingCount}
          icon={<Minus className="w-5 h-5" />}
          tone="neutral"
        />
      </div>

      {/* Headline delta */}
      {result.summary.headlineDelta > 0 ? (
        <div className="mb-6 relative overflow-hidden rounded-2xl border border-warn/25 bg-warn/8 px-5 py-4 flex items-center gap-3">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-0.5 leak-gradient" />
          <Zap className="w-5 h-5 text-warn shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink">
              הפסד פוטנציאלי מההפרשים:{' '}
              <span className="font-mono tabular-nums text-danger">
                ₪{result.summary.headlineDelta.toLocaleString('he-IL')}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5">
              עבור להתאמת כמויות כדי לקבע מה באמת הגיע ולהגדיל את החיסכון המוקפא.
            </div>
          </div>
        </div>
      ) : null}

      {/* Comparison table */}
      <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-card mb-6">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-subtle text-xs uppercase tracking-wider">
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
                className={`recon-row border-t border-line ${rowTone(line.status)}`}
              >
                <td className="p-3 font-medium text-ink">
                  <span className={line.status === 'missing_from_invoice' ? 'line-through opacity-70' : ''}>
                    {line.productName}
                  </span>
                </td>
                <td className="p-3 font-mono tabular-nums text-muted">
                  {line.poQty !== null ? `${line.poQty} ${line.poUnit ?? ''}` : '—'}
                  {line.poUnitPrice !== null ? (
                    <span className="text-xs text-subtle mr-1">
                      × ₪{line.poUnitPrice}
                    </span>
                  ) : null}
                </td>
                <td className="p-3 font-mono tabular-nums text-muted">
                  {line.invoiceQty !== null ? `${line.invoiceQty} ${line.invoiceUnit ?? ''}` : '—'}
                  {line.invoiceUnitPrice !== null ? (
                    <span className="text-xs text-subtle mr-1">
                      × ₪{line.invoiceUnitPrice}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">
                  <StatusBadge status={line.status} />
                </td>
                <td className="p-3 font-mono tabular-nums">
                  {line.deltaIls > 0 ? (
                    <span className="text-danger font-semibold">
                      +₪{line.deltaIls.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
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
          className="text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
        >
          צלם חשבונית מחדש
        </button>
        <div className="flex gap-2">
          {allGood ? (
            <button
              onClick={onQuickConfirm}
              className="inline-flex items-center gap-2 bg-gold hover:brightness-110 text-on-primary rounded-xl px-5 py-2.5 font-medium shadow-glow-gold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-gold"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              הכל תקין — אישור מהיר
            </button>
          ) : null}
          <button
            onClick={onContinueAdjust}
            className="inline-flex items-center gap-2 bg-primary hover:brightness-110 text-on-primary rounded-xl px-5 py-2.5 font-medium shadow-glow-primary transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
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
      return 'bg-surface';
    case 'qty_diff':
      return 'bg-warn/8';
    case 'price_diff':
      return 'bg-warn/8';
    case 'unordered':
      return 'bg-danger/8';
    case 'missing_from_invoice':
      return 'bg-surface-2';
  }
}

function StatusBadge({ status }: { status: LineStatus }) {
  const map: Record<LineStatus, { label: string; tint: string; icon: React.ReactNode }> = {
    matched: {
      label: 'תואם',
      tint: 'bg-primary/12 text-primary ring-1 ring-primary/25',
      icon: <Check className="w-3 h-3" strokeWidth={3} />,
    },
    qty_diff: {
      label: 'כמות שונה',
      tint: 'bg-warn/12 text-warn ring-1 ring-warn/25',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    price_diff: {
      label: 'מחיר שונה',
      tint: 'bg-warn/12 text-warn ring-1 ring-warn/25',
      icon: <Zap className="w-3 h-3" />,
    },
    unordered: {
      label: 'לא בהזמנה',
      tint: 'bg-danger/12 text-danger ring-1 ring-danger/25',
      icon: <Plus className="w-3 h-3" strokeWidth={3} />,
    },
    missing_from_invoice: {
      label: 'חסר בחשבונית',
      tint: 'bg-surface-2 text-muted ring-1 ring-line',
      icon: <X className="w-3 h-3" strokeWidth={3} />,
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${info.tint}`}
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
  tone: 'primary' | 'warn' | 'danger' | 'neutral';
}) {
  const tints = {
    primary: { bg: 'bg-primary/8', border: 'border-primary/25', icon: 'text-primary', value: 'text-ink' },
    warn: { bg: 'bg-warn/8', border: 'border-warn/25', icon: 'text-warn', value: 'text-ink' },
    danger: { bg: 'bg-danger/8', border: 'border-danger/25', icon: 'text-danger', value: 'text-danger' },
    neutral: { bg: 'bg-surface-2', border: 'border-line', icon: 'text-muted', value: 'text-ink' },
  };
  const t = tints[tone];
  return (
    <div className={`kpi-card rounded-2xl border ${t.border} ${t.bg} p-4`}>
      <div className={`mb-2 ${t.icon}`}>{icon}</div>
      <div className="text-xs text-muted font-medium mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${t.value}`}>{value}</div>
    </div>
  );
}
