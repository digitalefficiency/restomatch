import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canSeeRoute } from '@/lib/roles';
import { Activity, ArrowLeft, CheckCircle2, ClipboardCheck, FileText, Hourglass, ShieldCheck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { overview } from '@/lib/i18n/messages/overview';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import type { Translator } from '@/lib/i18n/translate';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import {
  EmptyState,
  EntitlementUpsell,
  KpiCard,
  LeakHeatmap,
  SectionHeader,
  entitlementCauseOf,
} from '@/lib/components';
import {
  BreakdownChart,
  DEFAULT_VIEW,
  DeltaBadge,
  TvMode,
  ViewToolbar,
  bucketLabel,
  hasFilters,
  isDefaultData,
  parseView,
  rangeLabel,
  serializeView,
  localDay,
  toViewInput,
} from '@/lib/components/views';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { PaginatedActivityFeed } from './activity';
import { displayName } from './approvals/vocab';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = parseView(await searchParams);
  const caller = await createServerCaller();
  const [session, memberships] = await Promise.all([auth(), caller.onboarding.myMemberships()]);
  if (memberships.length === 0) {
    redirect('/onboarding');
  }
  // Fetch only what the active role may see (the hero is for every role).
  const role = (
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0]!
  ).role;
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  const canDecide = canSeeRoute(role, '/dashboard/approvals');
  const [t, tl, tv, locale] = await Promise.all([getT(overview), getT(leaksNs), getT(viewsNs), getLocale()]);

  // The default view (this month, no compare, no filters) is the classic hero —
  // owner.leakHero, untouched. Any other view goes through owner.leakSummary,
  // which returns the same shape for the chosen range/filters (+ comparison).
  const defaultView = isDefaultData(view);
  // Filters are finance detail (the router enforces it too): other roles get the period only.
  const viewInput = toViewInput(canDrill ? view : { ...view, filters: DEFAULT_VIEW.filters });
  const [kpis, summary, lastMonth, activity, trend, options, flags, tr] = await Promise.all([
    caller.owner.kpis(),
    defaultView
      ? caller.owner.leakHero().then((current) => ({ current, previous: null }))
      : caller.owner.leakSummary({ view: viewInput, compare: view.compare }),
    defaultView ? caller.owner.leakHero({ monthOffset: -1 }) : Promise.resolve(null),
    caller.activity.feed({ limit: 8 }),
    // The trend exposes per-day detail → finance roles only (owner.leakTrend is finance).
    canDrill ? caller.owner.leakTrend({ view: viewInput, compare: view.compare }) : Promise.resolve(null),
    canDrill ? caller.owner.viewOptions() : Promise.resolve(null),
    caller.recovery.flags(),
    getT(recoveryNs),
  ]);
  const hero = summary.current;
  // A comparison period with no invoices has nothing to compare against.
  const previous = summary.previous && summary.previous.invoiceCount > 0 ? summary.previous : null;
  // Wave 1 (flags `recovery` / `monthlyReport`): "₪ actually returned this month"
  // joins the hero, and a link previews the monthly report.
  const returned = flags.recovery ? await caller.recovery.returnedThisMonth() : null;
  const canPreviewReport = flags.monthlyReport && canSeeRoute(role, '/dashboard/reports');

  // Leak grid is owner-only; other roles simply won't see this section. If the
  // feature is gated behind a paid plan, surface a compact upsell teaser rather
  // than hiding the section entirely.
  let leaks: Awaited<ReturnType<typeof caller.owner.leaks>> = [];
  let leaksEntitlementBlocked = false;
  try {
    // owner.leaks is owner-only: don't call it (and log FORBIDDEN) for other roles.
    if (role === 'owner') leaks = await caller.owner.leaks({ limit: 8 });
  } catch (err) {
    if (entitlementCauseOf(err)) {
      leaksEntitlementBlocked = true;
    }
    // Role/other errors: silently omit the section (non-owners don't see it).
    leaks = [];
  }

  const ils = (v: number) => formatIls(v, { locale });
  const monthLabel = rangeLabel(view.period, hero.monthStart, hero.monthEnd, locale);
  // Drill-down keeps the period + filters (not the display-only controls).
  const drillQuery = serializeView({ ...DEFAULT_VIEW, period: view.period, from: view.from, to: view.to, filters: view.filters }).toString();
  const trendRows =
    trend?.points.map((p) => ({
      key: p.bucketStart,
      label: bucketLabel(trend.bucket, p.bucketStart, locale),
      value: p.leakIls,
      // Trend points are sparse (days/months with invoices), so a per-point
      // comparison can't be aligned honestly; the period delta lives on the hero.
      previous: null,
      spend: p.spendIls,
    })) ?? [];
  // NUM-10: null = no match runs this week — show "no matches yet", never a fake 100%.
  const cleanMatchHealthy = kpis.weekCleanMatchPct == null || kpis.weekCleanMatchPct >= 80;
  const heatmapItems = leaks.map((l) => ({
    ...l,
    productName: displayName(locale, l.productName, l.productNameEn),
    supplierName: displayName(locale, l.supplierName, l.supplierNameEn),
    monthExcessIls: l.paidExcessIls,
  }));

  const pendingCard = (
    <KpiCard
      label={t('kpis.pending')}
      value={formatNumber(kpis.pendingApprovalsCount, locale)}
      tone={kpis.pendingApprovalsCount > 0 ? 'warning' : 'neutral'}
      icon={<ClipboardCheck className="h-5 w-5" />}
      subtitle={t('kpis.pendingHint')}
    />
  );

  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />

      <ViewToolbar
        page="overview"
        view={view}
        period
        compare
        chart={canDrill}
        tv
        saved
        filters={canDrill ? ['supplier', 'category', 'type', 'severity', 'status'] : []}
        options={options ?? undefined}
        exportData={
          trend
            ? {
                columns: [
                  { key: 'bucket', label: tv('trend.colBucket') },
                  { key: 'leak', label: tv('trend.colLeak') },
                  { key: 'spend', label: tv('trend.colSpend') },
                ],
                rows: trend.points.map((p) => ({ bucket: localDay(p.bucketStart), leak: p.leakIls, spend: p.spendIls })),
              }
            : undefined
        }
      />

      <TvMode active={view.tv}>
      {canDrill && hasFilters(view) ? <p className="mb-3 text-xs text-subtle">{tv('filteredNote')}</p> : null}
      <LeakHero
        t={t}
        hero={hero}
        ils={ils}
        monthLabel={monthLabel}
        canDrill={canDrill}
        leakedLabel={view.period === 'this_month' ? t('hero.leakedLabel') : tv('kpis.leak')}
        drillHref={drillQuery ? `/dashboard/leaks/breakdown?${drillQuery}` : '/dashboard/leaks/breakdown'}
        lastMonthLeak={lastMonth && lastMonth.invoiceCount > 0 ? lastMonth.leakIls : null}
        delta={
          view.compare !== 'off' ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <DeltaBadge current={hero.leakIls} previous={previous?.leakIls} compare={view.compare} showAmount />
              {previous ? (
                <DeltaBadge current={hero.spendIls} previous={previous.spendIls} compare={view.compare} neutral />
              ) : null}
            </div>
          ) : null
        }
        pct={(v) => formatPercent(v, locale, 1)}
        num={(v) => formatNumber(v, locale)}
        returned={
          returned
            ? {
                label: tr('hero.returnedTile'),
                value: ils(returned.returnedAgorot / 100),
                hint: tr('hero.returnedHint'),
                href: canSeeRoute(role, '/dashboard/recovery') ? '/dashboard/recovery' : undefined,
              }
            : undefined
        }
        reportLink={canPreviewReport ? tr('report.preview') : undefined}
      />

      {trend ? (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <SectionHeader
            title={tv('trend.title')}
            subtitle={tv('trend.subtitle', { bucket: tv(trend.bucket === 'day' ? 'trend.day' : 'trend.month') })}
          />
          <BreakdownChart
            rows={trendRows}
            chart={view.chart}
            density={view.density}
            caption={tv('trend.title')}
            keyHeader={tv('trend.colBucket')}
            valueHeader={tv('trend.colLeak')}
            emptyText={tv('trend.empty')}
          />
        </section>
      ) : null}

      {/* Secondary KPIs — the decisions waiting and the match health. */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {canDecide ? (
          <Link
            href="/dashboard/approvals"
            className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {pendingCard}
          </Link>
        ) : (
          pendingCard
        )}
        <KpiCard
          label={t('kpis.clean')}
          value={kpis.weekCleanMatchPct == null ? '—' : formatPercent(kpis.weekCleanMatchPct / 100, locale, 1)}
          tone={kpis.weekCleanMatchPct == null ? 'neutral' : cleanMatchHealthy ? 'accent' : 'warning'}
          icon={<CheckCircle2 className="h-5 w-5" />}
          subtitle={kpis.weekCleanMatchPct == null ? t('kpis.cleanNone') : t('kpis.cleanHint')}
        />
      </div>
      </TvMode>

      {/* Leak heatmap — the centerpiece data-viz. */}
      {leaksEntitlementBlocked ? (
        <div className="mt-12">
          <SectionHeader title={t('leaks.title')} subtitle={t('leaks.subtitle')} />
          <EntitlementUpsell feature="advanced_analytics" title={t('leaks.upsell')} compact />
        </div>
      ) : leaks.length > 0 ? (
        <div className="mt-12">
          <SectionHeader
            title={t('leaks.title')}
            subtitle={t('leaks.subtitle')}
            action={
              <Link
                href="/dashboard/leaks"
                className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-primary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {t('leaks.all')}
                <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
              </Link>
            }
          />
          <LeakHeatmap
            items={heatmapItems}
            max={8}
            locale={locale}
            labels={{ mild: tl('heatmap.mild'), severe: tl('heatmap.severe'), more: tl('heatmap.more') }}
          />
        </div>
      ) : null}

      {/* Live activity feed. */}
      <div className="mt-12">
        <SectionHeader title={t('activity.title')} subtitle={t('activity.subtitle')} />
        {activity.length > 0 ? (
          <PaginatedActivityFeed initial={activity} />
        ) : (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title={t('activity.emptyTitle')}
            description={t('activity.emptyDescription')}
          />
        )}
      </div>
    </div>
  );
}

