import Link from 'next/link';
import { ArrowRight, CircleCheck, FileText, PauseCircle, ReceiptText } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { originalProps } from '@/lib/i18n/original';
import { payRun as payRunNs } from '@/lib/i18n/messages/payRun';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Badge, Card, EmptyState, KpiCard, LinkButton, SectionHeader, cn, type BadgeTone } from '@/lib/components';
import { discrepancyLabel, displayName } from '../vocab';
import { PayRunExport } from './export-button';

type PayRunStatus = 'pay' | 'hold' | 'claim';

/** T3 calm for "can pay", T2 act-now for "hold", money-back gold for a credit to ask for. */
const TONE: Record<PayRunStatus, BadgeTone> = { pay: 'accent', hold: 'warning', claim: 'gold' };

/**
 * Pay run (flag payRun): this / last month's checked invoices not marked as
 * paid, per supplier — can pay / hold / ask for a credit. Numbers from
 * payRun.month (shared claimable-line rule with the credit letters).
 * `?m=-1` = previous month.
 */
export default async function PayRunPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const monthOffset: 0 | -1 = sp.m === '-1' ? -1 : 0;
  const caller = await createServerCaller();
  const [t, ta, locale] = await Promise.all([getT(payRunNs), getT(approvalsNs), getLocale()]);
  const data = await caller.payRun.month({ monthOffset });

  const back = (
    <Link
      href="/dashboard/approvals"
      className="mb-3 -ms-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
      {ta('title')}
    </Link>
  );

  if (!data.enabled) {
    return (
      <div>
        {back}
        <SectionHeader level={1} title={t('title')} />
        <EmptyState icon={<ReceiptText className="h-6 w-6" />} title={t('disabled')} />
      </div>
    );
  }

  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const month = data.monthStart ? formatDate(data.monthStart, locale, { month: 'long', year: 'numeric' }) : '';
  const day = (iso: string) => formatDate(iso, locale, { dateStyle: 'medium' });
  const supplierLabel = (s: { supplierName: string | null; supplierNameEn: string | null }) =>
    displayName(locale, s.supplierName, s.supplierNameEn) || '—';
  const statusLabel = (inv: { status: PayRunStatus; pendingLink: boolean; duplicate: boolean; creditIls: number }) =>
    inv.status === 'claim'
      ? t('status.claim', { amount: ils(inv.creditIls) })
      : inv.status === 'hold' && inv.duplicate
        ? t('status.holdDuplicate')
        : inv.status === 'hold' && inv.pendingLink
          ? t('status.holdLink')
          : t(`status.${inv.status}`);
  const count = (st: PayRunStatus) =>
    data.suppliers.reduce((n, s) => n + s.invoices.filter((i) => i.status === st).length, 0);
  /** The credit's VAT basis: one basis, or "mixed" (never silently summed as one). */
  const creditBasis = (claims: Array<{ resolutionStatus: string; basis: 'excl' | 'incl' | 'vat' }>) => {
    const bases = new Set(claims.filter((c) => c.resolutionStatus === 'accepted').map((c) => c.basis));
    if (bases.size === 0) return '';
    return bases.size === 1 ? t(`basis.${[...bases][0]!}`) : t('mixedBasis');
  };

  const csvColumns = [
    { key: 'supplier', label: t('csv.supplier') },
    { key: 'invoice', label: t('csv.invoice') },
    { key: 'date', label: t('csv.date') },
    { key: 'total', label: t('csv.total') },
    { key: 'status', label: t('csv.status') },
    { key: 'credit', label: t('csv.credit') },
    { key: 'creditBasis', label: t('csv.creditBasis') },
    { key: 'pending', label: t('csv.pending') },
  ];
  const csvRows = data.suppliers.flatMap((s) =>
    s.invoices.map((inv) => ({
      supplier: supplierLabel(s),
      invoice: inv.invoiceNumber ?? '',
      date: inv.invoiceDate.slice(0, 10),
      total: inv.totalInclVat.toFixed(2),
      status: statusLabel(inv),
      credit: inv.creditIls ? inv.creditIls.toFixed(2) : '',
      creditBasis: creditBasis(inv.claims),
      pending: inv.pendingIls ? inv.pendingIls.toFixed(2) : '',
    })),
  );
  const monthHref = (m: 0 | -1) => `/dashboard/approvals/pay-run${m ? '?m=-1' : ''}`;

  return (
    <div>
      {back}
      <SectionHeader
        level={1}
        title={t('title')}
        subtitle={t('subtitle', { month })}
        action={
          data.totals.invoices > 0 ? (
            <PayRunExport
              label={t('csv.button')}
              filename={t('csv.file', { month: (data.monthStart ?? '').slice(0, 7) })}
              columns={csvColumns}
              rows={csvRows}
            />
          ) : undefined
        }
      />

      {/* This month / last month. */}
      <nav aria-label={t('month.label')} className="mb-6 inline-flex rounded-xl border border-line bg-surface-2 p-1 text-sm">
        {([0, -1] as const).map((m) => (
          // A plain document link: same-route search-param soft navigations stall in
          // production under approvals/loading.tsx (see docs on the soft-nav fix).
          <a
            key={m}
            href={monthHref(m)}
            aria-current={m === monthOffset ? 'page' : undefined}
            data-testid={`payrun-month-${m === 0 ? 'this' : 'last'}`}
            className={cn(
              'rounded-lg px-3 py-1.5 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              m === monthOffset ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {m === 0 ? t('month.this') : t('month.last')}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="payrun-kpis">
        <KpiCard
          label={t('kpis.pay')}
          value={<span data-testid="payrun-pay">{ils(data.totals.payIls)}</span>}
          tone="accent"
          icon={<CircleCheck className="h-5 w-5" />}
          subtitle={t('kpis.payHint', { count: formatNumber(count('pay'), locale) })}
        />
        <KpiCard
          label={t('kpis.hold')}
          value={<span data-testid="payrun-hold">{ils(data.totals.holdIls)}</span>}
          tone={data.totals.holdIls > 0 ? 'warning' : 'neutral'}
          icon={<PauseCircle className="h-5 w-5" />}
          subtitle={t('kpis.holdHint', { count: formatNumber(count('hold'), locale) })}
        />
        <KpiCard
          label={t('kpis.credit')}
          value={<span data-testid="payrun-credit">{ils(data.totals.creditIls)}</span>}
          tone="gold"
          icon={<ReceiptText className="h-5 w-5" />}
          subtitle={t('kpis.creditHint')}
        />
      </div>

      {data.suppliers.length === 0 ? (
        <EmptyState className="mt-8" icon={<ReceiptText className="h-6 w-6" />} title={t('empty', { month })} />
      ) : (
        <div className="mt-8 space-y-6">
          {data.suppliers.map((s) => {
            const name = supplierLabel(s);
            return (
              <Card key={s.key || 'none'} padding="none" className="overflow-hidden" data-testid="payrun-supplier">
                <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <h2 className="text-base font-bold text-ink" {...originalProps(name)}>
                    {name}
                  </h2>
                  <div className="flex flex-wrap gap-1.5 text-xs" data-testid="payrun-subtotal">
                    <span className="sr-only">{t('supplier.subtotal')}</span>
                    {s.payIls > 0 ? <Badge tone="accent">{t('supplier.pay', { amount: ils(s.payIls) })}</Badge> : null}
                    {s.holdIls > 0 ? <Badge tone="warning">{t('supplier.hold', { amount: ils(s.holdIls) })}</Badge> : null}
                    {s.claimIls > 0 ? <Badge tone="gold">{t('supplier.claim', { amount: ils(s.claimIls) })}</Badge> : null}
                    {s.creditIls > 0 ? <Badge tone="gold">{t('supplier.credit', { amount: ils(s.creditIls) })}</Badge> : null}
                  </div>
                </div>
                <ul className="divide-y divide-line/60">
                  {s.invoices.map((inv) => (
                    <li
                      key={inv.invoiceId}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5"
                      data-testid="payrun-invoice"
                      data-status={inv.status}
                    >
                      <div className="min-w-0">
                        <p className="text-sm">
                          <Link href={`/dashboard/invoices/${inv.invoiceId}`} className="font-mono font-semibold text-ink hover:text-primary">
                            {inv.invoiceNumber ?? '—'}
                          </Link>
                          <span className="text-subtle"> · {day(inv.invoiceDate)}</span>
                        </p>
                        <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
                          {ils(inv.totalInclVat)} <span className="font-sans text-xs text-subtle">{t('table.totalBasis')}</span>
                        </p>
                        {inv.claims.length > 0 ? (
                          <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                            {inv.claims.map((c) => (
                              <li key={c.discrepancyId}>
                                {discrepancyLabel(ta, c.type)}
                                {(() => {
                                  const item =
                                    displayName(locale, c.productName, c.productNameEn) ||
                                    displayName(locale, c.lineDescription, c.lineDescriptionEn);
                                  return item ? (
                                    <>
                                      {' · '}
                                      <span {...originalProps(item)}>{item}</span>
                                    </>
                                  ) : null;
                                })()}
                                {' · '}
                                <span className="font-mono tabular-nums text-ink">{ils(c.amount)}</span>{' '}
                                <span className="text-subtle">{t(`basis.${c.basis}`)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                        <span data-testid="payrun-status">
                          <Badge tone={TONE[inv.status]}>{statusLabel(inv)}</Badge>
                        </span>
                        {inv.status === 'claim' ? (
                          <span className="text-xs text-subtle">{creditBasis(inv.claims)}</span>
                        ) : null}
                        {inv.pendingIls > 0 ? (
                          <span className="text-xs text-muted">{t('table.pending', { amount: ils(inv.pendingIls) })}</span>
                        ) : null}
                        {inv.status === 'hold' && !inv.pendingLink ? (
                          <LinkButton href="/dashboard/approvals" size="sm" variant="primary">
                            {t('table.toApprovals')}
                          </LinkButton>
                        ) : inv.status === 'claim' ? (
                          <LinkButton href={`/dashboard/leaks/claims${monthOffset ? '?m=-1' : ''}`} size="sm" variant="secondary">
                            <FileText className="h-4 w-4" aria-hidden="true" />
                            {t('letters')}
                          </LinkButton>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-xs text-subtle">{t('note')}</p>
    </div>
  );
}
