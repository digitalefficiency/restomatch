import Link from 'next/link';
import { originalProps } from '@/lib/i18n/original';
import { auth } from '@/auth';
import { TRPCError } from '@trpc/server';
import { ArrowLeft, Droplets, FileBarChart, ShieldAlert } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import {
  Badge,
  Card,
  EmptyState,
  EntitlementUpsell,
  LeakHeatmap,
  SectionHeader,
  Sparkline,
  StatCard,
  entitlementCauseOf,
} from '@/lib/components';
import { canSeeRoute } from '@/lib/roles';
import { parseView } from '@/lib/components/views';
import { displayName } from '../approvals/vocab';
import { LeakExplorer } from './explorer';
import { OverContractCard } from '../contracts/over-contract';

export default async function LeaksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = parseView(await searchParams);
  const caller = await createServerCaller();
  const [t, locale] = await Promise.all([getT(leaksNs), getLocale()]);
  let leaks: Awaited<ReturnType<typeof caller.owner.leaks>> = [];
  let blocked: 'entitlement' | 'role' | null = null;
  const role = (
    (await auth())?.user as { role?: string } | undefined
  )?.role;
  try {
    // Owner-only procedure: answer the role case without a guaranteed-FORBIDDEN call.
    if (role !== 'owner') blocked = 'role';
    else leaks = await caller.owner.leaks({ limit: 50 });
  } catch (err) {
    // Distinguish a missing plan feature (→ upsell) from a role restriction
    // (→ explain the role requirement). Both arrive as FORBIDDEN.
    if (entitlementCauseOf(err)) {
      blocked = 'entitlement';
    } else if (err instanceof TRPCError && err.code === 'FORBIDDEN') {
      blocked = 'role';
    } else {
      throw err;
    }
  }

  const leakLinks = (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
      <Link
        href="/dashboard/leaks/report"
        className="inline-flex items-center gap-1.5 rounded-xl bg-gold/12 px-3 py-1.5 text-sm font-semibold text-gold ring-1 ring-gold/30 hover:bg-gold/20"
      >
        <FileBarChart className="h-4 w-4" aria-hidden="true" />
        {t('report.open')}
      </Link>
      <Link
        href="/dashboard/leaks/breakdown"
        className="inline-flex max-w-full items-center gap-1 rounded-lg text-sm font-semibold text-primary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {t('detective.toBreakdown')}
        <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
      </Link>
    </div>
  );
  // The explorer is for every finance role (owner/manager/bookkeeper); the
  // detective below stays owner-only.
  const explorer = role && canSeeRoute(role as Parameters<typeof canSeeRoute>[0], '/dashboard/leaks') ? (
    <LeakExplorer view={view} />
  ) : null;

  if (blocked === 'entitlement') {
    return (
      <div>
        <SectionHeader level={1} title={t('detective.title')} />
        {leakLinks}
        {explorer}
        <OverContractCard variant="compact" />
        <EntitlementUpsell feature="advanced_analytics" title={t('detective.upsell')} />
      </div>
    );
  }

  if (blocked === 'role') {
    return (
      <div>
        <SectionHeader level={1} title={t('detective.title')} />
        {leakLinks}
        {explorer}
        <OverContractCard variant="compact" />
        <Card padding="md" className="flex items-center gap-3 border-warn/30 bg-warn/5 text-warn">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{t('detective.roleOnly')}</span>
        </Card>
      </div>
    );
  }

  const rows = leaks.map((l) => ({
    ...l,
    productName: displayName(locale, l.productName, l.productNameEn),
    supplierName: displayName(locale, l.supplierName, l.supplierNameEn),
    // Tiles, totals and the table show money actually paid above the median in
    // the last 30 days (not the latest-price projection).
    monthExcessIls: l.paidExcessIls,
  }));
  const totalExcess = rows.reduce((sum, r) => sum + r.monthExcessIls, 0);
  const worst = rows.reduce((m, r) => Math.max(m, r.deltaPct), 0);
  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('detective.title')}
        subtitle={t('detective.subtitle')}
      />
      {leakLinks}
      {explorer}
      {/* Wave-1: lines billed above contract (renders nothing when off / none). */}
      <OverContractCard variant="compact" />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Droplets className="h-6 w-6" />}
          title={t('detective.emptyTitle')}
          description={t('detective.emptyDescription')}
        />
      ) : (
        <div className="space-y-8">
          {/* At-a-glance totals — money leaking this month, in danger. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label={t('detective.totalLabel')}
              value={formatIls(totalExcess, { locale })}
              tone="danger"
              icon={<Droplets className="h-4 w-4" />}
              hint={t('detective.totalHint')}
            />
            <StatCard
              label={t('detective.hotspots')}
              value={formatNumber(rows.length, locale)}
              tone="warn"
              hint={t('detective.hotspotsHint')}
            />
            <StatCard
              label={t('detective.worst')}
              value={<span dir="ltr">+{formatPercent(worst, locale, 1)}</span>}
              tone="danger"
              hint={t('detective.worstHint')}
            />
          </div>

          {/* The signature glowing heatmap. */}
          <LeakHeatmap
            items={rows}
            locale={locale}
            labels={{ mild: t('heatmap.mild'), severe: t('heatmap.severe'), more: t('heatmap.more') }}
          />

          {/* Full breakdown table — scrolls horizontally on phones. */}
          <Card elevated padding="none" flow className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{t('detective.caption')}</caption>
              <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colProduct')}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colSupplier')}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colMedian')}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colLast')}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colChange')}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colTrend')}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{t('detective.colExcess')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.productId}-${row.supplierId}`}
                    className="border-t border-line transition-colors hover:bg-surface-2/60"
                  >
                    <td className="p-3">
                      <div className="font-medium text-ink">{row.productName}</div>
                      <div className="text-xs text-subtle" {...originalProps(row.category)}>
                        {row.category ?? '—'}
                      </div>
                    </td>
                    <td className="p-3 text-muted">{row.supplierName}</td>
                    <td className="p-3 font-mono tabular-nums text-muted">{money(row.baselineP50)}</td>
                    <td className="p-3 font-mono tabular-nums text-ink">{money(row.lastObservedPrice)}</td>
                    <td className="p-3">
                      <Badge tone={row.deltaPct >= 0.1 ? 'danger' : 'warning'}>
                        <span dir="ltr">+{formatPercent(row.deltaPct, locale, 1)}</span>
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Sparkline data={row.series} />
                    </td>
                    <td className="p-3 font-mono font-semibold tabular-nums text-danger">
                      {money(row.monthExcessIls)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
