'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  FileCheck2,
  Receipt,
  ShieldAlert,
  Sparkles,
  User,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { showcase } from '@/lib/i18n/messages/showcase';
import { formatIls } from '@/lib/money';
import { ilsExact } from '../../_lib/money';
import { localTime } from '../../_lib/time';
import { mockText } from '../../_lib/mockText';
import {
  MOCK_INVOICE_AUDITS,
  statsForToday,
  type InvoiceAuditRecord,
  type InvoiceAuditStatus,
} from './_mock';
import { InvoiceDetail } from './_detail';

type FilterStatus = 'all' | 'has_issues' | 'clean' | 'blocked';

export default function InvoiceAuditPage() {
  const t = useT(showcase);
  const locale = useLocale();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => statsForToday(MOCK_INVOICE_AUDITS), []);

  const filtered = useMemo(() => {
    if (filter === 'all') return MOCK_INVOICE_AUDITS;
    if (filter === 'clean')
      return MOCK_INVOICE_AUDITS.filter((r) => r.discrepanciesCount === 0);
    if (filter === 'blocked')
      return MOCK_INVOICE_AUDITS.filter((r) => r.status === 'blocked');
    return MOCK_INVOICE_AUDITS.filter((r) => r.discrepanciesCount > 0);
  }, [filter]);

  const selected = MOCK_INVOICE_AUDITS.find((r) => r.id === selectedId) ?? null;

  useGSAP(
    () => {
      gsap.from('.audit-kpi', {
        y: 16,
        opacity: 0,
        stagger: 0.06,
        duration: 0.5,
        ease: 'power3.out',
      });
      gsap.from('.audit-row', {
        x: -10,
        opacity: 0,
        stagger: 0.05,
        duration: 0.4,
        ease: 'power2.out',
        delay: 0.15,
      });
    },
    { scope: containerRef, dependencies: [filter] },
  );

  return (
    <main ref={containerRef} className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <div className="mb-2 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <p className="text-xs uppercase ltr:tracking-[0.18em] rtl:text-sm text-primary font-semibold mb-2">
          {t('invoices.eyebrow')}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink mb-2">
          {t('invoices.title')}
        </h1>
        <p className="text-muted max-w-2xl">{t('invoices.lead')}</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label={t('invoices.kpi.scanned')}
          value={stats.totalScanned.toString()}
          icon={<Receipt className="w-5 h-5" />}
          tone="blue"
        />
        <KpiCard
          label={t('invoices.kpi.withIssues')}
          value={stats.withDiscrepancies.toString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="amber"
          subtitle={t('invoices.kpi.withIssuesSub', {
            pct: Math.round((stats.withDiscrepancies / Math.max(stats.totalScanned, 1)) * 100),
          })}
        />
        <KpiCard
          label={t('invoices.kpi.saved')}
          value={formatIls(stats.savingsCaptured, { locale })}
          icon={<Wallet className="w-5 h-5" />}
          tone="gold"
          subtitle={t('invoices.kpi.savedSub')}
        />
        <KpiCard
          label={t('invoices.kpi.action')}
          value={stats.openIssues.toString()}
          icon={<ShieldAlert className="w-5 h-5" />}
          tone="red"
          subtitle={t('invoices.kpi.actionSub')}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted font-medium me-2">{t('invoices.filter.label')}</span>
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={t('invoices.filter.all', { count: MOCK_INVOICE_AUDITS.length })}
        />
        <FilterChip
          active={filter === 'has_issues'}
          onClick={() => setFilter('has_issues')}
          label={t('invoices.filter.issues', {
            count: MOCK_INVOICE_AUDITS.filter((r) => r.discrepanciesCount > 0).length,
          })}
        />
        <FilterChip
          active={filter === 'clean'}
          onClick={() => setFilter('clean')}
          label={t('invoices.filter.clean', {
            count: MOCK_INVOICE_AUDITS.filter((r) => r.discrepanciesCount === 0).length,
          })}
        />
        <FilterChip
          active={filter === 'blocked'}
          onClick={() => setFilter('blocked')}
          label={t('invoices.filter.blocked', {
            count: MOCK_INVOICE_AUDITS.filter((r) => r.status === 'blocked').length,
          })}
        />
      </div>

      {/* Invoice list */}
      <div className="grid gap-3">
        {filtered.map((record) => (
          <InvoiceRow
            key={record.id}
            record={record}
            isExpanded={selectedId === record.id}
            onToggle={() => setSelectedId(selectedId === record.id ? null : record.id)}
          />
        ))}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-10 text-center text-muted">
            {t('invoices.filter.empty')}
          </div>
        ) : null}
      </div>

      {selected ? <InvoiceDetail record={selected} onClose={() => setSelectedId(null)} /> : null}
    </main>
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  icon,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: 'blue' | 'amber' | 'gold' | 'red';
}) {
  const map = {
    blue: { icon: 'bg-info/12 text-info ring-info/25', value: 'text-ink', glow: 'glow-primary-blob' },
    amber: { icon: 'bg-warn/12 text-warn ring-warn/25', value: 'text-ink', glow: 'glow-gold-blob' },
    gold: { icon: 'bg-gold/12 text-gold ring-gold/25', value: 'text-gold', glow: 'glow-gold-blob' },
    red: { icon: 'bg-danger/12 text-danger ring-danger/25', value: 'text-danger', glow: 'glow-danger-blob' },
  } as const;
  const t = map[tone];
  return (
    <div className="audit-kpi relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl ring-1 flex items-center justify-center ${t.icon}`}>
          {icon}
        </div>
      </div>
      <div className="text-xs uppercase tracking-wider text-muted font-semibold mb-1">
        {label}
      </div>
      <div className={`font-mono text-3xl font-extrabold tabular-nums mb-1 ${t.value}`}>{value}</div>
      {subtitle ? <div className="text-xs text-muted">{subtitle}</div> : null}
      <div
        className={`pointer-events-none absolute -bottom-10 -start-10 w-40 h-40 rounded-full blur-2xl opacity-60 ${t.glow}`}
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        active
          ? 'bg-primary border-primary text-on-primary shadow-glow-primary'
          : 'bg-surface-2 border-line text-muted hover:text-ink hover:border-primary/40'
      }`}
    >
      {label}
    </button>
  );
}

function InvoiceRow({
  record,
  isExpanded,
  onToggle,
}: {
  record: InvoiceAuditRecord;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const t = useT(showcase);
  const locale = useLocale();
  const statusInfo = statusBadge(record.status);
  const supplierName = mockText(record.supplierName, locale);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`audit-row w-full text-start rounded-2xl border bg-surface px-4 sm:px-5 py-4 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        isExpanded
          ? 'border-primary/50 shadow-glow-primary'
          : 'border-line hover:border-primary/40 shadow-card'
      }`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <Link
          href={`/showcase/dashboard/suppliers/${record.supplierId}`}
          onClick={(e) => e.stopPropagation()}
          className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center font-bold text-primary shrink-0 hover:bg-primary/20 transition-colors"
          title={t('invoices.row.supplierLink', { name: supplierName })}
        >
          {mockText(record.supplierInitials, locale)}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Link
              href={`/showcase/dashboard/suppliers/${record.supplierId}`}
              onClick={(e) => e.stopPropagation()}
              className="group inline-flex items-center gap-1 font-semibold text-ink text-base hover:text-primary transition-colors"
            >
              <span>{supplierName}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-muted group-hover:text-primary transition-colors rtl:-scale-x-100" />
            </Link>
            <span className="text-xs text-muted font-mono">·</span>
            <span className="text-xs text-muted font-mono tabular-nums">{record.invoiceNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.tint} ms-2`}>
              {t(statusInfo.labelKey)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className="font-mono tabular-nums">{localTime(record.scannedAt)}</span>
            </span>
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{mockText(record.scannedBy, locale)}</span>
            </span>
            <span className="flex items-center gap-1">
              <FileCheck2 className="w-3 h-3" />
              <span className="font-mono tabular-nums">
                {t('invoices.row.items', { count: record.lines.length })}
              </span>
            </span>
            {record.discrepanciesCount > 0 ? (
              <span className="flex items-center gap-1 text-warn font-semibold">
                <AlertTriangle className="w-3 h-3" />
                <span className="font-mono tabular-nums">
                  {record.discrepanciesCount === 1
                    ? t('common.varianceOne')
                    : t('common.varianceMany', { count: record.discrepanciesCount })}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-primary">
                <Check className="w-3 h-3" strokeWidth={3} />
                <span>{t('invoices.row.clean')}</span>
              </span>
            )}
          </div>
        </div>
        <div className="text-end shrink-0">
          <div className="text-[10px] text-muted uppercase tracking-wider font-semibold">
            {t('invoices.row.billed')}
          </div>
          <div className="font-mono font-bold tabular-nums text-ink">
            {ilsExact(record.totalInvoiceIls, locale)}
          </div>
          {record.totalApprovedIls !== record.totalInvoiceIls ? (
            <div className="text-[10px] text-muted mt-0.5">
              {t('invoices.row.approved')}{' '}
              <span className="font-semibold font-mono tabular-nums text-gold">
                {ilsExact(record.totalApprovedIls, locale)}
              </span>
            </div>
          ) : null}
          {record.savingsCapturedIls > 0 ? (
            <div className="text-[10px] text-gold font-semibold mt-0.5 font-mono tabular-nums flex items-center gap-1 justify-end">
              <Sparkles className="w-3 h-3" />
              {t('invoices.row.saved', {
                amount: ilsExact(record.savingsCapturedIls, locale),
              })}
            </div>
          ) : null}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-muted transition-transform shrink-0 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </div>
    </div>
  );
}

function statusBadge(status: InvoiceAuditStatus): {
  labelKey: `invoiceStatus.${InvoiceAuditStatus}`;
  tint: string;
} {
  switch (status) {
    case 'clean':
      return { labelKey: 'invoiceStatus.clean', tint: 'bg-primary/12 text-primary ring-1 ring-primary/25' };
    case 'minor':
      return { labelKey: 'invoiceStatus.minor', tint: 'bg-surface-2 text-muted ring-1 ring-line' };
    case 'major':
      return { labelKey: 'invoiceStatus.major', tint: 'bg-warn/12 text-warn ring-1 ring-warn/25' };
    case 'blocked':
      return { labelKey: 'invoiceStatus.blocked', tint: 'bg-danger/12 text-danger ring-1 ring-danger/25' };
  }
}
