import { cnMerge as cn } from './cn';
import { PILL_SHELL, PILL_TONE, type PillTone } from './tone';

export type BadgeTone = 'danger' | 'warning' | 'accent' | 'info' | 'neutral' | 'gold' | 'danger-solid' | 'warning-solid';

/**
 * v1 tones on the clean finish's one pill (DS3, SPEC §5): the same shell and the same role classes
 * as <StatusChip>, so a tag and a status read as one family. `danger-solid` is the solid pill
 * ("act now", T2); `warning-solid` is the amber pill, since the clean finish keeps one solid fill.
 * `accent` and `gold` are good news (T3, calm green).
 */
const PILL_OF: Record<BadgeTone, PillTone> = {
  danger: 'leak',
  warning: 'warn',
  accent: 'ok',
  gold: 'ok',
  info: 'info',
  neutral: 'neutral',
  'danger-solid': 'solid',
  'warning-solid': 'warn',
};

/**
 * A pill for a tag, a role, a count or a status word. Unlike <StatusChip> it draws no dot: it is
 * also used for plain tags (a role, a supplier, "EN"); pass `icon` when the pill is a status.
 */
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
    <span data-badge={tone} className={cn(PILL_SHELL, 'rounded-pill', PILL_TONE[PILL_OF[tone]], className)}>
      {icon}
      {children}
    </span>
  );
}
