import Link from 'next/link';
import { originalProps } from '@/lib/i18n/original';
import { auth } from '@/auth';
import { TRPCError } from '@trpc/server';
import { ArrowLeft, FileBarChart, FileCheck2, Lock, TrendingUp } from 'lucide-react';
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

  // The report is owner|manager only: never offer a link the role cannot open (leaks-22).
  const canReport = role === 'owner' || role === 'manager';
  const linkCls =
    'touch-target inline-flex max-w-full items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-line transition-colors hover:bg-surface-2 hover:text-ink';
  const leakLinks = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Link href="/dashboard/leaks/breakdown" className={linkCls}>
        {t('detective.toBreakdown')}
        <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
      </Link>
      <Link href="/dashboard/leaks/claims" className={linkCls}>
        <FileCheck2 className="h-4 w-4" aria-hidden="true" />
        {t('claims.open')}
      </Link>
      {canReport ? (
        <Link href="/dashboard/leaks/report" className={linkCls}>
          <FileBarChart className="h-4 w-4" aria-hidden="true" />
          {t('report.open')}
        </Link>
      ) : null}
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
        <SectionHeader level={1} title={t('hub.title')} subtitle={t('hub.subtitle')} />
        <div className="flex flex-col">
          <div className="order-last sm:order-first">{leakLinks}</div>
          {explorer}
        </div>
        <OverContractCard variant="compact" />
        <SectionHeader title={t('detective.title')} />
        <EntitlementUpsell feature="advanced_analytics" title={t('detective.upsell')} />
      </div>
    );
  }

  if (blocked === 'role') {
    return (
      <div>
        <SectionHeader level={1} title={t('hub.title')} subtitle={t('hub.subtitle')} />
        <div className="flex flex-col">
          <div className="order-last sm:order-first">{leakLinks}</div>
          {explorer}
        </div>
        <OverContractCard variant="compact" />
        {/* T4: a calm note, never an alarm, for a section this role does not see. */}
        <Card padding="md" className="flex items-center gap-3 bg-surface-2 text-muted" data-testid="creep-role-note">
          <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
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
      <SectionHeader level={1} title={t('hub.title')} subtitle={t('hub.subtitle')} />
      <div className="flex flex-col">
        <div className="order-last sm:order-first">{leakLinks}</div>
        {explorer}
      </div>
      {/* Wave-1: lines billed above contract (renders nothing when off / none). */}
      <OverContractCard variant="compact" />

      {/* Prices that rose: a 30-day trend in its own calm section — never the leak's word, red or droplet. */}
      <SectionHeader title={t('detective.title')} subtitle={t('detective.subtitle')} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-6 w-6" />}
          title={t('detective.emptyTitle')}
          description={t('detective.emptyDescription')}
        />
      ) : (
        <div className="space-y-8">
          {/* At-a-glance totals of the price trend — calm warn tone, not the leak's danger. */}
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CreepTile label={t('detective.totalLabel')} value={formatIls(totalExcess, { locale })} title={money(totalExcess)} hint={t('detective.totalHint')} />
            <CreepTile label={t('detective.hotspots')} value={formatNumber(rows.length, locale)} hint={t('detective.hotspotsHint')} />
            <CreepTile
              label={t('detective.worst')}
              value={<bdi>+{formatPercent(worst, locale, 1)}</bdi>}
              hint={t('detective.worstHint')}
            />
          </dl>

          {/* The signature glowing heatmap. */}
          <LeakHeatmap
            items={rows}
            locale={locale}
            labels={{ mild: t('heatmap.mild'), severe: t('heatmap.severe'), more: t('heatmap.more') }}
          />

          {/* Full breakdown table — scrolls horizontally on phones. */}
          {/* Focusable + labelled so keyboard users can scroll it (axe scrollable-region-focusable). */}
          <Card
            elevated
            padding="none"
            flow
            tabIndex={0}
            role="region"
            aria-label={t('detective.caption')}
            className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{t('detective.caption')}</caption>
              <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
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
                      {/* Categories are Hebrew-only data: not shown under English names (leaks-34). */}
                      {locale === 'he' && row.category ? (
                        <div className="text-xs text-subtle" {...originalProps(row.category)}>
                          {row.category}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-3 text-muted">{row.supplierName}</td>
                    <td className="p-3 tabular-nums text-muted">{money(row.baselineP50)}</td>
                    <td className="p-3 tabular-nums text-ink">{money(row.lastObservedPrice)}</td>
                    <td className="p-3">
                      <Badge tone="warning">
                        <bdi>+{formatPercent(row.deltaPct, locale, 1)}</bdi>
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Sparkline data={row.series} />
                    </td>
                    <td className="p-3 font-semibold tabular-nums text-ink">{money(row.monthExcessIls)}</td>
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

function CreepTile({ label, value, hint, title }: { label: string; value: React.ReactNode; hint?: string; title?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="flex items-center gap-2 text-sm font-semibold text-subtle">
        <TrendingUp className="h-4 w-4 text-warn" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-bold tabular-nums text-ink" title={title}>
        {value}
      </dd>
      {hint ? <dd className="mt-1 text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
