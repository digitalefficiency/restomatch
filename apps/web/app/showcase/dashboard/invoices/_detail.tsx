'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  MessageCircle,
  Minus,
  Plus,
  Receipt,
  ShieldAlert,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  AuditTimelineEvent,
  InvoiceAuditRecord,
  LineComparison,
  LineComparisonStatus,
} from './_mock';

interface Props {
  record: InvoiceAuditRecord;
  onClose: () => void;
}

export function InvoiceDetail({ record, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2 });
      gsap.fromTo(
        sheetRef.current,
        { x: -40, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' },
      );
      gsap.from('.detail-line', {
        x: -16,
        opacity: 0,
        stagger: 0.04,
        duration: 0.35,
        ease: 'power2.out',
        delay: 0.2,
      });
      gsap.from('.timeline-event', {
        opacity: 0,
        x: 16,
        stagger: 0.06,
        duration: 0.4,
        ease: 'power2.out',
        delay: 0.3,
      });
    },
    { dependencies: [record.id] },
  );

  // Body scroll lock while detail is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const issueLines = record.lines.filter((l) => l.status !== 'matched');
  const matchedLines = record.lines.filter((l) => l.status === 'matched');

  return (
    <div
      ref={overlayRef}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-stretch"
      dir="rtl"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="ml-auto w-full max-w-3xl h-full bg-white shadow-[-12px_0_48px_-16px_rgba(15,23,42,0.18)] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-slate-200/70 px-6 py-4 z-10 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/70 flex items-center justify-center font-bold text-blue-700 shrink-0">
              {record.supplierInitials}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-slate-900">{record.supplierName}</h2>
                <span className="text-xs text-slate-400 font-mono">·</span>
                <span className="text-xs text-slate-500 font-mono">{record.invoiceNumber}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span>נסרק ע״י {record.scannedBy}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="tabular-nums">
                    {new Date(record.scannedAt).toLocaleTimeString('he-IL', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-8">
          {/* Financial summary */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryTile
              label="חויב בחשבונית"
              value={`₪${record.totalInvoiceIls.toLocaleString('he-IL')}`}
              tone="slate"
              icon={<Receipt className="w-4 h-4" />}
            />
            <SummaryTile
              label="אושר ע״י העובד"
              value={`₪${record.totalApprovedIls.toLocaleString('he-IL')}`}
              tone={record.totalApprovedIls < record.totalInvoiceIls ? 'emerald' : 'slate'}
              icon={<Check className="w-4 h-4" strokeWidth={3} />}
            />
            <SummaryTile
              label="חיסכון שתועד"
              value={`₪${record.savingsCapturedIls.toLocaleString('he-IL')}`}
              tone={record.savingsCapturedIls > 0 ? 'emerald' : 'slate'}
              icon={<Sparkles className="w-4 h-4" />}
            />
          </div>

          {/* Discrepancies callout */}
          {issueLines.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-5 h-5 text-amber-700" />
                <span className="font-semibold text-amber-900">
                  {issueLines.length} חריגות זוהו בחשבונית הזו
                </span>
              </div>
              <p className="text-xs text-amber-800/80 leading-relaxed">
                לחץ על כל שורה כדי לראות את ההשוואה המלאה — מה הזמנת, מה הגיע בפועל, מה הספק חייב.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-700" strokeWidth={3} />
              <span className="font-semibold text-emerald-900">
                כל הפריטים תאמו. אין חריגות.
              </span>
            </div>
          )}

          {/* 3-way comparison — issues first */}
          {issueLines.length > 0 ? (
            <Section title="חריגות לבדיקה">
              <div className="space-y-3">
                {issueLines.map((line, i) => (
                  <ComparisonCard key={`issue-${i}`} line={line} />
                ))}
              </div>
            </Section>
          ) : null}

          {matchedLines.length > 0 ? (
            <Section title={`פריטים תואמים · ${matchedLines.length}`} collapsible>
              <div className="space-y-2">
                {matchedLines.map((line, i) => (
                  <CompactMatchedRow key={`matched-${i}`} line={line} />
                ))}
              </div>
            </Section>
          ) : null}

          {/* Timeline */}
          <Section title="לוח אירועים">
            <Timeline events={record.timeline} />
          </Section>

          {/* Actions */}
          <div className="border-t border-slate-200 pt-6 flex items-center justify-between gap-3 sticky bottom-0 bg-white/90 backdrop-blur-xl -mx-6 px-6 py-4">
            <button
              type="button"
              className="text-sm text-slate-500 hover:text-slate-800 underline underline-offset-4 decoration-slate-300"
            >
              סמן לבדיקת ספק
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl px-4 py-2 font-medium transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                שלח לספק
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.25)] transition-all"
              >
                <Check className="w-4 h-4" strokeWidth={3} />
                אשר ושלם
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComparisonCard({ line }: { line: LineComparison }) {
  const accent = statusAccent(line.status);
  return (
    <div className={`detail-line rounded-2xl border bg-white p-4 ${accent.border}`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="font-semibold text-slate-900 text-base">{line.productName}</div>
          {line.note ? (
            <div className="text-xs text-slate-500 mt-1 leading-relaxed">{line.note}</div>
          ) : null}
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${accent.tint}`}>
          {accent.icon}
          <span>{accent.label}</span>
        </span>
      </div>

      {/* 3-column comparison */}
      <div className="grid grid-cols-3 gap-2">
        <ComparisonColumn
          label="הוזמן"
          qty={line.poQty}
          unit={line.unit}
          price={line.poUnitPrice}
          tone="slate"
        />
        <ComparisonColumn
          label="התקבל בפועל"
          qty={line.receivedQty}
          unit={line.unit}
          price={line.poUnitPrice}
          tone={
            line.receivedQty !== null && line.poQty !== null && line.receivedQty !== line.poQty
              ? 'amber'
              : 'slate'
          }
          highlight={line.receivedQty !== line.poQty}
        />
        <ComparisonColumn
          label="חויב בחשבונית"
          qty={line.invoiceQty}
          unit={line.unit}
          price={line.invoiceUnitPrice}
          tone={
            line.status === 'price_higher' || line.status === 'qty_over' || line.status === 'unordered'
              ? 'red'
              : 'slate'
          }
          highlight={line.status === 'price_higher' || line.invoiceQty !== line.poQty}
        />
      </div>

      {/* Variance bar */}
      {line.variance > 0 ? (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">הפרש כספי</span>
          <span className="text-sm font-bold tabular-nums text-red-600 flex items-center gap-1">
            <ArrowUp className="w-3.5 h-3.5" />₪{line.variance.toFixed(2)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ComparisonColumn({
  label,
  qty,
  unit,
  price,
  tone,
  highlight,
}: {
  label: string;
  qty: number | null;
  unit: string;
  price: number | null;
  tone: 'slate' | 'amber' | 'red';
  highlight?: boolean;
}) {
  const bg = {
    slate: 'bg-slate-50 border-slate-100',
    amber: 'bg-amber-50/60 border-amber-200/60',
    red: 'bg-red-50/60 border-red-200/60',
  }[tone];
  const text = {
    slate: 'text-slate-900',
    amber: 'text-amber-900',
    red: 'text-red-700',
  }[tone];

  return (
    <div className={`rounded-xl border px-3 py-2 ${bg}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
        {label}
      </div>
      {qty !== null ? (
        <div className={`font-bold tabular-nums text-base ${text} ${highlight ? '' : ''}`}>
          {qty} <span className="text-xs font-normal text-slate-500">{unit}</span>
        </div>
      ) : (
        <div className="text-sm text-slate-400 italic">—</div>
      )}
      {price !== null && qty !== null ? (
        <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
          × ₪{price} = ₪{(qty * price).toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

function CompactMatchedRow({ line }: { line: LineComparison }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-emerald-50/40 border border-emerald-100/70">
      <div className="flex items-center gap-2">
        <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} />
        <span className="text-sm font-medium text-slate-800">{line.productName}</span>
      </div>
      <span className="text-xs text-slate-500 tabular-nums">
        {line.invoiceQty} {line.unit}
        {line.invoiceUnitPrice !== null ? (
          <span className="text-slate-400"> · ₪{(line.invoiceQty! * line.invoiceUnitPrice).toFixed(2)}</span>
        ) : null}
      </span>
    </div>
  );
}

function Timeline({ events }: { events: AuditTimelineEvent[] }) {
  return (
    <div className="relative pr-4 border-r-2 border-slate-200/70 space-y-4">
      {events.map((e, i) => (
        <div key={i} className="timeline-event relative">
          <div className="absolute -right-[22px] top-1 w-3 h-3 rounded-full bg-white border-2 border-blue-500" />
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-800">{e.action}</span>
            <span className="text-xs text-slate-500 tabular-nums shrink-0">
              {new Date(e.at).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            <RoleBadge role={e.role} actor={e.actor} />
            {e.detail ? <span className="mr-2">· {e.detail}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleBadge({ role, actor }: { role: AuditTimelineEvent['role']; actor: string }) {
  const map = {
    employee: { tint: 'bg-blue-50 text-blue-700 border-blue-200', label: actor },
    system: { tint: 'bg-slate-50 text-slate-700 border-slate-200', label: 'מערכת' },
    manager: { tint: 'bg-amber-50 text-amber-700 border-amber-200', label: actor },
    owner: { tint: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: actor },
  } as const;
  const info = map[role];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${info.tint}`}>
      {info.label}
    </span>
  );
}

function Section({
  title,
  children,
  collapsible,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
        <span>{title}</span>
        {collapsible ? <ChevronDown className="w-4 h-4 text-slate-400" /> : null}
      </h3>
      {children}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: 'slate' | 'emerald';
  icon: React.ReactNode;
}) {
  const map = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
  };
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3">
      <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mb-1">
        <span className="text-slate-400">{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`text-lg font-bold tabular-nums ${map[tone]}`}>{value}</div>
    </div>
  );
}

function statusAccent(status: LineComparisonStatus) {
  switch (status) {
    case 'qty_short':
      return {
        label: 'התקבל פחות',
        tint: 'bg-amber-50 text-amber-700 border-amber-200',
        border: 'border-amber-200/60',
        icon: <Minus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'qty_over':
      return {
        label: 'התקבל יותר',
        tint: 'bg-amber-50 text-amber-700 border-amber-200',
        border: 'border-amber-200/60',
        icon: <Plus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'price_higher':
      return {
        label: 'מחיר גבוה',
        tint: 'bg-red-50 text-red-700 border-red-200',
        border: 'border-red-200/60',
        icon: <ArrowUp className="w-3 h-3" />,
      };
    case 'price_lower':
      return {
        label: 'מחיר נמוך',
        tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        border: 'border-emerald-200/60',
        icon: <ArrowDown className="w-3 h-3" />,
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

void AlertTriangle;
