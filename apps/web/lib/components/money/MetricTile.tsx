import type { MoneyState } from '@restomatch/ui-tokens';
import Link from 'next/link';
import { moneyStates } from '@restomatch/ui-tokens';
import { cnMerge as cn } from '../cn';
import { Skeleton } from '../Skeleton';
import { NUM_ALIGN } from './format';

const FIGURE = { ink: 'text-ink', muted: 'text-muted', gold: 'text-gold', primary: 'text-primary' } as const;

/**
 * KPI tile v2 (design-system-07): label → value → context → delta/sparkline →
 * one link. e0 card (border, no shadow), radius 12, neutral icon, no glow, no
 * flow top. `loading` keeps the same box; `unavailable` says so — never ₪0.
 * `value` is usually a <Money context="tile">; the tile only sets size + colour.
 */
export function MetricTile({
  label,
  value,
  state,
  context,
  delta,
  sparkline,
  href,
  linkLabel,
  action,
  icon,
  loading = false,
  unavailable,
  className,
}: {
  label: React.ReactNode;
  value?: React.ReactNode;
  state?: MoneyState;
  /** One or two lines of context (period, base, count). */
  context?: React.ReactNode;
  delta?: React.ReactNode;
  sparkline?: React.ReactNode;
  href?: string;
  linkLabel?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  loading?: boolean;
  /** Text shown instead of the value when it failed to load (e.g. "לא זמין · נסו שוב"). */
  unavailable?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface p-4 md:p-5', className)}
      aria-busy={loading || undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-caption font-semibold text-muted">{label}</p>
        {icon ? <span className="shrink-0 text-muted">{icon}</span> : null}
      </div>
      {loading ? (
        <Skeleton variant="metric" />
      ) : unavailable ? (
        <p className="text-body-sm text-muted">{unavailable}</p>
      ) : (
        <div data-num className={cn('min-w-0 break-words text-metric-lg', NUM_ALIGN, state ? FIGURE[moneyStates[state].figure] : 'text-ink')}>
          {value}
        </div>
      )}
      {context ? <p className="line-clamp-2 text-body-sm text-muted">{context}</p> : null}
      {delta || sparkline ? (
        <div className="mt-1 flex items-end justify-between gap-3">
          {delta ?? <span />}
          {sparkline}
        </div>
      ) : null}
      {href && linkLabel ? (
        <Link href={href} className="mt-1 self-start text-body-sm font-semibold text-primary underline-offset-2 hover:underline">
          {linkLabel}
        </Link>
      ) : null}
      {action}
    </div>
  );
}
