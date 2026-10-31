import Link from 'next/link';
import { Activity, ArrowLeft, Hourglass } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { canSeeRoute } from '@/lib/roles';
import { followUps } from '../recovery/logic';
import { claimNeedRows } from './claims';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import type { he as viewsHe } from '@/lib/i18n/messages/views/he';
import type { he as leaksHe } from '@/lib/i18n/messages/leaks/he';
import type { he as recoveryHe } from '@/lib/i18n/messages/recovery/he';
import type { he as leakProofHe } from '@/lib/i18n/messages/leakProof/he';
import { EmptyState, EntitlementUpsell, LeakHeatmap, SectionHeader, entitlementCauseOf } from '@/lib/components';
import { LeakHero, daySpan, heroDelta, leakHeroState, leakSplit, showsPct, type LeakHeroProps } from '@/lib/components/hero';
import {
  BreakdownChart,
  DEFAULT_VIEW,
  TvMode,
  ViewToolbar,
  bucketLabel,
  hasFilters,
  isDefaultData,
  localDay,
  rangeLabel,
  serializeView,
  toViewInput,
  type ViewState,
} from '@/lib/components/views';
import { PaginatedActivityFeed } from '../activity';
import { PriceAlertsTeaser } from '../contracts/overview-card';
import { RecipesOverviewCard } from '../recipes/overview-card';
import { VatAtRiskCard } from '../vat-at-risk';
import { displayName } from '../approvals/vocab';
import type { Caller } from './caller';
import { buildBoard } from './board';
import { todayCutoffs } from './cutoffs';
import {
  loadDecide,
  loadOpenCount,
  loadHeroPair,
  loadPayRun,
  loadRecoveryFlags,
  loadRecoveryClaims,
  loadSuppliers,
  loadToday,
  loadTrend,
  loadVatAtRisk, loadNeedsLines } from './data';
import { NeedsYou, type NeedRow, type NeedTone } from './needs-you';
import { HomeSection, Suspense } from './section';
import { CardSkeleton, HeroSkeleton, NeedsSkeleton } from './skeletons';
import { ViewDisclosure } from './view-disclosure';

export type FinanceRole = Extract<UserRole, 'owner' | 'manager' | 'bookkeeper'>;

export interface Translators {
  t: Translator<typeof overviewHe>;
  tv: Translator<typeof viewsHe>;
  tl: Translator<typeof leaksHe>;
  tr: Translator<typeof recoveryHe>;
  tp: Translator<typeof leakProofHe>;
}

interface Ctx extends Translators {
  caller: Caller;
  role: FinanceRole;
  restaurantId: string;
  restaurantName: string;
  locale: Locale;
  view: ViewState;
  fail: Set<string>;
}

/**
 * Owner / manager / bookkeeper homes: "מחכה לך" first (T2, in ₪), then a
 * compact T1 hero, then context. Desktop: a 12-column grid (main 8, rail 4),
 * the strip across the top. Phone: the hero, then the stack of ≤3 rows.
 * Every card streams and fails on its own.
 */
