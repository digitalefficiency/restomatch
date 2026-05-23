'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Calendar,
  Check,
  Clock,
  CreditCard,
  FileImage,
  FileText,
  Mail,
  MessageCircle,
  Minus,
  Phone,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { use, useRef, useState } from 'react';
import { InvoiceScanViewer } from '../../_components/InvoiceScanViewer';
import { fromSupplierInvoiceListItem } from '../../_components/scanDataAdapters';
import {
  getSupplierProfile,
  type ActivityEvent,
  type PriceTrendProduct,
  type SupplierInvoiceListItem,
  type SupplierProfile,
} from './_mock';

interface PageProps {
  params: Promise<{ supplierId: string }>;
}

export default function SupplierDetailPage({ params }: PageProps) {
  const { supplierId } = use(params);
  const profile = getSupplierProfile(supplierId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanInvoiceId, setScanInvoiceId] = useState<string | null>(null);

  useGSAP(
    () => {
      gsap.from('.detail-block', {
        y: 20,
        opacity: 0,
        stagger: 0.08,
        duration: 0.5,
        ease: 'power3.out',
      });
    },
    { scope: containerRef },
  );

  if (!profile) {
    notFound();
  }

  const { metadata, kpi, topProducts, recentInvoices, activity } = profile;
  const spendDelta = kpi.monthSpendIls - kpi.prevMonthSpendIls;
  const spendDeltaPct = (spendDelta / kpi.prevMonthSpendIls) * 100;

  return (
    <main ref={containerRef} className="max-w-7xl mx-auto px-6 py-10 space-y-8" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link
          href="/showcase/dashboard/invoices"
          className="hover:text-blue-600 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          ביקורת חשבוניות
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-medium">{metadata.name}</span>
      </div>

      {/* Hero */}
      <section className="detail-block grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: identity */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/70 flex items-center justify-center text-2xl font-bold text-blue-700">
                {metadata.initials}
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-1">
                  {metadata.name}
                </h1>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                    {metadata.category}
                  </span>
                  <span>·</span>
                  <span>ח״פ {metadata.businessId}</span>
                  <span>·</span>
                  <span>פעיל מ-{metadata.activeSince}</span>
                </div>
              </div>
            </div>
            <StatusPill kpi={kpi} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <ContactRow icon={<Phone className="w-3.5 h-3.5" />} label="טלפון" value={metadata.contactPhone} />
            <ContactRow icon={<Mail className="w-3.5 h-3.5" />} label="מייל" value={metadata.contactEmail} />
            <ContactRow
              icon={<Truck className="w-3.5 h-3.5" />}
              label="אספקה"
              value={metadata.deliverySchedule}
            />
            <ContactRow
              icon={<CreditCard className="w-3.5 h-3.5" />}
              label="תנאי תשלום"
              value={metadata.paymentTerms}
            />
          </div>
        </div>

        {/* Right: action panel */}
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)] flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
            פעולות
          </h2>
          <ActionButton
            icon={<MessageCircle className="w-4 h-4" />}
            label="פתח WhatsApp"
            primary
          />
          <ActionButton icon={<Phone className="w-4 h-4" />} label="התקשר עכשיו" />
          <ActionButton icon={<FileText className="w-4 h-4" />} label="בקש עדכון מחירון" />
          <ActionButton
            icon={<ShieldAlert className="w-4 h-4" />}
            label="פתח דיון על חריגה"
            danger
          />
        </div>
      </section>

      {/* KPI strip */}
      <section className="detail-block grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="משלוחים נקיים"
          value={`${kpi.cleanDeliveryPct}%`}
          icon={<Check className="w-5 h-5" />}
          tone={kpi.cleanDeliveryPct >= kpi.cleanDeliveryRestaurantAvg ? 'emerald' : 'amber'}
          subtitle={`ממוצע המסעדה: ${kpi.cleanDeliveryRestaurantAvg}%`}
        />
        <KpiCard
          label="סטיית מחיר ממוצעת"
          value={`${kpi.avgPriceVariancePct >= 0 ? '+' : ''}${kpi.avgPriceVariancePct}%`}
          icon={<TrendingUp className="w-5 h-5" />}
          tone={kpi.avgPriceVariancePct > 3 ? 'red' : kpi.avgPriceVariancePct > 1 ? 'amber' : 'emerald'}
          subtitle="מעל מחירי ההזמנה"
        />
        <KpiCard
          label="הוצאה החודש"
          value={`₪${kpi.monthSpendIls.toLocaleString('he-IL')}`}
          icon={<Wallet className="w-5 h-5" />}
          tone="blue"
          subtitle={`${spendDelta >= 0 ? '+' : ''}${Math.round(spendDeltaPct)}% מחודש קודם`}
        />
        <KpiCard
          label="חריגות פתוחות"
          value={kpi.openDisputes.toString()}
          icon={<ShieldAlert className="w-5 h-5" />}
          tone={kpi.openDisputes > 0 ? 'red' : 'emerald'}
          subtitle={`${kpi.flaggedInvoicesThisMonth}/${kpi.totalInvoicesThisMonth} חשבוניות סומנו`}
        />
      </section>

      {/* Price trends */}
      <section className="detail-block">
        <SectionHeader
          title="מחירי פריטים מובילים"
          subtitle="מגמת 12 שבועות אחרונים, מסומן לפי שינוי מהממוצע ההיסטורי"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {topProducts.map((p) => (
            <PriceTrendCard key={p.productId} product={p} />
          ))}
        </div>
      </section>

      {/* Recent invoices + Activity */}
      <section className="detail-block grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SectionHeader
            title="חשבוניות אחרונות"
            subtitle={`${recentInvoices.length} מהחודש האחרון · לחץ לצפייה בסריקה`}
          />
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
            {recentInvoices.map((inv, idx) => (
              <InvoiceListRow
                key={inv.id}
                invoice={inv}
                isLast={idx === recentInvoices.length - 1}
                onOpenScan={() => setScanInvoiceId(inv.id)}
              />
            ))}
          </div>
        </div>

        <div>
          <SectionHeader title="פעילות" subtitle="כל מה שקרה אצל הספק" />
          <ActivityFeed events={activity} />
        </div>
      </section>

      {scanInvoiceId
        ? (() => {
            const inv = recentInvoices.find((i) => i.id === scanInvoiceId);
            if (!inv) return null;
            return (
              <InvoiceScanViewer
                data={fromSupplierInvoiceListItem(inv, profile as SupplierProfile)}
                onClose={() => setScanInvoiceId(null)}
              />
            );
          })()
        : null}
    </main>
  );
}

function ContactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1.5">
        <span className="text-slate-400">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-slate-800 truncate">{value}</div>
    </div>
  );
}

function StatusPill({ kpi }: { kpi: { cleanDeliveryPct: number; openDisputes: number } }) {
  const isHealthy = kpi.cleanDeliveryPct >= 90 && kpi.openDisputes === 0;
  const isWatch = kpi.openDisputes > 0 || kpi.cleanDeliveryPct < 80;
  const label = isHealthy ? 'ספק יציב' : isWatch ? 'בבדיקה' : 'תקין';
  const tint = isHealthy
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : isWatch
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-blue-50 text-blue-700 border-blue-200';
  const icon = isHealthy ? (
    <Check className="w-3 h-3" strokeWidth={3} />
  ) : (
    <ShieldAlert className="w-3 h-3" />
  );
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${tint}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

function ActionButton({
  icon,
  label,
  primary,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const cls = primary
    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-[0_4px_12px_rgba(37,99,235,0.25)]'
    : danger
      ? 'bg-white border border-red-200 hover:bg-red-50 text-red-700'
      : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700';
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${cls}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone,
  subtitle,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'amber' | 'red' | 'blue';
  subtitle?: string;
}) {
  const map = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  } as const;
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
      <div className={`w-10 h-10 rounded-xl ring-1 flex items-center justify-center mb-3 ${map[tone]}`}>
        {icon}
      </div>
      <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums text-slate-900 mb-1">{value}</div>
      {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
    </div>
  );
}

