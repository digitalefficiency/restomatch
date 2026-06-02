'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  FileCheck2,
  Receipt,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import {
  MOCK_INVOICE_AUDITS,
  statsForToday,
  type InvoiceAuditRecord,
  type InvoiceAuditStatus,
} from './_mock';
import { InvoiceDetail } from './_detail';

type FilterStatus = 'all' | 'has_issues' | 'clean' | 'blocked';

export default function InvoiceAuditPage() {
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
    <main ref={containerRef} className="max-w-7xl mx-auto px-6 py-10 space-y-8" dir="rtl">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-teal-600 font-semibold mb-2">
          ביקורת בעלים
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-stone-900 mb-2">
          חשבוניות שעברו דרך הצוות
        </h1>
        <p className="text-stone-500 max-w-2xl">
          מה הספקים חייבו, מה הצוות אישר בפועל, ואיפה היו פערים. לחץ על חשבונית כדי לראות
          את ההשוואה המלאה.
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="נסרקו היום"
          value={stats.totalScanned.toString()}
          icon={<Receipt className="w-5 h-5" />}
          tone="blue"
        />
        <KpiCard
          label="עם חריגות"
          value={stats.withDiscrepancies.toString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="amber"
          subtitle={`${Math.round((stats.withDiscrepancies / Math.max(stats.totalScanned, 1)) * 100)}% מהחשבוניות`}
        />
        <KpiCard
          label="נחסך עקב בדיקה"
          value={`₪${stats.savingsCaptured.toLocaleString('he-IL')}`}
          icon={<Wallet className="w-5 h-5" />}
          tone="emerald"
          subtitle="פערים שהעובד תפס לפני שמירה"
        />
        <KpiCard
          label="פעולה דרושה"
          value={stats.openIssues.toString()}
          icon={<ShieldAlert className="w-5 h-5" />}
          tone="red"
          subtitle="ממתינים להחלטה שלך"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-stone-500 font-medium ml-2">סנן:</span>
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={`הכל · ${MOCK_INVOICE_AUDITS.length}`}
        />
        <FilterChip
          active={filter === 'has_issues'}
          onClick={() => setFilter('has_issues')}
          label={`עם חריגות · ${MOCK_INVOICE_AUDITS.filter((r) => r.discrepanciesCount > 0).length}`}
        />
        <FilterChip
          active={filter === 'clean'}
          onClick={() => setFilter('clean')}
          label={`תקינות · ${MOCK_INVOICE_AUDITS.filter((r) => r.discrepanciesCount === 0).length}`}
        />
        <FilterChip
          active={filter === 'blocked'}
          onClick={() => setFilter('blocked')}
          label={`חסומות · ${MOCK_INVOICE_AUDITS.filter((r) => r.status === 'blocked').length}`}
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
          <div className="rounded-2xl border border-stone-200/70 bg-white/80 p-10 text-center text-stone-500">
            אין חשבוניות שעונות לסינון.
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
  tone: 'blue' | 'amber' | 'emerald' | 'red';
}) {
  const map = {
    blue: 'bg-teal-50 text-teal-700 ring-teal-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
  } as const;
  return (
    <div className="audit-kpi rounded-2xl border border-stone-200/70 bg-white/90 backdrop-blur-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl ring-1 flex items-center justify-center ${map[tone]}`}>
          {icon}
        </div>
      </div>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1">
        {label}
      </div>
      <div className="text-3xl font-bold tabular-nums text-stone-900 mb-1">{value}</div>
      {subtitle ? <div className="text-xs text-stone-500">{subtitle}</div> : null}
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
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
        active
          ? 'bg-teal-600 border-teal-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.25)]'
          : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50 hover:border-stone-300'
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
  const statusInfo = statusBadge(record.status);
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
      className={`audit-row w-full text-right rounded-2xl border bg-white/90 backdrop-blur-xl px-5 py-4 transition-all cursor-pointer ${
        isExpanded
          ? 'border-teal-400 shadow-[0_2px_8px_rgba(37,99,235,0.12),0_16px_36px_-12px_rgba(37,99,235,0.18)]'
          : 'border-stone-200/70 hover:border-teal-300 hover:bg-teal-50/20 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]'
      }`}
    >
      <div className="flex items-center gap-4">
        <Link
          href={`/showcase/dashboard/suppliers/${record.supplierId}`}
          onClick={(e) => e.stopPropagation()}
          className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-100 to-teal-50 border border-teal-200/70 flex items-center justify-center font-bold text-teal-700 shrink-0 hover:from-teal-200 hover:to-teal-100 hover:border-teal-300 transition-colors"
          title={`לעמוד הספק ${record.supplierName}`}
        >
          {record.supplierInitials}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Link
              href={`/showcase/dashboard/suppliers/${record.supplierId}`}
              onClick={(e) => e.stopPropagation()}
              className="group inline-flex items-center gap-1 font-semibold text-stone-900 text-base hover:text-teal-700 transition-colors"
            >
              <span>{record.supplierName}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-teal-600 transition-colors" />
            </Link>
            <span className="text-xs text-stone-400 font-mono">·</span>
            <span className="text-xs text-stone-500 font-mono">{record.invoiceNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusInfo.tint} mr-2`}>
              {statusInfo.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-stone-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className="tabular-nums">
                {new Date(record.scannedAt).toLocaleTimeString('he-IL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{record.scannedBy}</span>
            </span>
            <span className="flex items-center gap-1">
              <FileCheck2 className="w-3 h-3" />
              <span className="tabular-nums">{record.lines.length} פריטים</span>
            </span>
            {record.discrepanciesCount > 0 ? (
              <span className="flex items-center gap-1 text-amber-700 font-semibold">
                <AlertTriangle className="w-3 h-3" />
                <span className="tabular-nums">{record.discrepanciesCount} חריגות</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-700">
                <Check className="w-3 h-3" strokeWidth={3} />
                <span>תקין</span>
              </span>
            )}
          </div>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-stone-400 uppercase tracking-wider font-semibold">חויב</div>
          <div className="font-bold tabular-nums text-stone-900">
            ₪{record.totalInvoiceIls.toLocaleString('he-IL')}
          </div>
          {record.totalApprovedIls !== record.totalInvoiceIls ? (
            <div className="text-[10px] text-stone-500 mt-0.5">
              אושר{' '}
              <span className="font-semibold tabular-nums text-emerald-700">
                ₪{record.totalApprovedIls.toLocaleString('he-IL')}
              </span>
            </div>
          ) : null}
          {record.savingsCapturedIls > 0 ? (
            <div className="text-[10px] text-emerald-700 font-semibold mt-0.5 tabular-nums flex items-center gap-1 justify-end">
              <Sparkles className="w-3 h-3" />
              ₪{record.savingsCapturedIls.toLocaleString('he-IL')} נחסכו
            </div>
          ) : null}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-stone-400 transition-transform shrink-0 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </div>
    </div>
  );
}

function statusBadge(status: InvoiceAuditStatus): { label: string; tint: string } {
  switch (status) {
    case 'clean':
      return { label: 'תקין', tint: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'minor':
      return { label: 'הערה', tint: 'bg-stone-50 text-stone-700 border-stone-200' };
    case 'major':
      return { label: 'חריגות', tint: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'blocked':
      return { label: 'תשלום נחסם', tint: 'bg-red-50 text-red-700 border-red-200' };
  }
}

// Silence unused import warnings (icons referenced via JSX in _detail)
void TrendingUp;
void X;
void ArrowLeft;
