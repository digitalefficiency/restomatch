'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import { useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { overview } from '@/lib/i18n/messages/overview';
import { trpc } from '@/lib/trpc/client';
import { Skeleton } from '@/lib/components/Skeleton';
import { Icon } from '@/lib/components/icon';
import { Money } from '@/lib/components/money';
import { useHeroFoldOpened } from '@/lib/components/hero/HeroFold';
import { agorotOf, calcRowsGuard } from '@/lib/components/hero/model';
import { discrepancyLabel } from '../approvals/vocab';

export type CalcBasis = 'excl' | 'incl' | 'vat';

export interface CalcRowsProps {
  /** The hero's month for owner.leakReport (`heroMonthKey`); null when the bounds did not parse. */
  month: string | null;
  /** The hero's own month start and its exact leak in agorot: the rows show only when they prove THIS hero. */
  heroMonthStart: string;
  heroAgorot: number;
  /** The VAT basis of every discrepancy type (vatBasisOf), resolved on the server. */
  basisByType: Record<string, CalcBasis>;
  /** The basis words and the mixed-basis note (leaks `claims.basis.*`, `claims.mixedBasis`), resolved on the server. */
  basisWords: Record<CalcBasis, string> & { mixed: string };
  locale?: Locale;
}

/**
 * The rows of "איך הגענו לסכום?" (DS3 SPEC §10.1; v2 A2–A8, v4 H3): one per kind of gap with its
 * count and amount, the cap when the per-invoice cap removed something, and the total before
 * rounding — read from owner.leakReport on the FIRST open of the fold (never on every home load),
 * then kept. The report is a separate read from the hero, so its rows stand under the hero only
 * when `calcRowsGuard` proves they add up to this very hero (same month, same agorot, rows − cap =
 * total); otherwise the panel says the sum changed since the page loaded and offers a refresh.
 *
 * One grid for every row and the total (v2 A8): the amounts share one column, their digits
 * physically right-aligned; the dotted leader is decoration. The VAT basis is said once, under the
 * total, when every row has the same one; per row (with a note) when they mix. G-16 markers: rows
 * `data-money-row-of="hero-calc"`, the total `data-money-sum-of="hero-calc"` (+ the cap).
 */
export function CalcRows({ month, heroMonthStart, heroAgorot, basisByType, basisWords, locale }: CalcRowsProps) {
  const opened = useHeroFoldOpened();
  const t = useT(overview);
  const ta = useT(approvals);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const q = trpc.owner.leakReport.useQuery(
    { month: month ?? '' },
    { enabled: opened && month !== null, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (!opened) return null;

  const report = q.data;
  if (!report) {
    if (month === null || q.isError) {
      return <CalcNotice testId="hero-calc-failed" text={t('section.failed')} action={t('section.retry')} onAction={() => void q.refetch()} disabled={month === null || q.isFetching} />;
    }
    return (
      <div aria-busy="true" data-testid="hero-calc-loading" className="space-y-2">
        <Skeleton delayed className="h-4 w-56 max-w-full rounded-control" />
        <Skeleton delayed className="h-4 w-full rounded-control" />
        <Skeleton delayed className="h-4 w-full rounded-control" />
        <Skeleton delayed className="h-4 w-full rounded-control" />
      </div>
    );
  }

  if (!calcRowsGuard(report, heroMonthStart, heroAgorot)) {
    return (
      <CalcNotice
        testId="hero-calc-changed"
        text={t('hero.calcChanged')}
        action={t('hero.calcRefreshCta')}
        disabled={refreshing || q.isFetching}
        onAction={() => {
          // The hero and the rows are read again together: the page's figures, then the report.
          startRefresh(() => router.refresh());
          void q.refetch();
        }}
      />
    );
  }

  const gaps = report.byType.reduce((sum, row) => sum + row.count, 0);
  const basisOf = (type: string): CalcBasis => basisByType[type] ?? 'excl';
  // One basis for every row: said once, under the total. Mixed: each row says its own, and a note says so.
  const bases = [...new Set(report.byType.map((row) => basisOf(row.type)))];
  const mixed = bases.length > 1;
  const single = bases.length === 1 ? bases[0]! : null;
  const totalAgorot = agorotOf(report.hero.leakIls);
  const capAgorot = agorotOf(report.capAdjustmentIls);
  const leader = <span aria-hidden="true" className="min-w-2 flex-1 -translate-y-1 border-b border-dotted border-line-strong opacity-55" />;

  return (
    <div data-testid="hero-calc">
      <h3 className="text-body-sm font-medium text-fg-secondary">{t('hero.calcTitle', { gaps, invoices: report.hero.invoicesWithLeak })}</h3>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
        {report.byType.map((row) => (
          <div key={row.type} data-testid="hero-calc-row" data-calc-type={row.type} className="col-span-2 grid grid-cols-subgrid items-baseline py-1 text-body-sm">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 text-fg">{discrepancyLabel(ta, row.type)}</span>
              <span className="shrink-0 whitespace-nowrap text-caption text-fg-tertiary">
                {t('hero.calcGaps', { count: row.count })}
                {mixed ? ` · ${basisWords[basisOf(row.type)]}` : null}
              </span>
              {leader}
            </span>
            <span className="text-right text-fg" data-money-row-of="hero-calc" data-money-agorot={agorotOf(row.amountIls)}>
              <Money value={row.amountIls} context="line" split locale={locale} />
            </span>
          </div>
        ))}
        {capAgorot > 0 ? (
          <div data-testid="hero-calc-cap" className="col-span-2 grid grid-cols-subgrid items-baseline py-1 text-body-sm">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 text-fg-secondary">{t('hero.calcCap')}</span>
              {leader}
            </span>
            <span className="text-right text-fg">
              <Money value={report.capAdjustmentIls} context="line" split locale={locale} />
            </span>
          </div>
        ) : null}
        {mixed ? <p className="col-span-2 pt-1 text-caption text-fg-tertiary">{basisWords.mixed}</p> : null}
        <div
          data-testid="hero-calc-total"
          className="col-span-2 mt-1.5 grid grid-cols-subgrid items-baseline border-t-4 border-double border-fg pt-2 text-body-sm font-semibold text-fg"
        >
          <span className="min-w-0">{t('hero.calcTotal')}</span>
          <span
            className="text-right"
            data-money-sum-of="hero-calc"
            data-money-agorot={totalAgorot}
            // A capped total equals min(Σ rows, cap): the cap row above says what it removed.
            data-money-cap-agorot={capAgorot > 0 ? totalAgorot : undefined}
          >
            <Money value={report.hero.leakIls} context="line" split locale={locale} />
          </span>
        </div>
        {single ? (
          <p data-testid="hero-calc-basis" className="col-start-2 text-right text-caption text-fg-tertiary">
            {basisWords[single]}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The panel's one-line state (neutral, announced): what happened and the one way out. */
function CalcNotice({ text, action, onAction, disabled, testId }: { text: string; action: string; onAction: () => void; disabled?: boolean; testId: string }) {
  return (
    <p role="status" data-testid={testId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-secondary">
      <span>{text}</span>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="-ms-2 inline-flex min-h-8 items-center gap-1.5 rounded-control px-2 font-medium text-primary transition-colors duration-micro ease-standard hover:bg-surface-hover disabled:text-fg-tertiary [@media(pointer:coarse)]:min-h-11"
      >
        <Icon as={RotateCcw} size="body-sm" />
        {action}
      </button>
    </p>
  );
}
