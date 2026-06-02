import { cn } from './cn';

export type BadgeTone = 'danger' | 'warning' | 'accent' | 'info' | 'neutral';

const tones: Record<BadgeTone, string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/12 text-warning',
  accent: 'bg-accent/12 text-accent',
  info: 'bg-primary/10 text-primary',
  neutral: 'bg-stone-100 text-stone-600',
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
