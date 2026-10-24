import { cn } from './cn';

export type BadgeTone = 'danger' | 'warning' | 'accent' | 'info' | 'neutral' | 'gold' | 'danger-solid' | 'warning-solid';

const tones: Record<BadgeTone, string> = {
  // Tinted fills + ring (every tone ≥4.5:1 on its own tint).
  danger: 'bg-danger/12 text-danger ring-1 ring-danger/25',
  warning: 'bg-warn/12 text-warn ring-1 ring-warn/25',
  accent: 'bg-primary/12 text-primary ring-1 ring-primary/25',
  gold: 'bg-gold/12 text-gold ring-1 ring-gold/25',
  info: 'bg-info/12 text-info ring-1 ring-info/25',
  neutral: 'bg-surface-2 text-muted ring-1 ring-line',
  // Emphasis tier T2 ("act now"): solid fills for blocking / needs-a-decision.
  'danger-solid': 'bg-danger text-white ring-1 ring-danger',
  'warning-solid': 'bg-warn text-white ring-1 ring-warn',
};

/** Pill badge for severity / status / trend indicators. */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