type Hero = Awaited<ReturnType<Awaited<ReturnType<typeof createServerCaller>>['owner']['leakHero']>>;
type OverviewT = Translator<typeof overviewHe>;

/**
 * The 10-second story: "₪X leaked this month · Y% of spend · Z caught before
 * payment", with one tap to the invoices behind X. Calm (not alarming) when the
 * month is clean, and consolidated / no-PO invoices are shown as pending.
 */
function LeakHero({
  t,
  hero,
  ils,
  monthLabel,
  canDrill,
  leakedLabel,
  drillHref,
  lastMonthLeak,
  delta,
  pct,
  num,
  returned,
  reportLink,
}: {
  t: OverviewT;
  hero: Hero;
  ils: (v: number) => string;
  monthLabel: string;
  /** Finance roles may open the drill-down (owner.leakBreakdown is owner/manager/bookkeeper). */
  canDrill: boolean;
  leakedLabel: string;
  drillHref: string;
  lastMonthLeak: number | null;
  /** ▲/▼ against the comparison period (view controls). */
  delta?: React.ReactNode;
  pct: (v: number) => string;
  num: (v: number) => string;
  /** Flag `recovery`: "₪ actually returned this month" tile. */
  returned?: { label: string; value: string; hint?: string; href?: string };
  /** Flag `monthlyReport`: label of the "preview this month's report" link. */
  reportLink?: string;
}) {
  const hasLeak = hero.leakIls > 0;
  return (
    <section
      aria-labelledby="leak-hero-label"
      className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7"
    >
      <div className="absolute inset-x-0 top-0 h-px flow-stream" aria-hidden="true" />
      <div
        className={`pointer-events-none absolute -bottom-20 -start-16 h-64 w-64 rounded-full opacity-70 blur-3xl ${hasLeak ? 'glow-danger-blob' : 'glow-primary-blob'}`}
        aria-hidden="true"
      />

      <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {t('hero.eyebrow', { month: monthLabel })}
      </p>

      <div className="mt-3 grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div className="min-w-0">
          <h2 id="leak-hero-label" className="text-sm font-semibold text-muted">
            {leakedLabel}
          </h2>
          <p
            className={`mt-1 font-mono text-5xl font-extrabold tabular-nums tracking-tight sm:text-6xl ${hasLeak ? 'text-danger' : 'text-primary'}`}
          >
            {ils(hero.leakIls)}
          </p>
          <p className="mt-2 text-base font-semibold text-ink">
            {hero.leakPct != null ? t('hero.pctOfSpend', { pct: pct(hero.leakPct) }) : t('hero.noSpend')}
            {hero.spendIls > 0 ? (
              <span className="ms-2 text-sm font-normal text-muted">
                {t('hero.spendBase', { spend: ils(hero.spendIls) })}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-subtle">
            {t('hero.target')}
            {lastMonthLeak != null ? <> · {t('hero.lastMonth', { amount: ils(lastMonthLeak) })}</> : null}
          </p>
          {delta}
          {!hasLeak && hero.matchedInvoiceCount > 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-primary">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('hero.clean')}
            </p>
          ) : null}
        </div>

        <dl
          className={`grid grid-cols-1 gap-3 lg:grid-cols-1 ${returned ? 'min-[420px]:grid-cols-2' : 'min-[420px]:grid-cols-3'}`}
        >
          <HeroStat label={t('hero.caught')} value={ils(hero.caughtBeforePaymentIls)} hint={t('hero.caughtHint')} tone="gold" />
          <HeroStat label={t('hero.recovered')} value={ils(hero.recoveredIls)} hint={t('hero.recoveredHint')} tone="primary" />
          <HeroStat
            label={t('hero.invoices')}
            value={t('hero.invoicesValue', { withLeak: num(hero.invoicesWithLeak), total: num(hero.matchedInvoiceCount) })}
          />
          {returned ? (
            <HeroStat
              label={returned.label}
              value={returned.value}
              hint={returned.hint}
              tone="gold"
              href={returned.href}
              testId="hero-returned"
            />
          ) : null}
        </dl>
      </div>

      {hero.pendingLinkCount > 0 ? (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          {t('hero.pending', { count: num(hero.pendingLinkCount), amount: ils(hero.pendingLinkIls) })}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs text-subtle">{t('hero.calc')}</p>
        {reportLink ? (
          <Link
            href="/dashboard/reports/monthly"
            data-testid="hero-report-preview"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {reportLink}
          </Link>
        ) : null}
        {canDrill && (hasLeak || hero.pendingLinkCount > 0) ? (
          <Link
            href={drillHref}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-danger/12 px-4 py-2 text-sm font-semibold text-danger ring-1 ring-danger/30 transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
          >
            {t('hero.drill')}
            <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function HeroStat({
  label,
  value,
  hint,
  tone,
  href,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'gold' | 'primary';
  /** Optional drill-down (the value becomes a link). */
  href?: string;
  testId?: string;
}) {
  const color = tone === 'gold' ? 'text-gold' : tone === 'primary' ? 'text-primary' : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3" data-testid={testId}>
      <dt className="text-xs font-semibold text-subtle">{label}</dt>
      <dd className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${color}`}>
        {href ? (
          <Link href={href} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
      {hint ? <dd className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</dd> : null}
    </div>
  );
}
