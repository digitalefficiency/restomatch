'use client';

import { useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Badge, FilterChip, Money } from '@/lib/components';
import type { RowAction } from '@/lib/components/table/DataTable';
import { DataTable } from '@/lib/components/table';
import type { ColumnDef } from '@/lib/components/table/types';
import { UnitText } from '@/lib/components/UnitText';
import { useLocale, useT } from '@/lib/i18n/client';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { originalProps } from '@/lib/i18n/original';
import { AREAS, qtyText, type Area } from '../inventory-ui';
import { scale4 } from '../count/guard';
import { PriceSourceText } from '../count/count-screen';
import { AmendSheet } from './count-actions';

type Count = inferRouterOutputs<AppRouter>['inventory']['get'];
type Line = Count['lines'][number];
type Filter = 'all' | 'notCounted' | 'noPrice' | 'unusual';

/** Δ qty vs the previous count in the line's unit (null when there is none, or the units differ). */
function deltaQty(l: Line): number | null {
  if (l.qty == null || l.prevQty == null || l.prevUnit !== l.unit) return null;
  const a = scale4(l.qty);
  const b = scale4(l.prevQty);
  return a == null || b == null ? null : Number(a - b) / 10_000;
}

/**
 * A closed count (foodcost-19): every line — the uncounted ones too — with its
 * area, qty, unit cost, value and the change since the previous count; area
 * subtotals; chips for "not counted", "no price" and "unusual change". ₪ columns
 * only for money viewers (the chef's JSON carries none). Amend sits in the row menu.
 */
export function ClosedCount({ count }: { count: Count }) {
  const t = useT(inventoryNs);
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const [amending, setAmending] = useState<Line | null>(null);
  const money = count.showMoney;
  const lines = count.lines;
  const n = {
    all: lines.length,
    notCounted: lines.filter((l) => l.qty == null).length,
    noPrice: lines.filter((l) => l.qty != null && l.status !== 'ok').length,
    unusual: lines.filter((l) => l.flags.length > 0).length,
  };
  const rows = lines.filter((l) =>
    filter === 'all' ? true : filter === 'notCounted' ? l.qty == null : filter === 'noPrice' ? l.qty != null && l.status !== 'ok' : l.flags.length > 0,
  );
  const areaName = (a: string) => t(`areas.${a as Area}`);
  const name = (l: Line) => {
    const text = locale === 'en' && l.nameEn ? l.nameEn : l.name;
    return <span {...originalProps(text)}>{text}</span>;
  };

  const columns = useMemo(() => {
    const cols: ColumnDef<Line>[] = [
      {
        id: 'item',
        header: t('detail.colItem'),
        identity: true,
        value: (l) => l.name,
        cell: (l) => (
          <span className="block">
            <span className="block text-ink">{name(l)}</span>
            {l.storageArea === 'bar' ? <span className="block text-sm text-muted">{t('detail.barNote')}</span> : null}
            {money && l.priceSource && l.unitCost ? (
              <span className="block text-sm text-muted" data-testid="price-source">
                <PriceSourceText unitCost={l.unitCost} unit={l.unit} source={l.priceSource} />
              </span>
            ) : null}
          </span>
        ),
        mobile: 'primary',
      },
      { id: 'area', header: t('detail.colArea'), value: (l) => AREAS.indexOf(l.storageArea), cell: (l) => areaName(l.storageArea), mobile: 'secondary' },
      {
        id: 'qty',
        header: t('detail.colQty'),
        kind: 'number',
        value: (l) => (l.qty == null ? null : Number(l.qty)),
        cell: (l) =>
          l.qty == null ? (
            <Badge tone="neutral">{t('count.notCounted')}</Badge>
          ) : (
            <span className="tabular-nums">
              {qtyText(l.qty)} <UnitText unit={l.unit} />
            </span>
          ),
      },
    ];
    if (money) {
      cols.push(
        { id: 'unitCost', header: t('detail.unitCost'), kind: 'money', decimals: 2, value: (l) => (l.unitCost == null ? null : Math.round(Number(l.unitCost) * 100)) },
        {
          id: 'value',
          header: t('detail.lineValue'),
          kind: 'money',
          decimals: 2,
          value: (l) => l.valueAgorot ?? null,
          cell: (l) => (l.qty != null && l.valueAgorot == null ? <Badge tone="neutral">{t('count.noPrice')}</Badge> : <Money agorot={l.valueAgorot ?? null} />),
        },
      );
    }
    cols.push({
      id: 'delta',
      header: t('detail.colDelta'),
      kind: 'number',
      value: (l) => deltaQty(l),
      cell: (l) => {
        const d = deltaQty(l);
        if (d == null) return <span className="text-muted">—</span>;
        const dv = money && l.valueAgorot != null && l.prevValueAgorot != null ? l.valueAgorot - l.prevValueAgorot : null;
        return (
          <span className="tabular-nums" data-testid="line-delta">
            <bdi>{d > 0 ? `+${d}` : `${d}`}</bdi>
            {dv != null ? (
              <>
                {' · '}
                <Money agorot={dv} />
              </>
            ) : null}
          </span>
        );
      },
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [money, locale]);

  const subtotals = AREAS.map((a) => {
    const ls = lines.filter((l) => l.storageArea === a);
    return { a, lines: ls.length, value: ls.reduce((s, l) => s + (l.valueAgorot ?? 0), 0) };
  }).filter((x) => x.lines > 0);

  return (
    <div className="space-y-3">
      {money ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" data-testid="area-subtotals">
          {subtotals.map((s) => (
            <li key={s.a}>
              {t('detail.areaTotal', { area: areaName(s.a) })}: <Money agorot={s.value} className="text-ink" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('detail.colItem')}>
        <FilterChip label={t('detail.chipAll', { count: n.all })} active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label={t('detail.chipNotCounted', { count: n.notCounted })} active={filter === 'notCounted'} onClick={() => setFilter('notCounted')} />
        {money ? (
          <FilterChip label={t('detail.chipNoPrice', { count: n.noPrice })} active={filter === 'noPrice'} onClick={() => setFilter('noPrice')} />
        ) : null}
        <FilterChip label={t('detail.chipUnusual', { count: n.unusual })} active={filter === 'unusual'} onClick={() => setFilter('unusual')} />
      </div>
      <DataTable<Line>
        id="inventory-count"
        caption={t('detail.title', { date: count.countDate })}
        rows={rows}
        columns={columns}
        rowKey={(l) => l.productId}
        defaultSort={{ id: 'area', desc: false }}
        pageSize={500}
        filtered={filter !== 'all'}
        onClearFilters={() => setFilter('all')}
        {...(count.canAmend && count.status === 'completed'
          ? { rowActions: (l: Line): RowAction[] => [{ id: 'amend', label: t('detail.amend'), onRun: () => setAmending(l) }] }
          : {})}
      />
      {amending ? (
        <AmendSheet
          countId={count.id}
          line={{ productId: amending.productId, unit: amending.unit, qty: amending.qty, unitCost: amending.unitCost ?? null, valueAgorot: amending.valueAgorot ?? null }}
          money={money}
          onClose={() => setAmending(null)}
        />
      ) : null}
    </div>
  );
}