export function FinanceHome(ctx: Ctx) {
  const { role, fail, t, tv, view } = ctx;
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-5 lg:gap-y-4">
      <div className="max-lg:order-2 lg:col-span-12">
        <HomeSection name="needs" fallback={<NeedsSkeleton rows={4} />} forceFail={fail.has('needs')}>
          <Needs {...ctx} />
        </HomeSection>
      </div>

      {/* Main column; below lg its children join the page's single column (hero first). */}
      <div className="max-lg:contents lg:col-span-8 lg:space-y-4">
        {/* Phone: the toolbar sits under the money ("מחכה לך" first); desktop: above the hero. */}
        <div className="max-lg:order-3">
          <ViewDisclosure active={hasFilters(view) || !isDefaultData(view)}>
            <Suspense fallback={<div className="h-11" />}>
              <Toolbar {...ctx} />
            </Suspense>
          </ViewDisclosure>
        </div>
        <div className="max-lg:order-1">
          {canDrill && hasFilters(view) ? <p className="mb-2 text-xs text-muted">{tv('filteredNote')}</p> : null}
          <TvMode active={view.tv}>
            <HomeSection name="hero" fallback={<HeroSkeleton />} forceFail={fail.has('hero')}>
              <Hero {...ctx} />
            </HomeSection>
          </TvMode>
        </div>

        <div className="max-lg:order-3">
          <HomeSection name="notes" fallback={null} forceFail={fail.has('notes')}>
            <HeroNotes {...ctx} />
          </HomeSection>
        </div>

        {canDrill ? (
          <details className="group max-lg:order-3 rounded-2xl border border-line bg-surface shadow-card" data-testid="home-trend">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden">
              {t('hero.trendShow')}
              <ArrowLeft className="h-4 w-4 transition-transform group-open:-rotate-90 ltr:-scale-x-100" aria-hidden="true" />
            </summary>
            <div className="px-4 pb-4">
              <HomeSection name="trend" fallback={<CardSkeleton className="h-64" />} forceFail={fail.has('trend')}>
                <Trend {...ctx} />
              </HomeSection>
            </div>
          </details>
        ) : null}

        {role === 'owner' ? (
          <div className="max-lg:order-3">
            <HomeSection name="heatmap" fallback={<CardSkeleton className="h-48" />} forceFail={fail.has('heatmap')}>
              <Heatmap {...ctx} />
            </HomeSection>
          </div>
        ) : null}

        <div className="max-lg:order-5">
          <HomeSection name="activity" fallback={<CardSkeleton className="h-72" />} forceFail={fail.has('activity')}>
            <ActivitySection {...ctx} />
          </HomeSection>
        </div>
      </div>

      <aside className="space-y-4 max-lg:order-4 lg:col-span-4" aria-label={t('rail.title')}>
        <HomeSection name="vat" fallback={<CardSkeleton className="h-32" />} forceFail={fail.has('vat')}>
          <VatSection {...ctx} />
        </HomeSection>
        <HomeSection name="returned" fallback={<CardSkeleton className="h-24" />} forceFail={fail.has('returned')}>
          <ReturnedTile {...ctx} />
        </HomeSection>
        <HomeSection name="alerts" fallback={null} forceFail={fail.has('alerts')}>
          <div className="[&>a]:mt-0">
            <PriceAlertsTeaser />
          </div>
        </HomeSection>
        {!view.tv && canSeeRoute(role, '/dashboard/recipes') ? (
          <HomeSection name="recipes" fallback={<CardSkeleton className="h-40" />} forceFail={fail.has('recipes')}>
            <div className="[&>*]:mt-0">
              <RecipesOverviewCard />
            </div>
          </HomeSection>
        ) : null}
      </aside>
    </div>
  );
}

/** The view toolbar; its filter menus and CSV come from the (cached) finance reads, best-effort. */
async function Toolbar(ctx: Ctx) {
  const { role, view, tv } = ctx;
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  const [options, trend] = canDrill
    ? await Promise.all([ctx.caller.owner.viewOptions().catch(() => undefined), loadTrend(JSON.stringify(toViewInput(view)), view.compare).catch(() => null)])
    : [undefined, null];
  return (
    <ViewToolbar
      page="overview"
      view={view}
      period
      compare
      chart={canDrill}
      tv
      saved
      filters={canDrill ? ['supplier', 'category', 'type', 'severity', 'status'] : []}
      options={options}
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
  );
}

/* ─────────────────────────────── מחכה לך ─────────────────────────────── */

type Settled<T> = { ok: true; value: T } | { ok: false };
const settle = <T,>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }));
const TONE_RANK: Record<NeedTone, number> = { danger: 0, warn: 1, neutral: 2 };

