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
 * toggle never changes the numbers. RTL-aware: bars grow from the start edge
 * and the line runs in reading direction.
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
}) {
  const t = useT(views);
  const locale = useLocale();
  const ils = (v: number) => formatIls(v, { locale });
  const compact = density === 'compact';

  if (rows.length === 0) {
    return <p className="rounded-xl border border-line bg-surface-2/50 px-4 py-6 text-center text-sm text-muted">{emptyText}</p>;
  }

  const max = Math.max(...rows.map((r) => Math.max(r.value, r.previous ?? 0)), 0.01);
  const total = rows.reduce((s, r) => s + r.value, 0);

  if (chart === 'line') return <LineFace rows={rows} max={max} caption={caption} ils={ils} compare={compare} />;

  if (chart === 'table') {
    const cell = compact ? 'px-3 py-1.5' : 'p-3';
    return (
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-subtle">
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
                <td className={cn(cell, 'text-end font-mono font-semibold tabular-nums text-danger')}>{ils(r.value)}</td>
                {countHeader ? (
                  <td className={cn(cell, 'text-end font-mono tabular-nums text-muted')}>
                    {r.count != null ? formatNumber(r.count, locale) : '—'}
                  </td>
                ) : null}
                <td className={cn(cell, 'text-end font-mono tabular-nums text-muted')}>
                  {total > 0 ? formatPercent(r.value / total, locale, 0) : '—'}
                </td>
                {compare !== 'off' ? (
                  <>
                    <td className={cn(cell, 'text-end font-mono tabular-nums text-muted')}>
                      {r.previous != null ? ils(r.previous) : '—'}
                    </td>
                    <td className={cell}>
                      <DeltaBadge current={r.value} previous={r.previous ?? 0} compare={compare} thinBase={thinBase} bare />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Bars: ranked, labelled, with the comparison period as a thin ghost bar.
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className={compact ? 'space-y-1.5' : 'space-y-3'}>
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-ink">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {compare !== 'off' ? (
                  <DeltaBadge current={r.value} previous={r.previous ?? 0} compare={compare} thinBase={thinBase} bare />
                ) : null}
                <span className="font-mono font-semibold tabular-nums text-danger">{ils(r.value)}</span>
              </span>
            </div>
            <div className={cn('mt-1 overflow-hidden rounded-full bg-surface-2', compact ? 'h-1.5' : 'h-2.5')}>
              <div
                className="rm-bar leak-gradient h-full rounded-full"
                style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }}
              />
            </div>
            {compare !== 'off' && r.previous != null && r.previous > 0 ? (
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-transparent">
                <div className="h-full rounded-full bg-muted/40" style={{ width: `${(r.previous / max) * 100}%` }} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function LineFace({
  rows,
  max,
  caption,
  ils,
  compare,
}: {
  rows: ChartRow[];
  max: number;
  caption: string;
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
      {/* The SVG is direction-neutral; in RTL we mirror it so time runs right → left. */}
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto max-h-72 w-full rtl:-scale-x-100" role="img" aria-label={caption}>
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} className="stroke-line" strokeWidth="1" />
        {showPrev ? (
          <path d={path(prev)} fill="none" className="stroke-muted" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
        ) : null}
        <path d={path(cur)} fill="none" className="stroke-danger" strokeWidth="2.5" strokeLinejoin="round" />
        {rows.map((r, i) => (
          <g key={r.key}>
            <circle cx={x(i)} cy={y(r.value)} r="3.5" className="fill-danger">
              <title>{`${r.label}: ${ils(r.value)}`}</title>
            </circle>
            {i % every === 0 || i === n - 1 ? (
              <text
                x={x(i)}
                y={H + 6}
                textAnchor="middle"
                className="fill-subtle rtl:-scale-x-100"
                style={{ fontSize: 11, transformBox: 'fill-box', transformOrigin: 'center' }}
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
