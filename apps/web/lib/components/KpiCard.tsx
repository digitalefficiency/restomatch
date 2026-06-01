import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from './cn';

export type KpiTone = 'accent' | 'warning' | 'danger' | 'neutral';

const tones: Record<KpiTone, { icon: string; glow: string }> = {
  accent: { icon: 'text-emerald-600 bg-emerald-50 ring-emerald-100', glow: 'bg-emerald-400' },
  warning: { icon: 'text-amber-600 bg-amber-50 ring-amber-100', glow: 'bg-amber-400' },
  danger: { icon: 'text-red-600 bg-red-50 ring-red-100', glow: 'bg-red-400' },
  neutral: { icon: 'text-blue-600 bg-blue-50 ring-blue-100', glow: 'bg-blue-400' },
};

/**
 * KPI card — colored icon chip, optional trend delta, soft glow.
 * Static (no animation) so it renders in server components.
 */
export function KpiCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
  icon,
  delta,
  deltaTone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: KpiTone;
  icon?: React.ReactNode;
  /** Optional percentage change shown as a trend chip. */
  delta?: number;
  /** Whether a positive delta is good (green) or bad (red). */
  deltaTone?: 'good' | 'bad' | 'neutral';
}) {
  const t = tones[tone];
  const deltaUp = (delta ?? 0) >= 0;
  const deltaColor =
    deltaTone === 'good'
      ? deltaUp
        ? 'text-emerald-600'
        : 'text-red-600'
      : deltaTone === 'bad'
        ? deltaUp
          ? 'text-red-600'
          : 'text-emerald-600'
        : 'text-slate-500';

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.06)]">
      <div className="mb-4 flex items-start justify-between">
        {icon ? (
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl ring-1', t.icon)}>
            {icon}
          </div>
        ) : (
          <span />
        )}
        {typeof delta === 'number' ? (
          <div className={cn('flex items-center gap-1 text-xs font-semibold', deltaColor)}>
            {deltaUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span className="tabular-nums">
              {delta > 0 ? '+' : ''}
              {delta}%
            </span>
          </div>
        ) : null}
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {subtitle ? <p className="mt-2 text-xs text-slate-500">{subtitle}</p> : null}

      <div
        className={cn(
          'pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full opacity-[0.10] blur-3xl',
          t.glow,
        )}
      />
    </div>
  );
}
