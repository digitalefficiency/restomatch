'use client';

import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, Money, Spinner, cn, friendlyError } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatPercent } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { dayText } from './inventory-ui';
import { drillHref, sparkGeometry } from './control-room-ui';

const pct = (bp: number, locale: Locale) => formatPercent(bp / 10_000, locale, 1);

/**
 * W3-02b · the food-cost control room (owner / manager / bookkeeper; all ₪,
 * so the chef never mounts it). Two parts:
 *  - the trend: actual food cost per closed period vs the target. A period
 *    with no honest % is a gap, never 0%;
 *  - the equation of the latest period, where every number is a link to its
 *    source: opening + purchases − credits − closing = usage, ÷ sales = %.
 * Tiers: the % is calm (T4) when on target, warn text above it. A period that
 * is not trustworthy says "check the count" (T4), never an alarm.
 */
export function ControlRoomCard() {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const q = trpc.inventory.controlRoom.useQuery(undefined, { staleTime: 60_000 });

  if (q.isLoading) {
    return (
      <Card padding="md" className="flex items-center justify-center" data-testid="control-room">
        <Spinner />
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card padding="md" data-testid="control-room">
        <h2 className="text-base font-semibold text-ink">{t('controlRoom.title')}</h2>
        <p className="mt-1 text-sm text-muted" role="status">
          {friendlyError(q.error, tc)}
        </p>
      </Card>
    );
  }
  const { series, equation, targetBp, trustworthy } = q.data;
  const geo = sparkGeometry(series.points, targetBp, series.minBp, series.maxBp);
  const known = series.points.filter((p) => p.bp != null);
  const trendLabel = t('controlRoom.trendLabel', {
    points:
      known.map((p) => `${dayText(p.closingDate, locale)} ${pct(p.bp!, locale)}`).join(', ') || '—',
    target: pct(targetBp, locale),
  });

  return (
    <Card padding="md" className="space-y-5" data-testid="control-room">
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Gauge className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{t('controlRoom.title')}</h2>
          <p className="text-sm text-muted">{t('controlRoom.subtitle')}</p>
        </div>
      </div>

      {/* The trend */}
      <section aria-labelledby="cr-trend" className="space-y-2">
        <h3 id="cr-trend" className="text-sm font-medium text-muted">
          {t('controlRoom.trend')}
        </h3>
        {known.length === 0 ? (
          <p className="text-sm text-subtle">{t('controlRoom.noData')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            {/* A trend needs two known points; with one, the text below says it all (no lone dot). */}
            {known.length >= 2 ? (
              <svg
                viewBox={`0 0 ${geo.w} ${geo.h}`}
                className="h-14 w-60 overflow-visible"
                role="img"
                aria-label={trendLabel}
                data-testid="control-room-trend"
              >
                <line
                  x1={0}
                  x2={geo.w}
                  y1={geo.targetY}
                  y2={geo.targetY}
                  style={{ stroke: 'rgb(var(--c-ink) / 0.35)' }}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {geo.segments.map((pts, i) => (
                  <polyline
                    key={i}
                    points={pts}
                    fill="none"
                    style={{ stroke: 'rgb(var(--c-primary))' }}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {geo.dots.map((d) => (
                  // Hover target bigger than the mark; the native title is the tooltip.
                  <g key={d.closingDate}>
                    <circle cx={d.cx} cy={d.cy} r={9} fill="transparent">
                      <title>{`${dayText(d.closingDate, locale)} · ${pct(d.bp, locale)}`}</title>
                    </circle>
                    <circle
                      cx={d.cx}
                      cy={d.cy}
                      r={4}
                      style={{ fill: 'rgb(var(--c-primary))', stroke: 'rgb(var(--c-surface))' }}
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                  </g>
                ))}
              </svg>
            ) : null}
            <div className="text-sm">
              {series.latest ? (
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    series.latest.bp > targetBp ? 'text-warn' : 'text-ink',
                  )}
                >
                  {t('controlRoom.latest', { pct: pct(series.latest.bp, locale) })}
                </p>
              ) : null}
              {series.latest?.deltaBp != null ? (
                <p className="text-muted tabular-nums">
                  {t('controlRoom.delta', {
                    delta: `${series.latest.deltaBp > 0 ? '+' : series.latest.deltaBp < 0 ? '−' : ''}${pct(Math.abs(series.latest.deltaBp), locale)}`,
                  })}
                </p>
              ) : null}
              <p className="text-subtle">
                {t('controlRoom.target', { pct: pct(targetBp, locale) })}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* The equation */}
      {equation ? (
        <section aria-labelledby="cr-eq" className="space-y-2">
          <h3 id="cr-eq" className="text-sm font-medium text-muted">
            {q.data.period
              ? t('controlRoom.period', {
                  from: dayText(q.data.period.from, locale),
                  to: dayText(q.data.period.to, locale),
                })
              : null}
          </h3>
          <ol
            className="divide-y divide-line rounded-xl border border-line"
            data-testid="control-room-equation"
          >
            {equation.terms.map((term) => (
              <li
                key={term.key}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <Link
                  href={drillHref(term.drill)}
                  className="touch-target inline-flex items-center gap-2 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span aria-hidden="true" className="w-3 text-center text-muted">
                    {term.sign < 0 ? '−' : '+'}
                  </span>
                  {t(`controlRoom.terms.${term.key}`)}
                </Link>
                <span className="tabular-nums text-ink">
                  <Money agorot={term.agorot} context="line" />
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 bg-surface-2/60 px-3 py-2 text-sm font-semibold">
              <span>
                <span aria-hidden="true" className="me-2 inline-block w-3 text-center text-muted">
                  =
                </span>
                {t('controlRoom.terms.usage')}
              </span>
              <span className="tabular-nums text-ink">
                <Money agorot={equation.usageAgorot} context="line" />
              </span>
            </li>
            <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <Link
                href={drillHref(equation.sales.drill)}
                className="touch-target inline-flex items-center gap-2 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span aria-hidden="true" className="w-3 text-center text-muted">
                  ÷
                </span>
                {t('controlRoom.terms.sales')}
              </Link>
              <span className="tabular-nums text-ink">
                {equation.sales.agorot != null ? (
                  <Money agorot={equation.sales.agorot} context="line" />
                ) : (
                  '—'
                )}
              </span>
            </li>
            <li
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold"
              data-testid="control-room-pct"
            >
              <span>
                <span aria-hidden="true" className="me-2 inline-block w-3 text-center text-muted">
                  =
                </span>
                {t('controlRoom.terms.pct')}
              </span>
              <span
                className={cn(
                  'tabular-nums',
                  equation.actualBp != null && equation.actualBp > targetBp
                    ? 'text-warn'
                    : 'text-ink',
                )}
              >
                {equation.actualBp != null ? pct(equation.actualBp, locale) : '—'}
              </span>
            </li>
          </ol>
          {equation.sales.agorot == null ? (
            <p className="text-xs text-subtle">{t('controlRoom.noSales')}</p>
          ) : null}
          {!trustworthy ? (
            <p className="text-xs text-muted" role="status" data-testid="control-room-check">
              {t('controlRoom.check')}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Category split: the rows add up to the usage above (one row reconciles what lines can't itemise). */}
      {equation && q.data.categories.length > 0 ? (
        <section aria-labelledby="cr-cat" className="space-y-2">
          <h3 id="cr-cat" className="text-sm font-medium text-muted">
            {t('controlRoom.categories')}
          </h3>
          <ul className="space-y-2" data-testid="control-room-categories">
            {q.data.categories.map((row) => (
              <li key={String(row.category)} className="space-y-1 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ink">
                    {row.category == null
                      ? t('controlRoom.categoryNone')
                      : row.category === '__other__'
                        ? t('controlRoom.categoryOther')
                        : row.category === '__unitemized__'
                          ? t('controlRoom.categoryUnitemized')
                          : row.category}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink">
                    <Money agorot={row.usageAgorot} context="line" />
                    <span className="ms-2 text-muted">{pct(row.shareBp, locale)}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                  <div
                    className="h-1.5 rounded-full bg-primary/70"
                    style={{ inlineSize: `${row.shareBp / 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Top-10 unexplained usage: only against a trustworthy recipes × POS theory. */}
      {equation ? (
        <section aria-labelledby="cr-unx" className="space-y-2">
          <div>
            <h3 id="cr-unx" className="text-sm font-medium text-muted">
              {t('controlRoom.unexplained')}
            </h3>
            {q.data.hasTheory ? (
              <p className="text-xs text-subtle">{t('controlRoom.unexplainedHint')}</p>
            ) : null}
          </div>
          {!q.data.hasTheory ? (
            <p className="text-sm text-subtle">{t('controlRoom.unexplainedNoTheory')}</p>
          ) : q.data.unexplained.length === 0 ? (
            <p className="text-sm text-subtle">{t('controlRoom.unexplainedNone')}</p>
          ) : (
            <ol
              className="divide-y divide-line rounded-xl border border-line"
              data-testid="control-room-unexplained"
            >
              {q.data.unexplained.map((row) => (
                <li
                  key={row.productId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-ink">
                    {locale === 'en' && row.nameEn ? row.nameEn : row.name}
                    {row.noRecipe ? (
                      <span className="ms-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                        {t('controlRoom.noRecipe')}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-warn">
                    <Money agorot={row.gapAgorot} context="line" />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </Card>
  );
}
