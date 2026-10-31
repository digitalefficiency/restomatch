import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from './cn';
import { Sparkline } from './Sparkline';

export type KpiTone = 'accent' | 'warning' | 'danger' | 'neutral' | 'gold';

const tones: Record<KpiTone, { icon: string; glow: string; value: string }> = {
  // icon chip = tinted fill + ring; glow blob = soft radial; value tint.
  accent: { icon: 'text-primary bg-primary/12 ring-primary/25', glow: 'glow-primary-blob', value: 'text-ink' },
  gold: { icon: 'text-gold bg-gold/12 ring-gold/25', glow: 'glow-gold-blob', value: 'text-gold' },
  warning: { icon: 'text-warn bg-warn/12 ring-warn/25', glow: 'glow-gold-blob', value: 'text-ink' },
  danger: { icon: 'text-danger bg-danger/12 ring-danger/25', glow: 'glow-danger-blob', value: 'text-danger' },
  neutral: { icon: 'text-muted bg-surface-2 ring-line', glow: 'glow-primary-blob', value: 'text-ink' },
};

/**
 * @deprecated v1 KPI card — new code uses `MetricTile` (lib/components/money).
 * Kept as a compatibility wrapper so existing call sites render unchanged until
 * their area migrates (wave 2). The value is Heebo tabular (`.num`), not mono:
 * the mono subset has no ₪ glyph (design-system-02). Hebrew labels are never
 * letter-spaced (design-system-14).
 */
export function KpiCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
  icon,
  delta,
  deltaTone = 'neutral',
  sparkline,
  emphasis = false,
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
  /** Optional inline trend series rendered as a sparkline. */
  sparkline?: number[];
  /** T1 "the one number" (docs/DESIGN-BRIEF.md): danger start rail + border, ink figure, larger type. */
  emphasis?: boolean;
}) {
  const t = tones[tone];
  const deltaUp = (delta ?? 0) >= 0;
  const deltaColor =
    deltaTone === 'good'
      ? deltaUp
        ? 'text-primary'
        : 'text-danger'
      : deltaTone === 'bad'
        ? deltaUp
          ? 'text-danger'
          : 'text-primary'
        : 'text-muted';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-surface p-6 shadow-card',
        emphasis ? 'border-danger/35' : 'border-line',
      )}
    >
      {emphasis ? (
        <div className="absolute inset-y-0 start-0 w-1.5 bg-danger" aria-hidden="true" />
      ) : (
        <div className="absolute inset-x-0 top-0 h-px flow-stream" aria-hidden="true" />
      )}
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
            <span className="num">
              {delta > 0 ? '+' : ''}
              {delta}%
            </span>
          </div>
        ) : null}
      </div>

      <p className="mb-2 text-xs font-semibold text-subtle ltr:uppercase ltr:tracking-wider">{label}</p>
      <p
        className={cn(
          'num font-extrabold tracking-tight',
          emphasis ? 'text-4xl text-ink' : `text-3xl ${t.value}`,
        )}
      >
        {value}
      </p>

      <div className="mt-2 flex items-end justify-between gap-3">
        {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : <span />}
        {sparkline && sparkline.length > 1 ? (
          <Sparkline data={sparkline} className="h-7 w-24 opacity-90" />
        ) : null}
      </div>

      <div
        className={cn(
          'pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full opacity-70 blur-2xl',
          t.glow,
        )}
        aria-hidden="true"
      />
    </div>
  );
}
