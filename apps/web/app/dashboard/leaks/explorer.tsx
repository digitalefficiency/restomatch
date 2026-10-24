import { Droplets, Receipt, Percent, FileWarning } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { SectionHeader, StatCard } from '@/lib/components';
import {
  BreakdownChart,
  DeltaBadge,
  TvMode,
  ViewToolbar,
  hasFilters,
  rangeLabel,
  toViewInput,
  type ChartRow,
  type ViewState,
} from '@/lib/components/views';
import { discrepancyLabel, displayName } from '../approvals/vocab';

/**
 * Leak explorer: the hero leak for any period, sliced by supplier / category /
 * product / discrepancy type, with comparison, chart toggle, CSV export, saved
 * views and TV mode. Finance roles only (owner.leakGrouped is financeProcedure);
 * the page that mounts it is already finance-gated.
 */
export async function LeakExplorer({ view }: { view: ViewState }) {
  const caller = await createServerCaller();
  const [t, ta, locale] = await Promise.all([getT(viewsNs), getT(approvalsNs), getLocale()]);
  const input = toViewInput(view);
  const [summary, grouped, options] = await Promise.all([
    caller.owner.leakSummary({ view: input, compare: view.compare }),
    caller.owner.leakGrouped({ view: input, groupBy: view.group, compare: view.compare }),
    caller.owner.viewOptions(),
  ]);
  const cur = summary.current;
  const prev = summary.previous && summary.previous.invoiceCount > 0 ? summary.previous : null;
  const ils = (v: number) => formatIls(v, { locale });

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
    previous: grouped.previous ? (prevByKey.get(r.key) ?? 0) : null,
  }));
  const linesTotal = grouped.rows.reduce((s, r) => s + r.leakIls, 0);
  const groupName = t(`groups.${view.group}`);
  const range = rangeLabel(view.period, cur.monthStart, cur.monthEnd, locale);

  return (
    <section className="mb-12" aria-labelledby="leak-explorer">
      <SectionHeader title={t('explorer.title')} subtitle={t('explorer.subtitle')} />
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('kpis.leak')}
            value={ils(cur.leakIls)}
            tone="danger"
            emphasis={cur.leakIls > 0}
            icon={<Droplets className="h-4 w-4" />}
            hint={<DeltaBadge current={cur.leakIls} previous={prev?.leakIls} compare={view.compare} showAmount />}
          />
          <StatCard
            label={t('kpis.pct')}
            value={cur.leakPct != null ? formatPercent(cur.leakPct, locale, 1) : '—'}
            tone="warn"
            icon={<Percent className="h-4 w-4" />}
            hint={<DeltaBadge current={cur.leakPct ?? 0} previous={prev ? (prev.leakPct ?? 0) : null} compare={view.compare} kind="ratio" bare />}
          />
          <StatCard
            label={t('kpis.spend')}
            value={ils(cur.spendIls)}
            icon={<Receipt className="h-4 w-4" />}
            hint={<DeltaBadge current={cur.spendIls} previous={prev?.spendIls} compare={view.compare} neutral bare />}
          />
          <StatCard
            label={t('kpis.invoices')}
            value={`${formatNumber(cur.invoicesWithLeak, locale)} / ${formatNumber(cur.matchedInvoiceCount, locale)}`}
            icon={<FileWarning className="h-4 w-4" />}
            hint={<DeltaBadge current={cur.invoicesWithLeak} previous={prev?.invoicesWithLeak} compare={view.compare} kind="count" bare />}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">
            {t('explorer.chartCaption', { group: groupName })}
          </p>
          <BreakdownChart
            rows={rows}
            chart={view.chart}
            density={view.density}
            compare={view.compare}
            caption={t('explorer.chartCaption', { group: groupName })}
            keyHeader={groupName}
            valueHeader={t('explorer.colLeak')}
            countHeader={t('explorer.colCount')}
            emptyText={t('explorer.empty')}
          />
          {linesTotal - cur.leakIls > 0.005 ? <p className="mt-3 text-[11px] text-subtle">{t('explorer.linesNote')}</p> : null}
        </div>
      </TvMode>
    </section>
  );
}
