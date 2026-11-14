import { cnMerge as cn } from '../cn';
import { DOT_TONE, PILL_DOT, PILL_SHELL, PILL_TONE, type PillTone } from '../tone';

export type StatusTone = 'danger' | 'warn' | 'success' | 'gold' | 'info' | 'neutral';

/**
 * DS3 (SPEC §2 "the four tiers", §5): which pill a DS2 tone draws. The solid fill is reserved for
 * danger + bold, the one "חוסם תשלום" pill; a bold warning is the amber pill (T2); success and gold
 * are both the calm green of good news (T3); neutral is grey and is what pending looks like (T4).
 */
export function pillToneOf(tone: StatusTone, emphasis: 'bold' | 'subtle' = 'subtle'): PillTone {
  switch (tone) {
    case 'danger':
      return emphasis === 'bold' ? 'solid' : 'leak';
    case 'warn':
      return 'warn';
    case 'success':
    case 'gold':
      return 'ok';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

/**
 * The status dot (decorative: the word beside it carries the state). `sm` is the 6 px dot inside a
 * pill; `md` is the 8 px dot beside a label (the T1 leak label, a queue row, a task).
 */
export function StatusDot({ tone, size = 'md', className }: { tone: PillTone; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-dot={tone}
      className={cn(PILL_DOT, size === 'md' && 'size-2', DOT_TONE[tone], className)}
    />
  );
}

/**
 * The status pill of the clean finish (kit "סטטוס"): a dot or an icon, and a word that is always
 * in ink (white on the solid pill). Colour only when money waits for a person; what merely waits
 * is grey and never looks like a warning. `emphasis="bold"` is T2: on danger it is the one solid
 * pill ("חוסם תשלום"), on warn the amber pill. A roll-up passes the worst child's tone; no chip
 * when no state matters.
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
  /**
   * The marker before the word. Default: the tone's dot. Pass an icon to replace it (a clock for
   * what is pending, a calendar for a deadline), or `null` to drop it (the word still carries the state).
   */
  icon?: React.ReactNode | null;
  size?: 'sm' | 'md';
  /** `control` (radius 8) inside tables, `pill` elsewhere. */
  shape?: 'pill' | 'control';
  className?: string;
}) {
  const pill = pillToneOf(tone, emphasis);
  return (
    <span
      data-tone={tone}
      data-pill={pill}
      className={cn(
        PILL_SHELL,
        size === 'md' && 'min-h-6 px-2.5 text-body-sm',
        shape === 'pill' ? 'rounded-pill' : 'rounded-control',
        PILL_TONE[pill],
        className,
      )}
    >
      {icon === undefined ? <StatusDot tone={pill} size="sm" /> : icon}
      <span className="min-w-0">{label}</span>
    </span>
  );
}

/** A count on a nav item or tab: ≥20×20, caption 600, hidden at 0 (unless `showZero`), "99+" above `max`. */
export function CountBadge({
  count,
  max = 99,
  tone = 'neutral',
  label,
  showZero = false,
  className,
}: {
  count: number;
  max?: number;
  tone?: 'neutral' | 'danger';
  /** Screen-reader text, e.g. "3 ממתינות לאישור". Without it the number is read as-is. */
  label?: string;
  /** DS3 tabs: every tab says how many wait in it, also when that is zero. */
  showZero?: boolean;
  className?: string;
}) {
  if (!Number.isFinite(count) || count < 0 || (count === 0 && !showZero)) return null;
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
