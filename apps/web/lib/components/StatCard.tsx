import { cn } from './cn';

export type StatTone = 'neutral' | 'primary' | 'gold' | 'danger' | 'warn' | 'info';

const valueTone: Record<StatTone, string> = {
  neutral: 'text-ink',
  primary: 'text-primary',
  gold: 'text-gold',
  danger: 'text-danger',
  warn: 'text-warn',
  info: 'text-info',
};

/**
 * Compact metric tile — lighter than KpiCard, for dense stat grids. Mono
 * tabular value, optional leading icon and hint. Money-positive figures read
 * best with tone="gold", losses with tone="danger". Server-safe (no hooks).
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface p-4', className)}>
      <div className="flex items-center gap-2">
        {icon ? <span className="text-muted">{icon}</span> : null}
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{label}</p>
      </div>
      <p className={cn('mt-1.5 font-mono text-2xl font-bold tabular-nums tracking-tight', valueTone[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