async function Needs(ctx: Ctx) {
  const { role, t, locale, restaurantId } = ctx;
  const ils = (v: number) => formatIls(v, { locale });
  const n = (v: number) => formatNumber(v, locale);
  const wants = {
    claims: role === 'owner' || role === 'manager',
    vat: role === 'owner' || role === 'bookkeeper',
    payRun: role === 'owner' || role === 'bookkeeper',
    ops: role === 'manager',
    // PILOT (W2-02): an unread photo invoice needs a person to complete its lines.
    lines: role === 'owner' || role === 'manager',
  };
  const [queue, recovery, vat, payRun, today, count, suppliers, lines] = await Promise.all([
    settle(loadDecide()),
    wants.claims ? settle(loadRecoveryClaims()) : null,
    wants.vat ? settle(loadVatAtRisk(restaurantId, role)) : null,
    wants.payRun ? settle(loadPayRun()) : null,
    wants.ops ? settle(loadToday()) : null,
    wants.ops ? settle(loadOpenCount()) : null,
    wants.ops ? settle(loadSuppliers()) : null,
    wants.lines ? settle(loadNeedsLines()) : null,
  ]);
  const sources: Settled<unknown>[] = [queue, recovery, vat, payRun, today, count, suppliers, lines].filter((x) => x !== null) as Settled<unknown>[];
  const rows: NeedRow[] = [];

  // The decision queue is this card's core: if it can't be read, the card fails
  // ("לא נטען · נסו שוב") rather than silently dropping its first row.
  if (!queue.ok) throw new Error('[home] the decision queue could not be read');
  const q = queue.value;
  if (q.count > 0) {
    rows.push({
      key: 'decide',
      tone: q.blocking > 0 ? 'danger' : 'warn',
      label: t('needs.decide.label'),
      // The approvals "ניתן לדרוש מהספקים" tile, same server rule (before VAT).
      value: ils(q.amountIls),
      sub: [
        q.blocking > 0 ? t('needs.decide.subBlocking', { count: n(q.count), blocking: n(q.blocking) }) : t('needs.decide.sub', { count: n(q.count) }),
        q.toReview > 0 ? t('needs.decide.review', { count: n(q.toReview) }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      notes:
        [
          q.duplicateIls > 0 ? t('needs.decide.duplicates', { amount: ils(q.duplicateIls) }) : null,
          q.vatIls > 0 ? t('needs.decide.vat', { amount: ils(q.vatIls) }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      verb: t('needs.decide.verb'),
      href: '/dashboard/approvals',
    });
  }
  if (role === 'manager' && suppliers?.ok) {
    const cut = todayCutoffs(suppliers.value, new Date());
    if (cut.length > 0) {
      const first = cut[0]!;
      rows.push({
        key: 'cutoffs',
        tone: first.minutesLeft <= 60 ? 'warn' : 'neutral',
        label: t('needs.cutoffs.label'),
        value: t('needs.cutoffsValue', { count: n(cut.length) }),
        sub: t('needs.cutoffs.sub', { supplier: locale === 'en' && first.supplierNameEn ? first.supplierNameEn : first.supplierName, time: first.cutoff }),
        verb: t('needs.cutoffs.verb'),
        href: '/dashboard/orders/new',
      });
    }
  }
  if (recovery?.ok && recovery.value) {
    // The recovery page's own follow-up queues, to the agora (same rule, same words).
    const exact = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
    rows.push(...claimNeedRows(followUps(recovery.value, new Date().toISOString()), { t, money: exact, n }));
  }
  if (vat?.ok && vat.value && vat.value.rows.length > 0) {
    const v = vat.value;
    const days = Math.min(...v.rows.map((r) => r.daysLeft));
    rows.push({
      key: 'vat',
      // H8: neutral far from the deadline, warn inside 30 days, danger inside 7 (or late).
      tone: days <= 7 ? 'danger' : days <= 30 ? 'warn' : 'neutral',
      label: t('needs.vat.label'),
      value: ils(v.totalVatAtRisk),
      sub: t('needs.vat.sub', { count: n(v.rows.length), days: n(Math.max(0, days)) }),
      verb: t('needs.vat.verb'),
      href: v.rows.length === 1 ? `/dashboard/invoices/${v.rows[0]!.invoiceId}` : '#vat-at-risk',
    });
  }
  if (payRun?.ok && payRun.value?.enabled && payRun.value.totals.payIls > 0) {
    const toPay = payRun.value.suppliers.reduce((sum, s) => sum + s.invoices.filter((i) => i.status === 'pay').length, 0);
    rows.push({
      key: 'payRun',
      tone: 'neutral',
      label: t('needs.payRun.label'),
      value: ils(payRun.value.totals.payIls),
      sub: t('needs.payRun.sub', { count: n(toPay) }),
      verb: t('needs.payRun.verb'),
      href: '/dashboard/approvals/pay-run',
    });
  }
  if (today?.ok && today.value.length > 0) {
    const b = buildBoard(today.value);
    rows.push({
      key: 'deliveries',
      tone: b.summary.late > 0 ? 'warn' : 'neutral',
      label: t('needs.deliveries.label'),
      value: t('needs.deliveriesValue', { count: n(b.summary.total) }),
      sub: t('needs.deliveries.sub', { received: n(b.summary.received), late: n(b.summary.late) }),
      verb: t('needs.deliveries.verb'),
      href: '/dashboard/receiving',
    });
  }
  if (count?.ok && count.value && count.value.status === 'draft') {
    const p = count.value.progress;
    rows.push({
      key: 'count',
      tone: 'neutral',
      label: t('needs.count.label'),
      value: t('needs.countValue', { counted: n(p.counted), lines: n(p.lines) }),
      sub: t('needs.count.sub', { counted: n(p.counted), lines: n(p.lines) }),
      verb: t('needs.count.verb'),
      href: '/dashboard/inventory/count',
    });
  }
  if (lines?.ok && lines.value.count > 0) {
    rows.push({
      key: 'invoiceLines',
      // Only held-for-review invoices (T4) → neutral; any failed / unread read → warn.
      tone: lines.value.rows.every((r) => r.reason === 'held') ? 'neutral' : 'warn',
      label: t('needs.invoiceLines.label'),
      value: t('needs.invoiceLinesValue', { count: lines.value.count }),
      verb: t('needs.invoiceLines.verb'),
      href: '/dashboard/invoices',
    });
  }
  if (role === 'bookkeeper') {
    // PLACEHOLDER (W1-05): exports keep no log yet, so there is no real "last export" date.
    rows.push({
      key: 'export',
      tone: 'neutral',
      label: t('needs.exportLast.label'),
      value: t('needs.exportLast.value'),
      verb: t('needs.exportLast.verb'),
      href: '/dashboard/exports',
    });
  }

  // Unknown is never "all handled": a source that failed with nothing else to show fails the card.
  const actionable = rows.filter((r) => r.key !== 'export');
  if (actionable.length === 0 && sources.some((s) => !s.ok)) throw new Error('[home] needs-you sources failed');

  const ranked = [...rows].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return (
    <div className={role === 'owner' ? '[&_#needs-you-title]:sr-only' : '[&_#needs-you-title]:lg:sr-only'}>
      <NeedsYou
        title={t('needs.title')}
        rows={ranked}
        zero={role === 'bookkeeper' ? t('needs.zero') : t('needs.zeroCaught')}
        moreLabel={(c) => t('needs.more', { count: n(c) })}
      />
    </div>
  );
}

/* ─────────────────────────────── T1 hero ─────────────────────────────── */

function spanLabel(t: Ctx['t'], locale: Locale, from: Date, to: Date, withYear = false): string {
  const sameMonth = formatDate(from, locale, { month: 'numeric', year: 'numeric' }) === formatDate(to, locale, { month: 'numeric', year: 'numeric' });
  if (!sameMonth) {
    const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' as const } : {}) };
    return `${formatDate(from, locale, o)}–${formatDate(to, locale, o)}`;
  }
  return t('hero.range', {
    from: formatDate(from, locale, { day: 'numeric' }),
    to: formatDate(to, locale, { day: 'numeric' }),
    // A year-over-year comparison names its year ("1–25 באוקטובר 2025").
    month: formatDate(from, locale, withYear ? { month: 'long', year: 'numeric' } : { month: 'long' }),
  });
}

async function Hero(ctx: Ctx) {
  const { role, view, t, tv, tr, locale } = ctx;
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  const defaultView = isDefaultData(view);
  const viewInput = toViewInput(canDrill ? view : { ...view, filters: DEFAULT_VIEW.filters });
  // The comparison is always the same day-span (leak-views cuts a running period at today).
  const compare = view.compare === 'yoy' ? 'yoy' : 'prev';
  const [{ current, previous }, flags] = await Promise.all([
    loadHeroPair(JSON.stringify(defaultView ? toViewInput(DEFAULT_VIEW) : viewInput), compare, defaultView),
    loadRecoveryFlags(),
  ]);
  const ils = (v: number) => formatIls(v, { locale });
  const n = (v: number) => formatNumber(v, locale);
  const state = leakHeroState(current);
  const split = leakSplit(current);

  const drillQuery = serializeView({ ...DEFAULT_VIEW, period: view.period, from: view.from, to: view.to, filters: view.filters }).toString();
  const drillHref = drillQuery ? `/dashboard/leaks/breakdown?${drillQuery}` : '/dashboard/leaks/breakdown';
  const thisMonth = view.period === 'this_month';
  const curSpan = daySpan(current.monthStart, current.monthEnd);
  const today = new Date();
  const eyebrowRange = thisMonth ? spanLabel(t, locale, curSpan.from, today < curSpan.to ? today : curSpan.to) : rangeLabel(view.period, current.monthStart, current.monthEnd, locale);

  const d = heroDelta(current, previous);
  let delta: LeakHeroProps['delta'] = null;
  if (state === 'leak' || state === 'clean') {
    if (!d || !previous) delta = { none: compare === 'yoy' ? t('hero.delta.noneYoy') : t('hero.delta.none') };
    else {
      const prevSpan = daySpan(previous.monthStart, previous.monthEnd);
      const pctText = d.pct == null ? '' : ` (${formatNumber(d.pct, locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })})`;
      const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '';
      delta = {
        direction: d.direction,
        word: d.direction === 'up' ? t('hero.delta.up') : d.direction === 'down' ? t('hero.delta.down') : t('hero.delta.same'),
        text: `${arrow} ${d.direction === 'same' ? '' : ils(d.amountIls)}${pctText} ${t('hero.delta.vs', { range: spanLabel(t, locale, prevSpan.from, prevSpan.to, compare === 'yoy') })}`.replace(/\s+/g, ' ').trim(),
      };
    }
  }

  const canProve = flags.leakProof && defaultView && canSeeRoute(role, '/dashboard/leaks/proof');
  const moreItems = [
    ...(flags.monthlyReport && canSeeRoute(role, '/dashboard/reports') ? [{ label: tr('report.preview'), href: '/dashboard/reports/monthly', testId: 'hero-report-preview' }] : []),
    ...(flags.monthlyDigestPreview && canSeeRoute(role, '/dashboard/reports/digest') ? [{ label: tr('digest.title'), href: '/dashboard/reports/digest', testId: 'hero-digest-preview' }] : []),
  ];
  const pct = showsPct(current) ? t('hero.pctOfSpend', { pct: formatPercent(current.leakPct!, locale, 1) }) : null;

  return (
    <div>
      <LeakHero
        state={state}
        eyebrow={t('hero.eyebrow', { month: eyebrowRange })}
        label={thisMonth ? t('hero.leakedLabel') : tv('kpis.leak')}
        amount={ils(current.leakIls)}
        amountHref={canDrill ? drillHref : undefined}
        pctLine={pct}
        baseLine={current.spendIls > 0 ? t('hero.spendBase', { spend: ils(current.spendIls) }) : null}
        thinNote={!pct && current.matchedInvoiceCount > 0 ? t('hero.thinBase', { count: n(current.matchedInvoiceCount) }) : null}
        delta={delta}
        splitLabel={t('hero.split')}
        parts={
          state === 'leak'
            ? [
                // By payment status, so the parts add up to the hero (leakSplit). Never labelled
                // "awaiting a decision": the engine figure is the leak on UNPAID invoices.
                { label: t('hero.unpaid'), value: ils(split.unpaidIls), href: canDrill ? drillHref : undefined, testId: 'hero-unpaid' },
                { label: t('hero.paid'), value: ils(split.paidIls), href: canDrill ? '/dashboard/leaks/claims' : undefined, testId: 'hero-paid' },
              ]
            : undefined
        }
        completeness={
          current.matchedInvoiceCount > 0
            ? { text: t('hero.invoicesLine', { total: n(current.matchedInvoiceCount), withLeak: n(current.invoicesWithLeak) }), href: canDrill ? drillHref : undefined }
            : null
        }
        cleanSentence={t('hero.clean', { count: n(current.matchedInvoiceCount) })}
        noData={{
          title: t('hero.noData.title', { month: formatDate(current.monthStart, locale, { month: 'long' }) }),
          hint: t('hero.noData.hint'),
          // The camera CTA only where invoices are snapped (receiving); the bookkeeper gets the hint alone.
          cta: canSeeRoute(role, '/dashboard/receiving') ? { label: t('hero.noData.cta'), href: '/dashboard/receiving', testId: 'hero-nodata-cta' } : null,
        }}
        primary={
          canDrill && (state === 'leak' || state === 'pendingOnly')
            ? { label: state === 'leak' ? t('hero.drill', { amount: ils(current.leakIls) }) : t('hero.drillPending'), href: drillHref, testId: 'hero-drill' }
            : null
        }
        tertiary={canProve ? { label: t('hero.howCalc'), href: '/dashboard/leaks/proof', testId: 'hero-proof' } : null}
        calcNote={t('hero.calc')}
        calcLabel={t('hero.howCalc')}
        more={moreItems.length ? { label: t('hero.more'), items: moreItems } : null}
      />
    </div>
  );
}

/** T4 notes under the hero (consolidated invoices waiting for a link, scans waiting for a count). */
async function HeroNotes({ role, view, t, locale }: Ctx) {
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  const viewInput = toViewInput(canDrill ? view : { ...view, filters: DEFAULT_VIEW.filters });
  const defaultView = isDefaultData(view);
  const { current } = await loadHeroPair(
    JSON.stringify(defaultView ? toViewInput(DEFAULT_VIEW) : viewInput),
    view.compare === 'yoy' ? 'yoy' : 'prev',
    defaultView,
  );
  const ils = (v: number) => formatIls(v, { locale });
  const n = (v: number) => formatNumber(v, locale);
  if (current.pendingLinkCount === 0 && current.awaitingCountCount === 0) return null;
  return (
    <div className="space-y-2">
      {current.pendingLinkCount > 0 ? (
        <Notice testId="hero-pending-link" text={t('hero.pending', { count: n(current.pendingLinkCount), amount: ils(current.pendingLinkIls) })} />
      ) : null}
      {current.awaitingCountCount > 0 ? (
        <Notice testId="hero-awaiting-count" text={t('hero.awaitingCount', { count: n(current.awaitingCountCount), amount: ils(current.awaitingCountIls) })} />
      ) : null}
    </div>
  );
}

function Notice({ text, testId }: { text: string; testId?: string }) {
  // T4: pending is neutral, never an alarm.
  return (
    <p data-testid={testId} className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      {text}
    </p>
  );
}

/* ─────────────────────────────── context cards ─────────────────────────────── */

async function Trend({ view, tv, locale }: Ctx) {
  const trend = await loadTrend(JSON.stringify(toViewInput(view)), view.compare);
  const rows = trend.points.map((p) => ({
    key: p.bucketStart,
    label: bucketLabel(trend.bucket, p.bucketStart, locale),
    value: p.leakIls,
    previous: null,
    spend: p.spendIls,
  }));
  return (
    <>
      <p className="mb-2 text-xs text-muted">{tv('trend.subtitle', { bucket: tv(trend.bucket === 'day' ? 'trend.day' : 'trend.month') })}</p>
      <BreakdownChart
        rows={rows}
        chart={view.chart}
        density={view.density}
        caption={tv('trend.title')}
        keyHeader={tv('trend.colBucket')}
        valueHeader={tv('trend.colLeak')}
        emptyText={tv('trend.empty')}
      />
    </>
  );
}

async function Heatmap({ caller, t, tl, locale }: Ctx) {
  let leaks: Awaited<ReturnType<Caller['owner']['leaks']>>;
  try {
    leaks = await caller.owner.leaks({ limit: 8 });
  } catch (err) {
    if (entitlementCauseOf(err)) {
      return (
        <section>
          <SectionHeader title={t('leaks.title')} subtitle={t('leaks.subtitle')} />
          <EntitlementUpsell feature="advanced_analytics" title={t('leaks.upsell')} compact />
        </section>
      );
    }
    throw err;
  }
  if (leaks.length === 0) return null;
  const items = leaks.map((l) => ({
    ...l,
    productName: displayName(locale, l.productName, l.productNameEn),
    supplierName: displayName(locale, l.supplierName, l.supplierNameEn),
    monthExcessIls: l.paidExcessIls,
  }));
  return (
    <section>
      <SectionHeader
        title={t('leaks.title')}
        subtitle={t('leaks.subtitle')}
        action={
          <Link
            href="/dashboard/leaks#prices"
            className="touch-target inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {t('leaks.all')}
            <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
          </Link>
        }
      />
      <LeakHeatmap items={items} max={6} locale={locale} labels={{ mild: tl('heatmap.mild'), severe: tl('heatmap.severe'), more: tl('heatmap.more') }} />
    </section>
  );
}

async function ActivitySection({ caller, t }: Ctx) {
  const activity = await caller.activity.feed({ limit: 5 });
  return (
    <section data-testid="home-activity">
      <SectionHeader title={t('activity.title')} subtitle={t('activity.subtitle')} />
      {activity.length > 0 ? (
        <PaginatedActivityFeed initial={activity} pageSize={5} />
      ) : (
        <EmptyState icon={<Activity className="h-6 w-6" />} title={t('activity.emptyTitle')} description={t('activity.emptyDescription')} />
      )}
    </section>
  );
}

async function VatSection({ restaurantId, restaurantName, role }: Ctx) {
  const vat = await loadVatAtRisk(restaurantId, role);
  if (!vat || vat.currentThresholdIls == null) return null;
  return (
    <div id="vat-at-risk" className="scroll-mt-24 [&>section]:mt-0">
      <VatAtRiskCard rows={vat.rows} total={vat.totalVatAtRisk} thresholdIls={vat.currentThresholdIls} restaurantName={restaurantName} />
    </div>
  );
}

async function ReturnedTile({ caller, role, t, locale }: Ctx) {
  const flags = await loadRecoveryFlags();
  if (!flags.recovery) return null;
  const returned = await caller.recovery.returnedThisMonth();
  const value = formatIls(returned.returnedAgorot / 100, { locale });
  const body = (
    <>
      <span className="block text-xs font-semibold text-subtle">{t('hero.returned')}</span>
      <span className="mt-0.5 block text-2xl font-bold tabular-nums text-gold">
        <bdi>{value}</bdi>
      </span>
      <span className="mt-0.5 block text-xs text-muted">{t('hero.returnedHint')}</span>
    </>
  );
  const box = 'block rounded-2xl border border-line bg-surface p-4 shadow-card';
  return canSeeRoute(role, '/dashboard/recovery') ? (
    <Link
      href="/dashboard/recovery"
      data-testid="hero-returned"
      className={`${box} min-h-12 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
    >
      {body}
    </Link>
  ) : (
    <div className={box} data-testid="hero-returned">
      {body}
    </div>
  );
}
