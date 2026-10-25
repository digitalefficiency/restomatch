'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { whenMotionOk } from '../../../_lib/motion';
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
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { use, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatRelative } from '@/lib/i18n/format';
import { showcase } from '@/lib/i18n/messages/showcase';
import { formatIls } from '@/lib/money';
import { ilsExact } from '../../../_lib/money';
import { localDayMonth, localTime } from '../../../_lib/time';
import { mockText } from '../../../_lib/mockText';
import { InvoiceScanViewer } from '../../_components/InvoiceScanViewer';
import { fromAuditRecord, fromSupplierInvoiceListItem } from '../../_components/scanDataAdapters';
import { invoiceAudits } from '../../invoices/_mock';
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
  const t = useT(showcase);
  const locale = useLocale();
  const profile = getSupplierProfile(supplierId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanInvoiceId, setScanInvoiceId] = useState<string | null>(null);

  useGSAP(
    () =>
      whenMotionOk(() => {
        gsap.from('.detail-block', {
          y: 20,
          opacity: 0,
          stagger: 0.08,
          duration: 0.5,
          ease: 'power3.out',
        });
      }),
    { scope: containerRef },
  );

  if (!profile) {
    notFound();
  }

  const { metadata, kpi, topProducts, recentInvoices, activity } = profile;
  const spendDelta = kpi.monthSpendIls - kpi.prevMonthSpendIls;
  const spendDeltaPct = (spendDelta / kpi.prevMonthSpendIls) * 100;
  const name = mockText(metadata.name, locale);

  return (
    <main ref={containerRef} className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link
          href="/showcase/dashboard/invoices"
          className="hover:text-primary inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
          {t('supplier.breadcrumb')}
        </Link>
        <span className="text-muted">/</span>
        <span className="text-ink font-medium">{name}</span>
      </div>

      {/* Hero */}
      <section className="detail-block grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: identity */}
        <div className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-card">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 shrink-0 rounded-2xl bg-primary/12 border border-primary/25 flex items-center justify-center text-2xl font-bold text-primary">
                {mockText(metadata.initials, locale)}
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-ink mb-1">{name}</h1>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-line">
                    {mockText(metadata.category, locale)}
                  </span>
                  <span>·</span>
                  <span>{t('supplier.companyNo', { id: metadata.businessId })}</span>
                  <span>·</span>
                  <span>{t('supplier.activeSince', { date: metadata.activeSince })}</span>
                </div>
              </div>
            </div>
            <StatusPill kpi={kpi} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <ContactRow
              icon={<Phone className="w-3.5 h-3.5" />}
              label={t('supplier.contact.phone')}
              value={metadata.contactPhone}
              ltr
            />
            <ContactRow
              icon={<Mail className="w-3.5 h-3.5" />}
              label={t('supplier.contact.email')}
              value={metadata.contactEmail}
              ltr
            />
            <ContactRow
              icon={<Truck className="w-3.5 h-3.5" />}
              label={t('supplier.contact.delivery')}
              value={mockText(metadata.deliverySchedule, locale)}
            />
            <ContactRow
              icon={<CreditCard className="w-3.5 h-3.5" />}
              label={t('supplier.contact.terms')}
              value={mockText(metadata.paymentTerms, locale)}
            />
          </div>
        </div>

        {/* Right: action panel */}
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card flex flex-col gap-3">
          <h2 className="text-xs ltr:uppercase ltr:tracking-wider text-muted font-semibold mb-1">
            {t('supplier.actions.title')}
          </h2>
          <ActionButton
            icon={<MessageCircle className="w-4 h-4" />}
            label={t('supplier.actions.whatsapp')}
            title={t('detail.demoAction')}
            primary
          />
          <ActionButton
            icon={<Phone className="w-4 h-4" />}
            label={t('supplier.actions.call')}
            title={t('detail.demoAction')}
          />
          <ActionButton
            icon={<FileText className="w-4 h-4" />}
            label={t('supplier.actions.priceList')}
            title={t('detail.demoAction')}
          />
          <ActionButton
            icon={<ShieldAlert className="w-4 h-4" />}
            label={t('supplier.actions.dispute')}
            title={t('detail.demoAction')}
            danger
          />
        </div>
      </section>

      {/* KPI strip */}
      <section className="detail-block grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label={t('supplier.kpi.clean')}
          value={`${kpi.cleanDeliveryPct}%`}
          icon={<Check className="w-5 h-5" />}
          tone={kpi.cleanDeliveryPct >= kpi.cleanDeliveryRestaurantAvg ? 'primary' : 'amber'}
          subtitle={t('supplier.kpi.cleanSub', { pct: kpi.cleanDeliveryRestaurantAvg })}
        />
        <KpiCard
          label={t('supplier.kpi.variance')}
          value={`${kpi.avgPriceVariancePct >= 0 ? '+' : ''}${kpi.avgPriceVariancePct}%`}
          icon={<TrendingUp className="w-5 h-5" />}
          tone={kpi.avgPriceVariancePct > 3 ? 'red' : kpi.avgPriceVariancePct > 1 ? 'amber' : 'primary'}
          subtitle={t('supplier.kpi.varianceSub')}
        />
        <KpiCard
          label={t('supplier.kpi.spend')}
          value={formatIls(kpi.monthSpendIls, { locale })}
          icon={<Wallet className="w-5 h-5" />}
          tone="blue"
          subtitle={t('supplier.kpi.spendSub', {
            delta: `${spendDelta >= 0 ? '+' : ''}${Math.round(spendDeltaPct)}`,
          })}
        />
        <KpiCard
          label={t('supplier.kpi.disputes')}
          value={kpi.openDisputes.toString()}
          icon={<ShieldAlert className="w-5 h-5" />}
          tone={kpi.openDisputes > 0 ? 'red' : 'primary'}
          subtitle={t('supplier.kpi.disputesSub', {
            flagged: kpi.flaggedInvoicesThisMonth,
            total: kpi.totalInvoicesThisMonth,
          })}
        />
      </section>

      {/* Price trends */}
      <section className="detail-block">
        <SectionHeader
          title={t('supplier.prices.title')}
          subtitle={t('supplier.prices.subtitle')}
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
            title={t('supplier.recent.title')}
            subtitle={t('supplier.recent.subtitle', { count: recentInvoices.length })}
          />
          <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-card">
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
          <SectionHeader title={t('supplier.activity.title')} subtitle={t('supplier.activity.subtitle')} />
          <ActivityFeed events={activity} />
        </div>
      </section>

      {scanInvoiceId
        ? (() => {
            const inv = recentInvoices.find((i) => i.id === scanInvoiceId);
            if (!inv) return null;
            // Audited invoices render their real lines (same ₪ as the invoices page).
            const audited = invoiceAudits().find((a) => a.invoiceNumber === inv.invoiceNumber);
            return (
              <InvoiceScanViewer
                data={audited ? fromAuditRecord(audited) : fromSupplierInvoiceListItem(inv, profile as SupplierProfile)}
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
  ltr,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted mb-0.5 flex items-center gap-1.5">
        <span className="text-muted">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-ink truncate" dir={ltr ? 'ltr' : undefined}>
        <bdi>{value}</bdi>
      </div>
    </div>
  );
}

function StatusPill({ kpi }: { kpi: { cleanDeliveryPct: number; openDisputes: number } }) {
  const t = useT(showcase);
  const isHealthy = kpi.cleanDeliveryPct >= 90 && kpi.openDisputes === 0;
  const isWatch = kpi.openDisputes > 0 || kpi.cleanDeliveryPct < 80;
  const label = isHealthy
    ? t('supplier.status.stable')
    : isWatch
      ? t('supplier.status.watch')
      : t('supplier.status.ok');
  const tint = isHealthy
    ? 'bg-primary/12 text-primary ring-1 ring-primary/25'
    : isWatch
      ? 'bg-warn/12 text-warn ring-1 ring-warn/25'
      : 'bg-info/12 text-info ring-1 ring-info/25';
  const icon = isHealthy ? (
    <Check className="w-3 h-3" strokeWidth={3} />
  ) : (
    <ShieldAlert className="w-3 h-3" />
  );
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tint}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

function ActionButton({
  icon,
  label,
  title,
  primary,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const cls = primary
    ? 'bg-primary hover:brightness-110 text-on-primary shadow-glow-primary'
    : danger
      ? 'bg-surface-2 border border-danger/30 hover:bg-danger/10 text-danger'
      : 'bg-surface-2 border border-line hover:border-primary/40 hover:text-primary text-ink';
  return (
    <button
      type="button"
      title={title}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${cls}`}
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
  tone: 'primary' | 'amber' | 'red' | 'blue';
  subtitle?: string;
}) {
  const map = {
    primary: { icon: 'bg-primary/12 text-primary ring-primary/25', value: 'text-ink', glow: 'glow-primary-blob' },
    amber: { icon: 'bg-warn/12 text-warn ring-warn/25', value: 'text-ink', glow: 'glow-gold-blob' },
    red: { icon: 'bg-danger/12 text-danger ring-danger/25', value: 'text-danger', glow: 'glow-danger-blob' },
    blue: { icon: 'bg-info/12 text-info ring-info/25', value: 'text-ink', glow: 'glow-primary-blob' },
  } as const;
  const t = map[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
      <div className={`w-10 h-10 rounded-xl ring-1 flex items-center justify-center mb-3 ${t.icon}`}>
        {icon}
      </div>
      <div className="text-xs ltr:uppercase ltr:tracking-wider text-muted font-semibold mb-1">
        {label}
      </div>
      <div className={`font-mono text-2xl font-extrabold tabular-nums mb-1 ${t.value}`}>{value}</div>
      {subtitle ? <div className="text-xs text-muted">{subtitle}</div> : null}
      <div
        className={`pointer-events-none absolute -bottom-10 -start-10 w-40 h-40 rounded-full blur-2xl opacity-60 ${t.glow}`}
      />
    </div>
  );
}

function PriceTrendCard({ product }: { product: PriceTrendProduct }) {
  const t = useT(showcase);
  const locale = useLocale();
  const trendUp = product.trendPct > 0.5;
  const trendDown = product.trendPct < -0.5;
  // Rising price = leak (danger), falling = money-green, flat = muted.
  const color = trendUp ? '#B80F2A' : trendDown ? '#066B4A' : '#5A6A62';
  const fillStart = trendUp
    ? 'rgba(184,15,42,0.16)'
    : trendDown
      ? 'rgba(6,107,74,0.16)'
      : 'rgba(90,106,98,0.12)';

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-ink text-base mb-0.5">{mockText(product.name, locale)}</div>
          <div className="text-xs text-muted">
            {t('supplier.prices.perUnit', { unit: mockText(product.unit, locale) })}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-2 py-0.5 ring-1 ${
            trendUp
              ? 'bg-danger/12 text-danger ring-danger/25'
              : trendDown
                ? 'bg-primary/12 text-primary ring-primary/25'
                : 'bg-surface-2 text-muted ring-line'
          }`}
        >
          {trendUp ? (
            <ArrowUp className="w-3 h-3" strokeWidth={3} />
          ) : trendDown ? (
            <ArrowDown className="w-3 h-3" strokeWidth={3} />
          ) : (
            <Minus className="w-3 h-3" strokeWidth={3} />
          )}
          <span className="font-mono tabular-nums">
            {product.trendPct > 0 ? '+' : ''}
            {product.trendPct.toFixed(1)}%
          </span>
        </span>
      </div>

      <Sparkline data={product.series} stroke={color} fillStart={fillStart} />

      <div className="mt-3 pt-3 border-t border-line flex items-baseline justify-between">
        <div>
          <div className="text-xs ltr:uppercase ltr:tracking-wider text-muted font-semibold">
            {t('supplier.prices.latest')}
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-ink">
            {ilsExact(product.currentPrice, locale)}
          </div>
        </div>
        <div className="text-end">
          <div className="text-xs ltr:uppercase ltr:tracking-wider text-muted font-semibold">
            {t('supplier.prices.avg60')}
          </div>
          <div className="text-sm font-semibold font-mono tabular-nums text-muted">
            {ilsExact(product.avgPrice60d, locale)}
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
  const t = useT(showcase);
  const locale = useLocale();
  const status = invoice.status;
  const tint =
    status === 'clean'
      ? 'bg-primary/12 text-primary ring-1 ring-primary/25'
      : status === 'minor'
        ? 'bg-surface-2 text-muted ring-1 ring-line'
        : status === 'major'
          ? 'bg-warn/12 text-warn ring-1 ring-warn/25'
          : 'bg-danger/12 text-danger ring-1 ring-danger/25';
  const label =
    status === 'blocked' ? t('supplier.recent.blocked') : t(`invoiceStatus.${status}`);

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
      className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-surface-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${
        isLast ? '' : 'border-b border-line'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-primary/12 text-primary border border-primary/25 flex items-center justify-center shrink-0">
        <FileImage className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-0.5">
          <span className="font-semibold text-ink text-sm font-mono tabular-nums">
            {invoice.invoiceNumber}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tint}`}>
            {label}
          </span>
          {invoice.discrepanciesCount > 0 ? (
            <span className="text-xs text-warn font-medium">
              ·{' '}
              {invoice.discrepanciesCount === 1
                ? t('common.varianceOne')
                : t('common.varianceMany', { count: invoice.discrepanciesCount })}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted flex items-center gap-2">
          <Calendar className="w-3 h-3" />
          <span className="font-mono tabular-nums">{localDayMonth(invoice.scannedAt)}</span>
          <span>·</span>
          <Clock className="w-3 h-3" />
          <span className="font-mono tabular-nums">{localTime(invoice.scannedAt)}</span>
        </div>
      </div>
      <div className="text-end shrink-0">
        <div className="font-bold font-mono tabular-nums text-ink text-sm">
          {ilsExact(invoice.totalIls, locale)}
        </div>
        {invoice.savingsCapturedIls > 0 ? (
          <div className="text-xs text-gold font-semibold font-mono tabular-nums flex items-center gap-0.5 justify-end mt-0.5">
            <Sparkles className="w-3 h-3" />
            {ilsExact(invoice.savingsCapturedIls, locale)}
          </div>
        ) : null}
      </div>
      <Link
        href="/showcase/dashboard/invoices"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 w-8 h-8 rounded-lg bg-surface-2 border border-line text-muted hover:text-primary hover:border-primary/40 flex items-center justify-center transition-colors"
        title={t('supplier.recent.openInAudit')}
        aria-label={t('supplier.recent.openInAudit')}
      >
        <ArrowUpRight className="w-4 h-4 rtl:-scale-x-100" />
      </Link>
    </div>
  );
}

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="relative ps-4 border-s-2 border-line space-y-4">
        {events.map((e) => (
          <ActivityEventRow key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

function ActivityEventRow({ event }: { event: ActivityEvent }) {
  const t = useT(showcase);
  const locale = useLocale();
  const config = activityConfig(event.type);
  return (
    <div className="relative">
      <div
        className={`absolute -start-[23px] top-1 w-3 h-3 rounded-full ring-4 ring-surface ${config.dot}`}
      />
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="text-sm font-semibold text-ink">{mockText(event.title, locale)}</span>
        <span className="text-xs text-muted tabular-nums shrink-0" suppressHydrationWarning>
          {formatRelative(event.at, locale)}
        </span>
      </div>
      {event.detail ? (
        <div className="text-xs text-muted leading-relaxed">{mockText(event.detail, locale)}</div>
      ) : null}
      {event.amount !== undefined && event.type === 'invoice_closed' ? (
        <div className="text-xs font-semibold text-gold font-mono tabular-nums mt-1 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          {t('supplier.activity.saved', {
            amount: ilsExact(event.amount, locale),
          })}
        </div>
      ) : event.amount !== undefined && event.type === 'invoice_blocked' ? (
        <div className="text-xs font-semibold text-danger font-mono tabular-nums mt-1">
          {t('supplier.activity.blocked', { amount: formatIls(event.amount, { locale }) })}
        </div>
      ) : null}
    </div>
  );
}

function activityConfig(type: ActivityEvent['type']) {
  switch (type) {
    case 'invoice_blocked':
      return { dot: 'bg-danger' };
    case 'invoice_closed':
      return { dot: 'bg-primary' };
    case 'price_alert':
      return { dot: 'bg-warn' };
    case 'dispute_opened':
      return { dot: 'bg-warn' };
    case 'late_delivery':
      return { dot: 'bg-subtle' };
    default:
      return { dot: 'bg-info' };
  }
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <div className="mb-2 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
      <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
      {subtitle ? <p className="text-xs text-muted mt-0.5">{subtitle}</p> : null}
    </div>
  );
}

