'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  FileImage,
  MessageCircle,
  Minus,
  Plus,
  Receipt,
  ShieldAlert,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { showcase } from '@/lib/i18n/messages/showcase';
import { ilsExact } from '../../_lib/money';
import { localTime } from '../../_lib/time';
import { mockText } from '../../_lib/mockText';
import { InvoicePoCompareViewer } from '../_components/InvoicePoCompareViewer';
import { InvoiceScanViewer } from '../_components/InvoiceScanViewer';
import { fromAuditRecord, fromAuditRecordToCompare } from '../_components/scanDataAdapters';
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
  const t = useT(showcase);
  const locale = useLocale();
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

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
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-stretch"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="ml-auto w-full max-w-3xl h-full bg-bg border-l border-line shadow-[-12px_0_48px_-16px_rgba(0,0,0,0.7)] overflow-y-auto"
      >
        {/* Header */}
        <div className="glass sticky top-0 border-b border-line px-4 sm:px-6 py-4 z-10 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center font-bold text-primary shrink-0">
              {mockText(record.supplierInitials, locale)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-ink">{mockText(record.supplierName, locale)}</h2>
                <span className="text-xs text-muted font-mono">·</span>
                <span className="text-xs text-muted font-mono tabular-nums">{record.invoiceNumber}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span>{t('detail.scannedBy', { name: mockText(record.scannedBy, locale) })}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="font-mono tabular-nums">{localTime(record.scannedAt)}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-primary hover:brightness-110 text-on-primary text-xs font-semibold transition-all shadow-glow-primary"
              title={t('detail.compareButtonTitle')}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              {t('detail.compareButton')}
            </button>
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-surface-2 hover:border-primary/40 text-ink border border-line text-xs font-semibold transition-colors"
              title={t('detail.scanButtonTitle')}
            >
              <FileImage className="w-3.5 h-3.5" />
              {t('detail.scanButton')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              title={t('common.close')}
              className="w-9 h-9 rounded-full bg-surface-2 hover:bg-line text-muted flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-6 space-y-8">
          {/* Financial summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryTile
              label={t('detail.tiles.billed')}
              value={ilsExact(record.totalInvoiceIls, locale)}
              tone="neutral"
              icon={<Receipt className="w-4 h-4" />}
            />
            <SummaryTile
              label={t('detail.tiles.approved')}
              value={ilsExact(record.totalApprovedIls, locale)}
              tone={record.totalApprovedIls < record.totalInvoiceIls ? 'gold' : 'neutral'}
              icon={<Check className="w-4 h-4" strokeWidth={3} />}
            />
            <SummaryTile
              label={t('detail.tiles.saved')}
              value={ilsExact(record.savingsCapturedIls, locale)}
              tone={record.savingsCapturedIls > 0 ? 'gold' : 'neutral'}
              icon={<Sparkles className="w-4 h-4" />}
            />
          </div>

          {/* Scan + compare tiles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="detail-line relative overflow-hidden w-full text-start rounded-2xl border border-primary/30 bg-primary/8 hover:bg-primary/12 hover:border-primary/50 transition-all px-5 py-4 flex items-center gap-4 group shadow-card"
            >
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
              <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-glow-primary">
                <ClipboardList className="w-6 h-6 text-on-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink flex items-center gap-2 flex-wrap">
                  {t('detail.compareCard.title')}
                  <span className="text-[10px] bg-primary/15 text-primary ring-1 ring-primary/25 px-1.5 py-0.5 rounded font-bold">
                    {t('detail.compareCard.recommended')}
                  </span>
                </div>
                <div className="text-xs text-muted mt-0.5">{t('detail.compareCard.description')}</div>
              </div>
              <div className="text-xs text-primary font-semibold group-hover:underline shrink-0 inline-flex items-center gap-1">
                {t('common.open')}
                <ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" aria-hidden="true" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="detail-line w-full text-start rounded-2xl border border-line bg-surface-2 hover:border-warn/40 transition-all px-5 py-4 flex items-center gap-4 group"
            >
              <div className="w-14 h-14 rounded-xl bg-warn/12 border border-warn/25 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <FileImage className="w-6 h-6 text-warn" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink">{t('detail.scanCard.title')}</div>
                <div className="text-xs text-muted mt-0.5">{t('detail.scanCard.description')}</div>
              </div>
              <div className="text-xs text-warn font-semibold group-hover:underline shrink-0 inline-flex items-center gap-1">
                {t('common.open')}
                <ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" aria-hidden="true" />
              </div>
            </button>
          </div>

          {/* Discrepancies callout */}
          {issueLines.length > 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-warn/25 bg-warn/8 px-5 py-4">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-0.5 leak-gradient" />
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-5 h-5 text-warn" />
                <span className="font-semibold text-ink">
                  {issueLines.length === 1
                    ? t('detail.calloutOne')
                    : t('detail.calloutMany', { count: issueLines.length })}
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed">{t('detail.calloutBody')}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-primary/25 bg-primary/8 px-5 py-4 flex items-center gap-2">
              <Check className="w-5 h-5 text-primary" strokeWidth={3} />
              <span className="font-semibold text-ink">{t('detail.allClean')}</span>
            </div>
          )}

          {/* 3-way comparison — issues first */}
          {issueLines.length > 0 ? (
            <Section title={t('detail.sections.issues')}>
              <div className="space-y-3">
                {issueLines.map((line, i) => (
                  <ComparisonCard key={`issue-${i}`} line={line} />
                ))}
              </div>
            </Section>
          ) : null}

          {matchedLines.length > 0 ? (
            <Section title={t('detail.sections.matched', { count: matchedLines.length })} collapsible>
              <div className="space-y-2">
                {matchedLines.map((line, i) => (
                  <CompactMatchedRow key={`matched-${i}`} line={line} />
                ))}
              </div>
            </Section>
          ) : null}

          {/* Timeline */}
          <Section title={t('detail.sections.timeline')}>
            <Timeline events={record.timeline} />
          </Section>

          {/* Actions */}
          <div className="border-t border-line pt-6 flex flex-wrap items-center justify-between gap-3 sticky bottom-0 glass -mx-4 sm:-mx-6 px-4 sm:px-6 py-4">
            <button
              type="button"
              title={t('detail.demoAction')}
              className="text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
            >
              {t('detail.actions.flag')}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                title={t('detail.demoAction')}
                className="inline-flex items-center gap-2 bg-surface-2 border border-line hover:border-primary/40 hover:text-primary text-ink rounded-xl px-4 py-2 font-medium transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                {t('detail.actions.send')}
              </button>
              <button
                type="button"
                title={t('detail.demoAction')}
                className="inline-flex items-center gap-2 bg-primary hover:brightness-110 text-on-primary rounded-xl px-4 py-2 font-medium shadow-glow-primary transition-all"
              >
                <Check className="w-4 h-4" strokeWidth={3} />
                {t('detail.actions.approve')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {scanOpen ? (
        <InvoiceScanViewer
          data={fromAuditRecord(record)}
          onClose={() => setScanOpen(false)}
        />
      ) : null}

      {compareOpen
        ? (() => {
            const { data, lines } = fromAuditRecordToCompare(record);
            return (
              <InvoicePoCompareViewer
                data={data}
                lines={lines}
                invoiceScan={fromAuditRecord(record)}
                onClose={() => setCompareOpen(false)}
              />
            );
          })()
        : null}
    </div>
  );
}

