import { CheckCircle2, Lock } from 'lucide-react';
import { cnMerge as cn } from './cn';

export type EmptyStateKind = 'first-use' | 'no-results' | 'inbox-zero' | 'error' | 'permission';

interface EmptyBase {
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** What was checked and when ("נבדקו 35 חשבוניות, עד היום ב־10:42"); for an error, what is safe. */
  description?: React.ReactNode;
  className?: string;
  /** Centre the content (inside tiles). Pages default to start-aligned for typed kinds (C8). */
  align?: 'start' | 'center';
  /** `region` (default): a quiet card of its own. `inline`: inside a card that already frames it. */
  variant?: 'region' | 'inline';
}

/** v1 API — no kind, action optional. Still compiles everywhere. */
interface LegacyEmpty extends EmptyBase {
  kind?: undefined;
  action?: React.ReactNode;
}
/** "Not set up yet" and "hidden by a filter" must offer the way out (perf-states-13). */
interface ActionEmpty extends EmptyBase {
  kind: 'first-use' | 'no-results';
  action: React.ReactNode;
}
interface OtherEmpty extends EmptyBase {
  kind: 'inbox-zero' | 'error' | 'permission';
  action?: React.ReactNode;
}

export type EmptyStateProps = LegacyEmpty | ActionEmpty | OtherEmpty;

const KIND_ICON: Partial<Record<EmptyStateKind, React.ReactNode>> = {
  'inbox-zero': <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
  permission: <Lock className="h-5 w-5" aria-hidden="true" />,
};

/** DS3: a round chip; calm green for earned calm (inbox zero), grey otherwise. No red: an empty or broken view is not money waiting. */
const KIND_CHIP: Record<EmptyStateKind | 'legacy', string> = {
  legacy: 'border-primary-subtle bg-primary-subtle text-primary',
  'first-use': 'border-primary-subtle bg-primary-subtle text-primary',
  'no-results': 'border-line bg-surface-sunken text-fg-secondary',
  'inbox-zero': 'border-primary-subtle bg-primary-subtle text-primary',
  error: 'border-line bg-surface-sunken text-fg-secondary',
  permission: 'border-line bg-surface-sunken text-fg-secondary',
};

/**
 * Empty / zero state. A typed `kind` says WHY it's empty — not set up
 * (`first-use`), hidden by a filter (`no-results`, offer "נקה סינון"), earned
 * calm (`inbox-zero`, say what was handled), `error` or `permission` — so users
 * can tell "nothing to do" from "hidden" from "broken". TypeScript requires an
 * `action` for `first-use` and `no-results`.
 *
 * DS3 (kit "טעינה, ריק, שגיאה"): an empty state says what was checked and when; an error says
 * what is safe, offers one action and never shows ₪0, with no icon and no red. `region` (default)
 * is a quiet card of its own; `inline` sits inside a card that already frames it.
 */
export function EmptyState(props: EmptyStateProps) {
  const { icon, title, description, action, className, kind } = props;
  const align = props.align ?? (kind ? 'start' : 'center');
  const variant = props.variant ?? 'region';
  const chip = icon ?? (kind ? KIND_ICON[kind] : undefined);
  return (
    <div
      data-empty-kind={kind}
      className={cn(
        'flex flex-col',
        variant === 'region' ? 'rounded-card border border-line bg-surface px-6 py-10' : 'gap-0',
        align === 'center' ? 'items-center text-center' : 'items-start text-start',
        className,
      )}
    >
      {chip ? (
        <div className={cn('mb-2 flex size-9 items-center justify-center rounded-full border', KIND_CHIP[kind ?? 'legacy'])}>{chip}</div>
      ) : null}
      <p className="text-body-sm font-semibold text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-body-sm text-fg-secondary">{description}</p> : null}
      {action ? <div className={variant === 'region' ? 'mt-4' : 'mt-2'}>{action}</div> : null}
    </div>
  );
}
