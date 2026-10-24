import Link from 'next/link';
import { TRPCError } from '@trpc/server';
import { AlertTriangle, ClipboardCheck, Network, PartyPopper, Radar, Scale, ShieldCheck, Undo2 } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { originalProps } from '@/lib/i18n/original';
import type { Locale } from '@/lib/i18n/config';
import { chain } from '@/lib/i18n/messages/chain';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey } from '@/lib/i18n/translate';
import {
  Badge,
  Card,
  EmptyState,
  EntitlementUpsell,
  KpiCard,
  SectionHeader,
  cn,
  displayName,
  entitlementCauseOf,
} from '@/lib/components';
import { ViewToolbar, parseView, rangeLabel } from '@/lib/components/views';
import { SwitchBranchButton } from './switch-button';
import { wholeShekelRows } from './display';

type Overview = Awaited<ReturnType<Awaited<ReturnType<typeof createServerCaller>>['chain']['overview']>>;
type Alerts = Awaited<ReturnType<Awaited<ReturnType<typeof createServerCaller>>['chain']['alerts']>>;
/** Same floor as the router's ALERT_MIN_LEAK_ILS (copy only). */
const ALERT_MIN_LEAK_ILS = 50;

/** 'YYYY-MM' of an instant in Israel time (heatmap columns are local months). */
function ymOf(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(
    new Date(value),
  );
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

function monthLabel(month: string, locale: Locale, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return formatDate(new Date(Date.UTC(y, m - 1, 15, 12)), locale, {
    month: style,
    year: style === 'long' ? 'numeric' : '2-digit',
  });
}

/** Heatmap colour by leak share of spend — calm green when clean, gold under target, orange → red over it. */
/** Phone: only the last 3 heatmap months (the selected period's end) fit; older ones show from `sm`. */
const HEAT_PHONE_MONTHS = 3;

function heatClass(pct: number | null, leak: number): string {
  // Bands around the 1.5% pilot target. Over target (≥1.5%) gets a stronger tint +
  // inset ring and ink text, so 1.7% never reads as calm; text stays ≥6.5:1.
  if (pct === null) return leak > 0 ? 'bg-warn/30 text-ink ring-1 ring-inset ring-warn/60' : 'bg-surface-2 text-subtle';
  if (pct <= 0) return 'bg-primary/10 text-primary';
  if (pct < 0.01) return 'bg-primary/20 text-primary';
  if (pct < 0.015) return 'bg-gold/20 text-gold';
  if (pct < 0.02) return 'bg-warn/30 text-ink ring-1 ring-inset ring-warn/60';
  if (pct < 0.03) return 'bg-danger/30 text-ink ring-1 ring-inset ring-danger/60';
  return 'bg-danger/50 text-ink font-bold ring-1 ring-inset ring-danger';
}

export default async function ChainPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [caller, t, ta, locale, sp] = await Promise.all([
    createServerCaller(),
    getT(chain),
    getT(approvals),
    getLocale(),
    searchParams,
  ]);
  // The shared view controls (period / custom range / compare) — the URL is the source of truth.
  const view = parseView(sp);

  let data: Overview | null = null;
  let blocked: 'entitlement' | 'role' | null = null;
  // chainAlerts (flag): the weekly card; `enabled: false` when the flag is off.
  // It never blocks the page — an error just hides the card.
  const alertsP: Promise<Alerts | null> = caller.chain.alerts().catch(() => null);
  try {
    data = await caller.chain.overview({
      view: { period: view.period, ...(view.period === 'custom' ? { from: view.from, to: view.to } : {}) },
      compare: view.compare,
    });
  } catch (err) {
    if (entitlementCauseOf(err)) blocked = 'entitlement';
    else if (err instanceof TRPCError && err.code === 'FORBIDDEN') blocked = 'role';
    else throw err;
  }

  if (!data) {
    return (
      <div>
        <SectionHeader level={1} title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        {blocked === 'entitlement' ? (
          <EntitlementUpsell feature="chain" title={t('dashboard.upsell')} />
        ) : (
          <EmptyState
            icon={<Network className="h-6 w-6" />}
            title={t('dashboard.ownerOnly')}
            description={t('dashboard.ownerOnlyBody')}
          />
        )}
        {blocked === 'entitlement' ? (
          <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted">{t('dashboard.upsellBody')}</p>
        ) : null}
      </div>
    );
  }

  const alerts = await alertsP;
  // Display only: whole-₪ rows (= each branch's own dashboard) and totals printed as their sum.
  const leakShown = wholeShekelRows(data.branches.map((b) => b.leakIls));
  const spendShown = wholeShekelRows(data.branches.map((b) => b.spendIls));
  const rowLeak = leakShown.rows;
  const rowSpend = spendShown.rows;
  const ils = (v: number) => formatIls(v, { locale });
  const typeLabel = (v: string) => ta(`types.${v}.label` as MessageKey<typeof approvalsHe>);
  const shortDay = (ymd: string) => formatDate(`${ymd}T12:00:00Z`, locale, { day: 'numeric', month: 'short' });
  const pct = (v: number | null) => (v === null ? t('dashboard.ranking.noSpend') : formatPercent(v, locale, 1));
  const { totals } = data;
  const worst = data.branches.find((b) => b.restaurantId === data.worstBranchId) ?? null;
  const nameOf = new Map(data.branches.map((b) => [b.restaurantId, b.name]));
  const chainSpark = data.months.map((m) =>
    data.heatmap.reduce((acc, row) => acc + (row.cells.find((c) => c.month === m)?.leakIls ?? 0), 0),
  );
  const noData = totals.spendIls === 0 && totals.leakIls === 0;
  const compared = data.compare !== 'off';
  // No % against a comparison period with almost no data (totals.thinBase): calm, never a false alarm.
  const leakDeltaPct =
    totals.prevLeakIls !== null && totals.prevLeakIls > 0 && !totals.thinBase
      ? Math.round(((totals.leakIls - totals.prevLeakIls) / totals.prevLeakIls) * 100)
      : undefined;
  const periodLabel = data.periodStart && data.periodEnd ? rangeLabel(view.period, data.periodStart, data.periodEnd, locale) : '';
  // Heatmap columns inside the selected period are highlighted.
  const inPeriod = new Set<string>();
  if (data.periodStart && data.periodEnd) {
    const first = ymOf(data.periodStart);
    const last = ymOf(new Date(new Date(data.periodEnd).getTime() - 1));
    for (const m of data.months) if (m >= first && m <= last) inPeriod.add(m);
  }
  const phoneHidden = (i: number) => (i < data.months.length - HEAT_PHONE_MONTHS ? 'hidden sm:table-cell' : undefined);

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('dashboard.title')}
        subtitle={
          <>
            {t('dashboard.subtitle')}{' '}
            <span className="text-subtle">{t('dashboard.scopeNote', { count: formatNumber(data.branches.length, locale) })}</span>{' '}
            <Link href="/dashboard/branches" className="font-semibold text-primary hover:text-ink" data-testid="chain-manage-branches">
              {t('switcher.manageLink')}
            </Link>
          </>
        }
      />
      <ViewToolbar
        page="chain"
        view={view}
        period
        compare
        saved
        exportData={{
          columns: [
            { key: 'rank', label: t('dashboard.ranking.rank') },
            { key: 'branch', label: t('dashboard.ranking.branch') },
            { key: 'leak', label: t('dashboard.ranking.leak') },
            { key: 'leakPct', label: t('dashboard.ranking.leakPct') },
            { key: 'spend', label: t('dashboard.ranking.spend') },
            { key: 'open', label: t('dashboard.ranking.open') },
            ...(compared ? [{ key: 'delta', label: t('dashboard.ranking.trend') }] : []),
          ],
          rows: data.branches.map((b) => ({
            rank: b.rank,
            branch: b.name,
            leak: b.leakIls,
            leakPct: b.leakPct === null ? null : Math.round(b.leakPct * 10000) / 100,
            spend: b.spendIls,
            open: b.openDiscrepancies,
            delta: b.leakDeltaIls,
          })),
        }}
      />
      {data.truncated ? (
        <p className="mb-4 text-xs text-warn">{t('dashboard.truncated', { count: formatNumber(data.branches.length, locale) })}</p>
      ) : null}

      <p className="mb-3 font-mono text-xs uppercase tracking-wider text-subtle" data-testid="chain-month-label">
        {periodLabel}
      </p>

      {/* KPI row — the chain's ₪ story. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="chain-kpis">
        <KpiCard
          label={t('dashboard.kpis.leak')}
          value={<span data-testid="chain-leak">{ils(leakShown.total)}</span>}
          tone={totals.leakIls > 0 ? 'danger' : 'accent'}
          emphasis={totals.leakIls > 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          subtitle={t('dashboard.kpis.leakOf', { spend: ils(spendShown.total) })}
          delta={leakDeltaPct}
          deltaTone="bad"
          sparkline={chainSpark}
        />
        <KpiCard
          label={t('dashboard.kpis.leakPct')}
          value={<span data-testid="chain-leak-pct">{totals.leakPct === null ? '—' : formatPercent(totals.leakPct, locale, 1)}</span>}
          tone={totals.leakPct !== null && totals.leakPct >= 0.015 ? 'warning' : 'neutral'}
          icon={<Network className="h-5 w-5" />}
          subtitle={
            compared
              ? t('dashboard.kpis.vsPrev', {
                  value: totals.prevLeakPct === null ? '—' : formatPercent(totals.prevLeakPct, locale, 1),
                })
              : t('dashboard.kpis.leakOf', { spend: ils(spendShown.total) })
          }
        />
        <KpiCard
          label={t('dashboard.kpis.caught')}
          value={ils(totals.caughtBeforePaymentIls)}
          tone="gold"
          icon={<ShieldCheck className="h-5 w-5" />}
          subtitle={
            <>
              {t('dashboard.kpis.caughtHint')}
              <span className="block">
                {t('dashboard.kpis.claimed')}: <span className="font-mono tabular-nums">{ils(totals.claimedIls)}</span>
              </span>
            </>
          }
        />
        <KpiCard
          label={t('dashboard.kpis.pending')}
          value={<span data-testid="chain-open">{formatNumber(totals.openDiscrepancies, locale)}</span>}
          tone={totals.openDiscrepancies > 0 ? 'warning' : 'neutral'}
          icon={<ClipboardCheck className="h-5 w-5" />}
          subtitle={t('dashboard.kpis.pendingHint', { count: formatNumber(totals.pendingApprovals, locale) })}
        />
      </div>

      {/* Worst branch callout. */}
      <Card
        elevated
        padding="md"
        className={cn(
          'mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
          worst ? 'border-danger/30 bg-danger/5' : 'border-primary/25 bg-primary/5',
        )}
      >
        <div className="flex items-start gap-3" data-testid="chain-worst">
          <span
            className={cn(
              'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
              worst ? 'bg-danger/12 text-danger ring-danger/25' : 'bg-primary/12 text-primary ring-primary/25',
            )}
          >
            {worst ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <PartyPopper className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{t('dashboard.worst.title')}</p>
            {worst ? (
              <p className="mt-1 text-base text-ink">
                <span className="font-bold" {...originalProps(worst.name)}>{worst.name}</span>
                <span className="text-muted">
                  {' · '}
                  {t('dashboard.worst.body', {
                    leak: ils(worst.leakIls),
                    pct: pct(worst.leakPct),
                    open: formatNumber(worst.openDiscrepancies, locale),
                  })}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-base text-ink">{t('dashboard.worst.clean')}</p>
            )}
          </div>
        </div>
        {worst && worst.restaurantId !== data.activeRestaurantId ? (
          <SwitchBranchButton restaurantId={worst.restaurantId} label={t('dashboard.worst.cta')} variant="danger" testId="chain-worst-switch" />
        ) : null}
      </Card>

      {/* chainAlerts (flag): the branch to look at this week + each branch's main leak driver. */}
      {alerts?.enabled ? (
        <Card elevated padding="md" className="mt-6" data-testid="chain-alerts">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/12 text-danger ring-1 ring-danger/25">
                <Radar className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{t('dashboard.alerts.title')}</p>
                <p className="text-xs text-subtle" data-testid="chain-alerts-window">
                  {alerts.from && alerts.to ? t('dashboard.alerts.window', { from: shortDay(alerts.from), to: shortDay(alerts.to) }) : null}
                </p>
                {alerts.focus ? (
                  <div className="mt-1" data-testid="chain-alerts-focus">
                    <p className="text-base text-ink">
                      <span className="font-bold" {...originalProps(alerts.focus.name)}>{alerts.focus.name}</span>
                      <span className="text-muted">
                        {' · '}
                        {t('dashboard.alerts.body', { leak: ils(alerts.focus.leakIls), pct: pct(alerts.focus.leakPct) })}
                      </span>
                    </p>
                    {alerts.focus.topDriver ? (
                      <p className="mt-0.5 text-sm text-danger" data-testid="chain-alerts-driver">
                        {t('dashboard.alerts.driver', {
                          type: typeLabel(alerts.focus.topDriver.type),
                          amount: ils(alerts.focus.topDriver.leakIls),
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-base text-ink" data-testid="chain-alerts-calm">
                    {t('dashboard.alerts.calm', { min: ils(ALERT_MIN_LEAK_ILS) })}
                  </p>
                )}
              </div>
            </div>
            {alerts.focus && alerts.focus.restaurantId !== data.activeRestaurantId ? (
              <SwitchBranchButton restaurantId={alerts.focus.restaurantId} label={t('dashboard.alerts.cta')} variant="secondary" testId="chain-alerts-switch" />
            ) : null}
          </div>
          {alerts.branches.length > 1 ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-xs font-semibold text-subtle">{t('dashboard.alerts.byBranch')}</p>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {alerts.branches.map((b) => (
                  <li key={b.restaurantId} className="rounded-lg border border-line/60 bg-surface-2/40 px-3 py-2 text-sm" data-testid="chain-alerts-branch">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold text-ink" {...originalProps(b.name)}>{b.name}</span>
                      <span className={cn('shrink-0 font-mono tabular-nums', b.leakIls > 0 ? 'text-danger' : 'text-subtle')}>{ils(b.leakIls)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {b.topDriver
                        ? `${typeLabel(b.topDriver.type)} · ${ils(b.topDriver.leakIls)}`
                        : t('dashboard.alerts.noLeak')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {noData ? (
        <EmptyState className="mt-8" title={t('dashboard.empty.title')} description={t('dashboard.empty.body')} />
      ) : null}

      {/* Ranking table. */}
      <section className="mt-10">
        <SectionHeader title={t('dashboard.ranking.title')} subtitle={t('dashboard.ranking.subtitle')} />
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full sm:min-w-[44rem] text-sm" data-testid="chain-ranking">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-subtle">
                <th scope="col" className="hidden sm:table-cell px-3 py-3 sm:px-4 text-start font-semibold">{t('dashboard.ranking.rank')}</th>
                <th scope="col" className="px-3 py-3 sm:px-4 text-start font-semibold">{t('dashboard.ranking.branch')}</th>
                <th scope="col" className="px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.ranking.leak')}</th>
                <th scope="col" className="px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.ranking.leakPct')}</th>
                <th scope="col" className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.ranking.spend')}</th>
                <th scope="col" className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.ranking.open')}</th>
                {compared ? <th scope="col" className="px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.ranking.trend')}</th> : null}
                <th scope="col" className="hidden sm:table-cell px-3 py-3 sm:px-4"><span className="sr-only">{t('dashboard.ranking.action')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.branches.map((b, i) => {
                const isWorst = b.restaurantId === data.worstBranchId;
                const isActive = b.restaurantId === data.activeRestaurantId;
                return (
                  <tr key={b.restaurantId} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50" data-testid="chain-branch-row">
                    <td className="hidden sm:table-cell px-3 py-3 sm:px-4 font-mono tabular-nums text-subtle">{formatNumber(b.rank, locale)}</td>
                    <td className="px-3 py-3 sm:px-4">
                      <span className="font-semibold text-ink" {...originalProps(b.name)}>{b.name}</span>
                      {isActive ? <Badge tone="accent" className="ms-2">{t('dashboard.ranking.active')}</Badge> : null}
                      {/* Phone: rank / spend / open / action columns are hidden; the action sits here. */}
                      {isActive ? null : (
                        <div className="mt-1.5 sm:hidden">
                          <SwitchBranchButton restaurantId={b.restaurantId} label={t('dashboard.ranking.switchTo')} variant="ghost" testId="chain-switch" />
                        </div>
                      )}
                    </td>
                    <td className={cn('px-3 py-3 sm:px-4 text-end font-mono tabular-nums', isWorst ? 'font-bold text-danger' : 'text-ink')}>
                      {ils(rowLeak[i]!)}
                    </td>
                    <td className="px-3 py-3 sm:px-4 text-end font-mono tabular-nums text-muted">{pct(b.leakPct)}</td>
                    <td className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end font-mono tabular-nums text-muted">{ils(rowSpend[i]!)}</td>
                    <td className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end font-mono tabular-nums text-muted">{formatNumber(b.openDiscrepancies, locale)}</td>
                    {compared ? (
                      <td className="px-3 py-3 sm:px-4 text-end font-mono text-xs tabular-nums" data-testid="chain-branch-delta">
                        {b.leakDeltaIls === null ? (
                          <span className="text-subtle">—</span>
                        ) : b.leakDeltaIls === 0 ? (
                          <span className="text-subtle">{t('dashboard.ranking.flat')}</span>
                        ) : (
                          b.thinBase ? (
                            <span className="text-muted" title={t('dashboard.ranking.thinBase')} data-delta="thin">
                              {b.leakDeltaIls > 0 ? '+' : '−'}
                              {ils(Math.abs(b.leakDeltaIls))}
                            </span>
                          ) : (
                            <span className={b.leakDeltaIls > 0 ? 'text-danger' : 'text-primary'}>
                              {b.leakDeltaIls > 0 ? '▲' : '▼'} {ils(Math.abs(b.leakDeltaIls))}
                            </span>
                          )
                        )}
                      </td>
                    ) : null}
                    <td className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end">
                      {isActive ? null : (
                        <SwitchBranchButton restaurantId={b.restaurantId} label={t('dashboard.ranking.switchTo')} variant="ghost" testId="chain-switch" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      {/* Branch × month heatmap. */}
      <section className="mt-10">
        <SectionHeader title={t('dashboard.heatmap.title')} subtitle={t('dashboard.heatmap.subtitle')} />
        <Card padding="md" className="overflow-x-auto">
          <table className="w-full border-separate sm:min-w-[36rem] border-spacing-1 text-xs" data-testid="chain-heatmap">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1 text-start font-semibold text-subtle">
                  <span className="sr-only">{t('dashboard.ranking.branch')}</span>
                </th>
                {data.months.map((m, i) => (
                  <th key={m} scope="col" className={cn('px-2 py-1 text-center font-mono font-semibold', inPeriod.has(m) ? 'text-primary' : 'text-subtle', phoneHidden(i))}>
                    {monthLabel(m, locale, 'short')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.heatmap.map((row) => {
                const name = nameOf.get(row.restaurantId) ?? '';
                return (
                  <tr key={row.restaurantId}>
                    <th scope="row" className="max-w-[7rem] truncate px-2 py-1 sm:max-w-[12rem] text-start text-sm font-semibold text-ink">
                      <span {...originalProps(name)}>{name}</span>
                    </th>
                    {row.cells.map((c, i) => (
                      <td
                        key={c.month}
                        title={t('dashboard.heatmap.cell', {
                          branch: name,
                          month: monthLabel(c.month, locale),
                          leak: ils(c.leakIls),
                          pct: pct(c.leakPct),
                        })}
                        className={cn(
                          'rounded-lg px-2 py-2.5 text-center font-mono tabular-nums',
                          heatClass(c.leakPct, c.leakIls),
                          inPeriod.has(c.month) && 'ring-1 ring-primary/40',
                          phoneHidden(i),
                        )}
                      >
                        {c.spendIls === 0 && c.leakIls === 0 ? t('dashboard.heatmap.empty') : pct(c.leakPct)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-subtle" aria-hidden="true">
            <span>{t('dashboard.heatmap.legendLow')}</span>
            {['bg-primary/20', 'bg-gold/20', 'bg-warn/30 ring-1 ring-inset ring-warn/60', 'bg-danger/30 ring-1 ring-inset ring-danger/60', 'bg-danger/50 ring-1 ring-inset ring-danger'].map((c) => (
              <span key={c} className={cn('h-3 w-6 rounded', c)} />
            ))}
            <span>{t('dashboard.heatmap.legendHigh')}</span>
          </div>
        </Card>
      </section>

      {/* Price disparity across branches (feature flag: priceDisparity). */}
      {data.priceDisparities ? (
        <section className="mt-10" data-testid="chain-disparity">
          <SectionHeader title={t('dashboard.disparity.title')} subtitle={t('dashboard.disparity.subtitle')} />
          {data.priceDisparities.length === 0 ? (
            <EmptyState icon={<Scale className="h-6 w-6" />} title={t('dashboard.disparity.empty')} />
          ) : (
            <Card padding="none" className="divide-y divide-line/60">
              {data.priceDisparities.map((d) => {
                const sup = displayName(d.supplierName, d.supplierNameEn, locale);
                const prod = displayName(d.productName, d.productNameEn, locale);
                const per = (v: number) =>
                  t('dashboard.disparity.perUnit', { price: formatIls(v, { locale, maximumFractionDigits: 2 }), unit: d.unit });
                return (
                  <details key={d.key} className="group" data-testid="chain-disparity-row">
                    <summary className="grid cursor-pointer list-none grid-cols-1 gap-3 px-5 py-4 hover:bg-surface-2/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_auto_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">
                          <span {...originalProps(prod.primary)}>{prod.primary}</span>
                          <Badge tone={d.method === 'sku' ? 'accent' : 'info'} className="ms-2 align-middle">
                            {t(`dashboard.disparity.method.${d.method}`)}
                          </Badge>
                        </p>
                        <p className="text-xs text-subtle">
                          <span {...originalProps(sup.primary)}>{sup.primary}</span>
                          {prod.secondary ? (
                            <>
                              {' · '}
                              <span {...originalProps(prod.secondary)}>{prod.secondary}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p className="text-xs uppercase tracking-wider text-subtle">{t('dashboard.disparity.cheapest')}</p>
                        <p className="truncate text-ink" {...originalProps(d.cheapest.name)}>{d.cheapest.name}</p>
                        <p className="font-mono text-xs tabular-nums text-primary">{per(d.cheapest.avgPrice)}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-xs uppercase tracking-wider text-subtle">{t('dashboard.disparity.priciest')}</p>
                        <p className="truncate text-ink" {...originalProps(d.priciest.name)}>{d.priciest.name}</p>
                        <p className="font-mono text-xs tabular-nums text-danger">{per(d.priciest.avgPrice)}</p>
                      </div>
                      <div className="text-sm md:text-end">
                        <p className="text-xs uppercase tracking-wider text-subtle">{t('dashboard.disparity.delta')}</p>
                        <p className="font-mono font-semibold tabular-nums text-warn">+{formatPercent(d.deltaPct, locale, 1)}</p>
                      </div>
                      <div className="text-sm md:text-end">
                        <p className="text-xs uppercase tracking-wider text-subtle">{t('dashboard.disparity.impact')}</p>
                        <p className="font-mono text-base font-bold tabular-nums text-danger" data-testid="chain-disparity-impact">{ils(d.impactIls)}</p>
                      </div>
                    </summary>
                    <div className="overflow-x-auto bg-surface-2/40 px-5 pb-4 pt-1">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{t('dashboard.disparity.drill')}</p>
                      <table className="w-full min-w-[32rem] text-xs" data-testid="chain-disparity-lines">
                        <thead>
                          <tr className="text-subtle">
                            <th scope="col" className="py-1 text-start font-semibold">{t('dashboard.disparity.drillBranch')}</th>
                            <th scope="col" className="py-1 text-start font-semibold">{t('dashboard.disparity.drillInvoice')}</th>
                            <th scope="col" className="py-1 text-start font-semibold">{t('dashboard.disparity.drillDate')}</th>
                            <th scope="col" className="py-1 text-end font-semibold">{t('dashboard.disparity.drillQty')}</th>
                            <th scope="col" className="py-1 text-end font-semibold">{t('dashboard.disparity.drillPrice')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.lines.map((l) => {
                            const bn = nameOf.get(l.restaurantId) ?? '';
                            return (
                              <tr key={l.invoiceLineId} className="border-t border-line/50">
                                <td className="py-1.5 text-ink"><span {...originalProps(bn)}>{bn}</span></td>
                                <td className="py-1.5 font-mono text-muted">{l.invoiceNumber}</td>
                                <td className="py-1.5 text-muted">{formatDate(l.invoiceDate, locale, { dateStyle: 'medium' })}</td>
                                <td className="py-1.5 text-end font-mono tabular-nums text-muted">{formatNumber(l.qty, locale)}</td>
                                <td className="py-1.5 text-end font-mono tabular-nums text-ink">{formatIls(l.unitPrice, { locale, maximumFractionDigits: 2 })}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </Card>
          )}
          <p className="mt-2 text-xs text-subtle">{t('dashboard.disparity.note')}</p>
        </section>
      ) : null}

      {/* Top suppliers across branches. */}
      <section className="mt-10">
        <SectionHeader title={t('dashboard.suppliers.title')} subtitle={t('dashboard.suppliers.subtitle')} />
        {data.topSuppliers.length === 0 ? (
          <EmptyState icon={<Undo2 className="h-6 w-6" />} title={t('dashboard.suppliers.empty')} />
        ) : (
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full sm:min-w-[36rem] text-sm" data-testid="chain-suppliers">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-subtle">
                  <th scope="col" className="px-3 py-3 sm:px-4 text-start font-semibold">{t('dashboard.suppliers.supplier')}</th>
                  <th scope="col" className="hidden sm:table-cell px-3 py-3 sm:px-4 text-start font-semibold">{t('dashboard.suppliers.branches')}</th>
                  <th scope="col" className="px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.suppliers.leak')}</th>
                  <th scope="col" className="px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.suppliers.leakPct')}</th>
                  <th scope="col" className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end font-semibold">{t('dashboard.suppliers.spend')}</th>
                </tr>
              </thead>
              <tbody>
                {data.topSuppliers.map((s) => {
                  const dn = displayName(s.name ?? '—', s.nameEn, locale);
                  return (
                    <tr key={s.key} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-3 sm:px-4">
                        <span className="block font-semibold text-ink" {...originalProps(dn.primary)}>{dn.primary}</span>
                        {dn.secondary ? (
                          <span className="block text-xs text-subtle" {...originalProps(dn.secondary)}>{dn.secondary}</span>
                        ) : null}
                        {/* Phone: the branches column is hidden; list them under the name. */}
                        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                          {s.branchIds.map((id) => {
                            const n = nameOf.get(id) ?? '';
                            return (
                              <Badge key={id} tone="neutral">
                                <span {...originalProps(n)}>{n}</span>
                              </Badge>
                            );
                          })}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3 sm:px-4">
                        <div className="flex flex-wrap gap-1">
                          {s.branchIds.map((id) => {
                            const n = nameOf.get(id) ?? '';
                            return (
                              <Badge key={id} tone="neutral">
                                <span {...originalProps(n)}>{n}</span>
                              </Badge>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-3 sm:px-4 text-end font-mono font-semibold tabular-nums text-danger">{ils(s.leakIls)}</td>
                      <td className="px-3 py-3 sm:px-4 text-end font-mono tabular-nums text-muted">{pct(s.leakPct)}</td>
                      <td className="hidden sm:table-cell px-3 py-3 sm:px-4 text-end font-mono tabular-nums text-muted">{ils(s.spendIls)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
