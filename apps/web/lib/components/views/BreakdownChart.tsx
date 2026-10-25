'use client';

import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { views } from '@/lib/i18n/messages/views';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { DeltaBadge } from './DeltaBadge';
import type { ChartType, Compare, Density } from './state';

export interface ChartRow {
  key: string;
  /** Already-localized label. */
  label: string;
  /** ₪ value plotted. */
  value: number;
  /** Optional count (e.g. discrepancies) for the table. */
  count?: number;
  /** Same row in the comparison period (null when absent there). */
  previous?: number | null;
}

/**
 * One chart, three faces: horizontal bars (ranked groups), an SVG line (a
 * trend over time) or a plain table. Every face shows the same rows, so the
 * toggle never changes the numbers. Bars grow from the start edge; the line is
 * never mirrored (time runs left = oldest in both locales, R-3). A ₪0 row is a
 * muted tick, never a red stub. With `totalLabel` a totals row shows Σ rows at
 * the rows' own precision (`digits`), so the visible total equals its rows.
 */
export function BreakdownChart({
  rows,
  chart,
  density = 'comfortable',
  compare = 'off',
  thinBase = false,
  caption,
  keyHeader,
  valueHeader,
  countHeader,
  emptyText,
  digits = 0,
  totalLabel,
  summary,
}: {
  rows: ChartRow[];
  chart: ChartType;
  density?: Density;
  compare?: Compare;
  /** The comparison period is too thin to compare (isThinBase): ₪ differences only. */
  thinBase?: boolean;
  caption: string;
  keyHeader: string;
  valueHeader: string;
  countHeader?: string;
  emptyText: string;
  /** Decimals of every ₪ on the chart (2 when the rows sit next to an exact total). */
  digits?: number;
  /** Adds a totals row "label · Σ rows" (Σ in integer agorot, at `digits`). */
  totalLabel?: string;
  /** A sentence for screen readers ("leak by supplier: …"); defaults to the caption. */
  summary?: string;
}) {
  const t = useT(views);
  const locale = useLocale();
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: digits });
  const compact = density === 'compact';
  const isZero = (v: number) => Math.abs(v) < 0.005;

  if (rows.length === 0) {
    return <p className="rounded-xl border border-line bg-surface-2/50 px-4 py-6 text-center text-sm text-muted">{emptyText}</p>;
  }

  const max = Math.max(...rows.map((r) => Math.max(r.value, r.previous ?? 0)), 0.01);
  const total = rows.reduce((s, r) => s + Math.round(r.value * 100), 0) / 100;
  const label = summary ?? caption;

  if (chart === 'line') return <LineFace rows={rows} max={max} caption={caption} label={label} ils={ils} compare={compare} />;

  if (chart === 'table') {
    const cell = compact ? 'px-3 py-1.5' : 'p-3';
    return (
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
            <tr>
              <th scope="col" className={cn(cell, 'text-start font-semibold')}>{keyHeader}</th>
              <th scope="col" className={cn(cell, 'text-end font-semibold')}>{valueHeader}</th>
              {countHeader ? <th scope="col" className={cn(cell, 'text-end font-semibold')}>{countHeader}</th> : null}
              <th scope="col" className={cn(cell, 'text-end font-semibold')}>{t('explorer.colShare')}</th>
              {compare !== 'off' ? (
                <>
                  <th scope="col" className={cn(cell, 'text-end font-semibold')}>{t('explorer.colPrev')}</th>
                  <th scope="col" className={cn(cell, 'text-start font-semibold')}>{t('explorer.colChange')}</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line transition-colors hover:bg-surface-2/60">
                <td className={cn(cell, 'font-medium text-ink')}>{r.label}</td>
                <td className={cn(cell, 'text-end font-semibold tabular-nums', isZero(r.value) ? 'text-subtle' : 'text-ink')}>{ils(r.value)}</td>
                {countHeader ? (
                  <td className={cn(cell, 'text-end tabular-nums text-muted')}>
                    {r.count != null ? formatNumber(r.count, locale) : '—'}
                  </td>
                ) : null}
                <td className={cn(cell, 'text-end tabular-nums text-muted')}>
                  {total > 0 ? formatPercent(r.value / total, locale, 0) : '—'}
                </td>
                {compare !== 'off' ? (
                  <>
                    <td className={cn(cell, 'text-end tabular-nums text-muted')}>
                      {r.previous != null ? ils(r.previous) : '—'}
                    </td>
                    <td className={cell}>
                      <DeltaBadge current={r.value} previous={r.previous} compare={compare} thinBase={thinBase} bare />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          {totalLabel ? (
            <tfoot>
              <tr className="border-t border-line">
                <th scope="row" className={cn(cell, 'text-start font-semibold text-ink')}>{totalLabel}</th>
                <td className={cn(cell, 'text-end font-bold tabular-nums text-ink')} data-testid="chart-total" data-amount={total}>
                  {ils(total)}
                </td>
                <td colSpan={(countHeader ? 2 : 1) + (compare !== 'off' ? 2 : 0)} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  }

  // Bars: ranked, labelled, with the comparison period as a thin ghost bar.
  return (
    <figure aria-label={label}>
      <figcaption className="sr-only">{label}</figcaption>
      <ul className={compact ? 'space-y-1.5' : 'space-y-3'}>
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-ink">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {compare !== 'off' ? (
                  <DeltaBadge current={r.value} previous={r.previous} compare={compare} thinBase={thinBase} bare />
                ) : null}
                <span
                  className={cn('font-semibold tabular-nums', isZero(r.value) ? 'text-subtle' : 'text-ink')}
                  data-testid="chart-row"
                  data-amount={r.value}
                >
                  {ils(r.value)}
                </span>
              </span>
            </div>
            <div className={cn('mt-1 overflow-hidden rounded-full bg-surface-2', compact ? 'h-1.5' : 'h-2.5')}>
              {isZero(r.value) ? (
                // A clean ₪0 row: a muted baseline tick, not a red stub.
                <div className="h-full w-1 rounded-full bg-line-strong" />
              ) : (
                <div className="rm-bar leak-gradient h-full rounded-full" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
              )}
            </div>
            {compare !== 'off' && r.previous != null && r.previous > 0 ? (
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-transparent">
                <div className="h-full rounded-full bg-muted/40" style={{ width: `${(r.previous / max) * 100}%` }} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {totalLabel ? (
        <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-sm">
          <span className="font-semibold text-ink">{totalLabel}</span>
          <span className="font-bold tabular-nums text-ink" data-testid="chart-total" data-amount={total}>
            {ils(total)}
          </span>
        </p>
      ) : null}
    </figure>
  );
}

function LineFace({
  rows,
  max,
  caption,
  label,
  ils,
  compare,
}: {
  rows: ChartRow[];
  max: number;
  caption: string;
  label: string;
  ils: (v: number) => string;
  compare: Compare;
}) {
  const W = 900;
  const H = 220;
  const PAD = 24;
  const n = rows.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const cur = rows.map((r) => r.value);
  const prev = rows.map((r) => r.previous ?? 0);
  const showPrev = compare !== 'off' && rows.some((r) => (r.previous ?? 0) > 0);
  // Label every k-th point so the axis never crowds.
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      {/* Never mirrored: time runs left = oldest in both locales (R-3). */}
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto max-h-72 w-full" role="img" aria-label={label}>
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} className="stroke-line" strokeWidth="1" />
        {showPrev ? (
          <path d={path(prev)} fill="none" className="stroke-muted" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
        ) : null}
        <path d={path(cur)} fill="none" className="stroke-danger" strokeWidth="2.5" strokeLinejoin="round" />
        {rows.map((r, i) => (
          <g key={r.key}>
            <circle cx={x(i)} cy={y(r.value)} r="3.5" className={r.value > 0.005 ? 'fill-danger' : 'fill-line-strong'}>
              <title>{`${r.label}: ${ils(r.value)}`}</title>
            </circle>
            {i % every === 0 || i === n - 1 ? (
              <text
                x={x(i)}
                y={H + 6}
                textAnchor="middle"
                className="fill-subtle"
                style={{ fontSize: 12 }}
              >
                {r.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </figure>
  );
}
