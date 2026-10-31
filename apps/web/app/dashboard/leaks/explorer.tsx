import { Droplets, FileWarning, Percent, Receipt } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { SectionHeader, cn } from '@/lib/components';
import {
  BreakdownChart,
  DeltaBadge,
  compareSpanLabel,
  isThinBase,
  TvMode,
  ViewToolbar,
  hasFilters,
  rangeLabel,
  toViewInput,
  type ChartRow,
  type ViewState,
} from '@/lib/components/views';
import { discrepancyLabel, displayName } from '../approvals/vocab';
import { LeakStateNote, leakStateOf } from './leak-state';
import { noDataCtaFor } from './states';

/**
 * Leak explorer: the hero leak for any period, sliced by supplier / category /
 * product / discrepancy type, compared like-for-like by default, with chart
 * toggle, CSV export, saved views and TV mode. Finance roles only
 * (owner.leakGrouped is financeProcedure); the page that mounts it is finance-gated.
 * The T1 tile is whole shekels with the exact figure in its title; the rows
 * beside it are at 2 dp with a totals row, so what is added up on screen is
 * what the tile says.
 */
export async function LeakExplorer({ view }: { view: ViewState }) {
  const caller = await createServerCaller();
  const [t, tl, ta, locale] = await Promise.all([getT(viewsNs), getT(leaksNs), getT(approvalsNs), getLocale()]);
  const input = toViewInput(view);
  const [summary, grouped, options] = await Promise.all([
    caller.owner.leakSummary({ view: input, compare: view.compare }),
    caller.owner.leakGrouped({ view: input, groupBy: view.group, compare: view.compare }),
    caller.owner.viewOptions(),
  ]);
  const cur = summary.current;
  const prev = summary.previous && summary.previous.invoiceCount > 0 ? summary.previous : null;
  // A comparison period with almost no data gets a calm ₪ difference, not a % alarm.
  const thinBase = prev ? isThinBase(cur.spendIls, prev.spendIls) : false;
  const whole = (v: number) => formatIls(v, { locale });
  const exact = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const state = leakStateOf(cur);
  const nowIso = new Date().toISOString();
  const vs = prev && view.compare !== 'off' ? t('delta.vsSpan', compareSpanLabel(cur, prev, locale, nowIso)) : undefined;
  // undefined = not compared (nothing shown); null = compared, no base ("no comparison data").
  const prevOf = <K extends 'leakIls' | 'spendIls' | 'invoicesWithLeak'>(k: K) =>
    view.compare === 'off' ? undefined : prev ? prev[k] : null;

  const labelOf = (key: string, label: string | null, labelEn: string | null) => {
    if (!key) return t('explorer.other');
    if (view.group === 'type') return discrepancyLabel(ta, key);
    if (view.group === 'category') return label ?? key;
    return displayName(locale, label, labelEn) || t('explorer.other');
  };
  const prevByKey = new Map((grouped.previous ?? []).map((r) => [r.key, r.leakIls]));
  const rows: ChartRow[] = grouped.rows.map((r) => ({
    key: r.key || '∅',
    label: labelOf(r.key, r.label, r.labelEn),
    value: r.leakIls,
    count: r.count,
    // An empty comparison period (no checked invoices) has no base: neutral "—", never a red ▲ +₪X.
    previous: grouped.previous && prev ? (prevByKey.get(r.key) ?? 0) : null,
  }));
  const linesTotal = grouped.rows.reduce((s, r) => s + Math.round(r.leakIls * 100), 0) / 100;
  const groupName = t(`groups.${view.group}`);
  const range = rangeLabel(view.period, cur.monthStart, cur.monthEnd, locale);
  const leakLabel = view.period === 'this_month' ? t('kpis.leakMonth') : t('kpis.leak');
  const top = rows
    .slice(0, 3)
    .map((r) => `${r.label} ${exact(r.value)}`)
    .join(', ');

  return (
    <section className="mb-12" aria-labelledby="leak-explorer">
      {/* On a phone the T1 must sit in the first half of the screen: the section intro is desktop-only. */}
      <div className="hidden sm:block">
        <SectionHeader title={t('explorer.title')} subtitle={t('explorer.subtitle')} />
      </div>
      <ViewToolbar
        page="leaks"
        view={view}
        period
        compare
        group
        chart
        density
        tv
        saved
        filters={['supplier', 'category', 'type', 'severity', 'status']}
        options={options}
        exportData={{
          columns: [
            { key: 'item', label: groupName },
            { key: 'leak', label: t('explorer.colLeak') },
            { key: 'count', label: t('explorer.colCount') },
            ...(grouped.previous ? [{ key: 'previous', label: t('explorer.colPrev') }] : []),
          ],
          rows: rows.map((r) => ({ item: r.label, leak: r.value, count: r.count, previous: r.previous })),
        }}
      />

      <TvMode active={view.tv}>
        <h2 id="leak-explorer" className="mb-3 text-sm font-semibold text-muted">
          {range}
          {hasFilters(view) ? <span className="ms-2 text-xs font-normal text-subtle">· {t('filteredNote')}</span> : null}
        </h2>

        <div
          data-view-region
          data-view-summary={t('explorer.summary', {
            range,
            leak: exact(cur.leakIls),
            invoices: formatNumber(cur.matchedInvoiceCount, locale),
          })}
          className="aria-busy:opacity-60 motion-safe:transition-opacity"
        >
          {state === 'noData' ? (
            <LeakStateNote state="noData" labels={{ title: tl('states.noData'), hint: tl('states.noDataHint') }}
              cta={noDataCtaFor(((await auth())?.user as { role?: string } | undefined)?.role, tl('states.noDataCta'))}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* T1 — the leak: whole shekels, the exact figure in the title (and read out). */}
              <Tile
                label={leakLabel}
                icon={<Droplets className="h-4 w-4" />}
                hero={state === 'leak'}
                testId="explorer-leak"
                amount={cur.leakIls}
                title={exact(cur.leakIls)}
                value={state === 'clean' ? tl('states.clean', { count: formatNumber(cur.matchedInvoiceCount, locale) }) : whole(cur.leakIls)}
                calm={state === 'clean'}
                hint={
                  <DeltaBadge current={cur.leakIls} previous={prevOf('leakIls')} compare={view.compare} thinBase={thinBase} vs={vs} showAmount />
                }
              />
              <Tile
                label={t('kpis.pct')}
                icon={<Percent className="h-4 w-4" />}
                value={cur.leakPct != null ? formatPercent(cur.leakPct, locale, 1) : '—'}
                hint={
                  <DeltaBadge
                    current={cur.leakPct ?? 0}
                    previous={view.compare === 'off' ? undefined : prev ? (prev.leakPct ?? 0) : null}
                    compare={view.compare}
                    thinBase={thinBase}
                    kind="ratio"
                    bare
                  />
                }
              />
              <Tile
                label={t('kpis.spend')}
                icon={<Receipt className="h-4 w-4" />}
                value={whole(cur.spendIls)}
                title={exact(cur.spendIls)}
                hint={<DeltaBadge current={cur.spendIls} previous={prevOf('spendIls')} compare={view.compare} thinBase={thinBase} neutral bare />}
              />
              <Tile
                label={t('kpis.invoices')}
                icon={<FileWarning className="h-4 w-4" />}
                value={t('kpis.invoicesOf', {
                  with: formatNumber(cur.invoicesWithLeak, locale),
                  total: formatNumber(cur.matchedInvoiceCount, locale),
                })}
                hint={
                  <DeltaBadge current={cur.invoicesWithLeak} previous={prevOf('invoicesWithLeak')} compare={view.compare} thinBase={thinBase} kind="count" bare />
                }
              />
            </div>
          )}

          {state === 'noData' ? null : (
            <div className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <p className="mb-3 text-sm font-semibold text-subtle">{t('explorer.chartCaption', { group: groupName })}</p>
              <BreakdownChart
                rows={rows}
                chart={view.chart}
                density={view.density}
                compare={view.compare}
                thinBase={thinBase}
                caption={t('explorer.chartCaption', { group: groupName })}
                summary={t('explorer.chartSummary', { group: groupName, total: exact(linesTotal), top: top || '—' })}
                keyHeader={groupName}
                valueHeader={t('explorer.colLeak')}
                countHeader={t('explorer.colCount')}
                emptyText={t('explorer.empty')}
                digits={2}
                totalLabel={t('explorer.total')}
              />
              {linesTotal - cur.leakIls > 0.005 ? <p className="mt-3 text-xs text-subtle" data-testid="explorer-cap-note">{t('explorer.linesNote')}</p> : null}
            </div>
          )}
        </div>
      </TvMode>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  icon,
  hero = false,
  calm = false,
  title,
  amount,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** T1: the danger start rail (only when money leaked). */
  hero?: boolean;
  /** T3: the clean sentence, calm. */
  calm?: boolean;
  title?: string;
  amount?: number;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-surface p-4',
        hero ? 'border-danger/35 ps-5' : calm ? 'border-primary/25 bg-primary/5' : 'border-line',
      )}
    >
      {hero ? <div className="absolute inset-y-0 start-0 w-1.5 bg-danger" aria-hidden="true" /> : null}
      <div className="flex items-center gap-2">
        {icon ? <span className="text-muted">{icon}</span> : null}
        <p className="text-sm font-semibold text-subtle">{label}</p>
      </div>
      <p
        className={cn('mt-1.5 font-bold tabular-nums text-ink', calm ? 'text-base' : hero ? 'text-3xl font-extrabold' : 'text-2xl')}
        title={title}
        data-testid={testId}
        data-amount={amount}
      >
        <bdi>{value}</bdi>
        {title ? <span className="sr-only"> ({title})</span> : null}
      </p>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