function PriceTrendCard({ product }: { product: PriceTrendProduct }) {
  const trendUp = product.trendPct > 0.5;
  const trendDown = product.trendPct < -0.5;
  const color = trendUp ? '#DC2626' : trendDown ? '#059669' : '#64748B';
  const fillStart = trendUp
    ? 'rgba(220,38,38,0.16)'
    : trendDown
      ? 'rgba(5,150,105,0.16)'
      : 'rgba(100,116,139,0.12)';

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-slate-900 text-base mb-0.5">{product.name}</div>
          <div className="text-xs text-slate-500">לפי {product.unit}</div>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-2 py-0.5 ${
            trendUp
              ? 'bg-red-50 text-red-700'
              : trendDown
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {trendUp ? (
            <ArrowUp className="w-3 h-3" strokeWidth={3} />
          ) : trendDown ? (
            <ArrowDown className="w-3 h-3" strokeWidth={3} />
          ) : (
            <Minus className="w-3 h-3" strokeWidth={3} />
          )}
          <span className="tabular-nums">
            {product.trendPct > 0 ? '+' : ''}
            {product.trendPct.toFixed(1)}%
          </span>
        </span>
      </div>

      <Sparkline data={product.series} stroke={color} fillStart={fillStart} />

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-baseline justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            מחיר אחרון
          </div>
          <div className="text-lg font-bold tabular-nums text-slate-900">₪{product.currentPrice}</div>
        </div>
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            ממוצע 60י׳
          </div>
          <div className="text-sm font-semibold tabular-nums text-slate-500">
            ₪{product.avgPrice60d}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, stroke, fillStart }: { data: number[]; stroke: string; fillStart: string }) {
  const w = 240;
  const h = 56;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const gradId = `g-${stroke.slice(1)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillStart} />
          <stop offset="100%" stopColor={fillStart.replace(/[\d.]+\)/, '0)')} />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      {points.length > 0 ? (
        <circle
          cx={points[points.length - 1]![0]}
          cy={points[points.length - 1]![1]}
          r="3"
          fill={stroke}
        />
      ) : null}
    </svg>
  );
}

function InvoiceListRow({
  invoice,
  isLast,
  onOpenScan,
}: {
  invoice: SupplierInvoiceListItem;
  isLast: boolean;
  onOpenScan: () => void;
}) {
  const status = invoice.status;
  const tint =
    status === 'clean'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'minor'
        ? 'bg-slate-50 text-slate-700 border-slate-200'
        : status === 'major'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-red-50 text-red-700 border-red-200';
  const label =
    status === 'clean'
      ? 'תקין'
      : status === 'minor'
        ? 'הערה'
        : status === 'major'
          ? 'חריגות'
          : 'נחסם';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenScan}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenScan();
        }
      }}
      className={`flex items-center gap-4 px-5 py-4 hover:bg-blue-50/30 cursor-pointer transition-colors ${
        isLast ? '' : 'border-b border-slate-100'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center shrink-0">
        <FileImage className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-slate-900 text-sm font-mono">
            {invoice.invoiceNumber}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${tint}`}>
            {label}
          </span>
          {invoice.discrepanciesCount > 0 ? (
            <span className="text-xs text-amber-700 font-medium">
              · {invoice.discrepanciesCount} חריגות
            </span>
          ) : null}
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Calendar className="w-3 h-3" />
          <span>
            {new Date(invoice.scannedAt).toLocaleDateString('he-IL', {
              day: '2-digit',
              month: '2-digit',
            })}
          </span>
          <span>·</span>
          <Clock className="w-3 h-3" />
          <span className="tabular-nums">
            {new Date(invoice.scannedAt).toLocaleTimeString('he-IL', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
      <div className="text-left">
        <div className="font-bold tabular-nums text-slate-900 text-sm">
          ₪{invoice.totalIls.toLocaleString('he-IL')}
        </div>
        {invoice.savingsCapturedIls > 0 ? (
          <div className="text-xs text-emerald-700 font-semibold tabular-nums flex items-center gap-0.5 justify-end mt-0.5">
            <Sparkles className="w-3 h-3" />₪{invoice.savingsCapturedIls.toLocaleString('he-IL')}
          </div>
        ) : null}
      </div>
      <Link
        href="/showcase/dashboard/invoices"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 flex items-center justify-center transition-colors"
        title="פתח בעמוד ביקורת החשבוניות"
      >
        <ArrowUpRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
      <div className="relative pr-4 border-r-2 border-slate-200/70 space-y-4">
        {events.map((e) => (
          <ActivityEventRow key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

function ActivityEventRow({ event }: { event: ActivityEvent }) {
  const config = activityConfig(event.type);
  return (
    <div className="relative">
      <div
        className={`absolute -right-[22px] top-1 w-3 h-3 rounded-full ring-4 ring-white ${config.dot}`}
      />
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="text-sm font-semibold text-slate-800">{event.title}</span>
        <span className="text-xs text-slate-500 tabular-nums shrink-0">
          {formatRelative(event.at)}
        </span>
      </div>
      {event.detail ? (
        <div className="text-xs text-slate-500 leading-relaxed">{event.detail}</div>
      ) : null}
      {event.amount !== undefined && event.type === 'invoice_closed' ? (
        <div className="text-xs font-semibold text-emerald-700 tabular-nums mt-1 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" />₪{event.amount.toLocaleString('he-IL')} נחסך
        </div>
      ) : event.amount !== undefined && event.type === 'invoice_blocked' ? (
        <div className="text-xs font-semibold text-red-700 tabular-nums mt-1">
          ₪{event.amount.toLocaleString('he-IL')} חסומים
        </div>
      ) : null}
    </div>
  );
}

function activityConfig(type: ActivityEvent['type']) {
  switch (type) {
    case 'invoice_blocked':
      return { dot: 'bg-red-600' };
    case 'invoice_closed':
      return { dot: 'bg-emerald-600' };
    case 'price_alert':
      return { dot: 'bg-amber-500' };
    case 'dispute_opened':
      return { dot: 'bg-amber-600' };
    case 'late_delivery':
      return { dot: 'bg-slate-400' };
    default:
      return { dot: 'bg-blue-500' };
  }
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay >= 1) return `${diffDay} ימים`;
  if (diffHour >= 1) return `${diffHour} שעות`;
  if (diffMin >= 1) return `${diffMin} דק׳`;
  return 'עכשיו';
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
    </div>
  );
}

// Unused-import guards (kept stable as the page grows)
void TrendingDown;
