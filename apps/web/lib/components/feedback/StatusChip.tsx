import { CircleCheck, Clock, Coins, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { cn } from '../cn';

export type StatusTone = 'danger' | 'warn' | 'success' | 'gold' | 'info' | 'neutral';

const DEFAULT_ICON: Record<StatusTone, typeof Info> = {
  danger: OctagonAlert,
  warn: TriangleAlert,
  success: CircleCheck,
  gold: Coins,
  info: Info,
  neutral: Clock,
};

const SUBTLE: Record<StatusTone, string> = {
  danger: 'bg-danger-subtle text-danger border-danger-subtle',
  warn: 'bg-warn-subtle text-warn border-warn-subtle',
  success: 'bg-primary-subtle text-primary border-primary-subtle',
  gold: 'bg-gold-subtle text-gold border-gold-subtle',
  info: 'bg-info-subtle text-info border-info-subtle',
  neutral: 'bg-neutral-subtle text-neutral border-neutral-subtle',
};

const BOLD: Record<StatusTone, string> = {
  danger: 'bg-danger-bold text-on-bold border-transparent',
  warn: 'bg-warn-bold text-on-bold border-transparent',
  success: 'bg-primary-bold text-on-bold border-transparent',
  gold: 'bg-gold-bold text-on-bold border-transparent',
  info: 'bg-info-bold text-on-bold border-transparent',
  neutral: 'bg-neutral-bold text-on-bold border-transparent',
};

/**
 * Status = icon + word + colour, never colour alone (design-system-07). `bold`
 * is reserved for T2 (act now); everything else is `subtle`. A roll-up passes
 * the worst child's tone. No chip when no state matters.
 */
export function StatusChip({
  tone,
  label,
  emphasis = 'subtle',
  icon,
  size = 'sm',
  shape = 'pill',
  className,
}: {
  tone: StatusTone;
  label: React.ReactNode;
  emphasis?: 'bold' | 'subtle';
  /** Overrides the tone's default icon; pass `null` to drop it (the word still carries the state). */
  icon?: React.ReactNode | null;
  size?: 'sm' | 'md';
  /** `control` (radius 8) inside tables, `pill` elsewhere. */
  shape?: 'pill' | 'control';
  className?: string;
}) {
  const Icon = DEFAULT_ICON[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex max-w-full items-center gap-1 border font-semibold',
        size === 'sm' ? 'min-h-5 px-2 text-caption' : 'min-h-6 px-2.5 text-body-sm',
        shape === 'pill' ? 'rounded-pill' : 'rounded-control',
        emphasis === 'bold' ? BOLD[tone] : SUBTLE[tone],
        className,
      )}
    >
      {icon === undefined ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : icon}
      <span className="min-w-0">{label}</span>
    </span>
  );
}

/** A count on a nav item or tab: ≥20×20, caption 600, hidden at 0, "99+" above `max`. */
export function CountBadge({
  count,
  max = 99,
  tone = 'neutral',
  label,
  className,
}: {
  count: number;
  max?: number;
  tone?: 'neutral' | 'danger';
  /** Screen-reader text, e.g. "3 ממתינות לאישור". Without it the number is read as-is. */
  label?: string;
  className?: string;
}) {
  if (!count || count < 0) return null;
  return (
    <span
      className={cn(
        'inline-flex min-h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-caption font-semibold',
        tone === 'danger' ? 'bg-danger-bold text-on-bold' : 'bg-neutral-subtle text-ink',
        className,
      )}
    >
      <bdi dir="ltr" aria-hidden={label ? true : undefined} className="num">
        {count > max ? `${max}+` : count}
      </bdi>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