function ComparisonCard({ line }: { line: LineComparison }) {
  const t = useT(showcase);
  const locale = useLocale();
  const accent = statusAccent(line.status);
  return (
    <div className={`detail-line rounded-2xl border bg-surface p-4 ${accent.border}`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="font-semibold text-ink text-base">{mockText(line.productName, locale)}</div>
          {line.note ? (
            <div className="text-xs text-muted mt-1 leading-relaxed">{mockText(line.note, locale)}</div>
          ) : null}
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${accent.tint}`}>
          {accent.icon}
          <span>{t(accent.labelKey)}</span>
        </span>
      </div>

      {/* 3-column comparison */}
      <div className="grid grid-cols-3 gap-2">
        <ComparisonColumn
          label={t('detail.columns.ordered')}
          qty={line.poQty}
          unit={mockText(line.unit, locale)}
          price={line.poUnitPrice}
          tone="slate"
        />
        <ComparisonColumn
          label={t('detail.columns.received')}
          qty={line.receivedQty}
          unit={mockText(line.unit, locale)}
          price={line.poUnitPrice}
          tone={
            line.receivedQty !== null && line.poQty !== null && line.receivedQty !== line.poQty
              ? 'amber'
              : 'slate'
          }
          highlight={line.receivedQty !== line.poQty}
        />
        <ComparisonColumn
          label={t('detail.columns.invoiced')}
          qty={line.invoiceQty}
          unit={mockText(line.unit, locale)}
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
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
          <span className="text-xs text-muted">{t('detail.variance')}</span>
          <span className="text-sm font-bold font-mono tabular-nums text-danger flex items-center gap-1">
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
    slate: 'bg-surface-2 border-line',
    amber: 'bg-warn/8 border-warn/25',
    red: 'bg-danger/8 border-danger/25',
  }[tone];
  const text = {
    slate: 'text-ink',
    amber: 'text-warn',
    red: 'text-danger',
  }[tone];

  return (
    <div className={`rounded-xl border px-3 py-2 ${bg}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
        {label}
      </div>
      {qty !== null ? (
        <div className={`font-bold font-mono tabular-nums text-base ${text} ${highlight ? '' : ''}`}>
          {qty} <span className="text-xs font-normal text-muted">{unit}</span>
        </div>
      ) : (
        <div className="text-sm text-muted italic">—</div>
      )}
      {price !== null && qty !== null ? (
        <div className="text-[10px] text-muted mt-0.5 font-mono tabular-nums">
          × ₪{price} = ₪{(qty * price).toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

function CompactMatchedRow({ line }: { line: LineComparison }) {
  const locale = useLocale();
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-primary/5 border border-primary/15">
      <div className="flex items-center gap-2 min-w-0">
        <Check className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={3} />
        <span className="text-sm font-medium text-ink truncate">{mockText(line.productName, locale)}</span>
      </div>
      <span className="text-xs text-muted font-mono tabular-nums shrink-0">
        {line.invoiceQty} {mockText(line.unit, locale)}
        {line.invoiceUnitPrice !== null ? (
          <span className="text-muted"> · ₪{(line.invoiceQty! * line.invoiceUnitPrice).toFixed(2)}</span>
        ) : null}
      </span>
    </div>
  );
}

function Timeline({ events }: { events: AuditTimelineEvent[] }) {
  const locale = useLocale();
  return (
    <div className="relative ps-4 border-s-2 border-line space-y-4">
      {events.map((e, i) => (
        <div key={i} className="timeline-event relative">
          <div className="absolute -start-[23px] top-1 w-3 h-3 rounded-full bg-surface border-2 border-primary" />
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <span className="text-sm font-semibold text-ink">{mockText(e.action, locale)}</span>
            <span className="text-xs text-muted font-mono tabular-nums shrink-0">{localTime(e.at)}</span>
          </div>
          <div className="text-xs text-muted">
            <RoleBadge role={e.role} actor={mockText(e.actor, locale)} />
            {e.detail ? <span className="ms-2">· {mockText(e.detail, locale)}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleBadge({ role, actor }: { role: AuditTimelineEvent['role']; actor: string }) {
  const map = {
    employee: { tint: 'bg-primary/12 text-primary ring-1 ring-primary/25', label: actor },
    system: { tint: 'bg-surface-2 text-muted ring-1 ring-line', label: actor },
    manager: { tint: 'bg-warn/12 text-warn ring-1 ring-warn/25', label: actor },
    owner: { tint: 'bg-gold/12 text-gold ring-1 ring-gold/25', label: actor },
  } as const;
  const info = map[role];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${info.tint}`}>
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
      <h3 className="text-sm font-semibold text-ink uppercase tracking-wider mb-3 flex items-center gap-2">
        <span>{title}</span>
        {collapsible ? <ChevronDown className="w-4 h-4 text-muted" /> : null}
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
  tone: 'neutral' | 'gold';
  icon: React.ReactNode;
}) {
  const map = {
    neutral: 'text-ink',
    gold: 'text-gold',
  };
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="text-xs text-muted font-medium flex items-center gap-1.5 mb-1">
        <span className="text-muted">{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`text-lg font-bold font-mono tabular-nums ${map[tone]}`}>{value}</div>
    </div>
  );
}

function statusAccent(status: LineComparisonStatus) {
  switch (status) {
    case 'qty_short':
      return {
        labelKey: 'lineStatus.qtyShort' as const,
        tint: 'bg-warn/12 text-warn ring-1 ring-warn/25',
        border: 'border-warn/30',
        icon: <Minus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'qty_over':
      return {
        labelKey: 'lineStatus.qtyOver' as const,
        tint: 'bg-warn/12 text-warn ring-1 ring-warn/25',
        border: 'border-warn/30',
        icon: <Plus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'price_higher':
      return {
        labelKey: 'lineStatus.priceHigher' as const,
        tint: 'bg-danger/12 text-danger ring-1 ring-danger/25',
        border: 'border-danger/30',
        icon: <ArrowUp className="w-3 h-3" />,
      };
    case 'price_lower':
      return {
        labelKey: 'lineStatus.priceLower' as const,
        tint: 'bg-primary/12 text-primary ring-1 ring-primary/25',
        border: 'border-primary/30',
        icon: <ArrowDown className="w-3 h-3" />,
      };
    case 'unordered':
      return {
        labelKey: 'lineStatus.unordered' as const,
        tint: 'bg-danger/12 text-danger ring-1 ring-danger/25',
        border: 'border-danger/30',
        icon: <Plus className="w-3 h-3" strokeWidth={3} />,
      };
    case 'missing_from_invoice':
      return {
        labelKey: 'lineStatus.missing' as const,
        tint: 'bg-surface-2 text-muted ring-1 ring-line',
        border: 'border-line',
        icon: <X className="w-3 h-3" strokeWidth={3} />,
      };
    default:
      return {
        labelKey: 'lineStatus.matched' as const,
        tint: 'bg-primary/12 text-primary ring-1 ring-primary/25',
        border: 'border-primary/30',
        icon: <Check className="w-3 h-3" strokeWidth={3} />,
      };
  }
}

