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
 * @deprecated v1 compact metric tile — new code uses `MetricTile`
 * (lib/components/money). Kept as a compatibility wrapper so existing call
 * sites render unchanged until their area migrates. Heebo tabular value (the
 * mono subset has no ₪ glyph); Hebrew labels are never letter-spaced.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
  emphasis = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
  icon?: React.ReactNode;
  className?: string;
  /** T1 "the one number" (docs/DESIGN-BRIEF.md): danger start rail + border, ink figure, larger type. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-surface p-4',
        emphasis ? 'relative overflow-hidden border-danger/35 ps-5' : 'border-line',
        className,
      )}
    >
      {emphasis ? <div className="absolute inset-y-0 start-0 w-1.5 bg-danger" aria-hidden="true" /> : null}
      <div className="flex items-center gap-2">
        {icon ? <span className="text-muted">{icon}</span> : null}
        <p className="text-xs font-semibold text-subtle ltr:uppercase ltr:tracking-wider">{label}</p>
      </div>
      <p
        className={cn(
          'num mt-1.5 font-bold tracking-tight',
          emphasis ? 'text-3xl font-extrabold text-ink' : `text-2xl ${valueTone[tone]}`,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
