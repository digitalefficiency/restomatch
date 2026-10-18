import { cn } from './cn';

export type BadgeTone = 'danger' | 'warning' | 'accent' | 'info' | 'neutral' | 'gold';

const tones: Record<BadgeTone, string> = {
  // Tinted fills + ring on the dark canvas, with a glowing text color.
  danger: 'bg-danger/12 text-danger ring-1 ring-danger/25',
  warning: 'bg-warn/12 text-warn ring-1 ring-warn/25',
  accent: 'bg-primary/12 text-primary ring-1 ring-primary/25',
  gold: 'bg-gold/12 text-gold ring-1 ring-gold/25',
  info: 'bg-info/12 text-info ring-1 ring-info/25',
  neutral: 'bg-surface-2 text-muted ring-1 ring-line',
};

/** Pill badge for severity / status / trend indicators (dark command-center tones). */
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
