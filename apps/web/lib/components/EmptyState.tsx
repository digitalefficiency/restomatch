import { CheckCircle2, Lock, TriangleAlert } from 'lucide-react';
import { cn } from './cn';

export type EmptyStateKind = 'first-use' | 'no-results' | 'inbox-zero' | 'error' | 'permission';

interface EmptyBase {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  /** Centre the content (inside tiles). Pages default to start-aligned for typed kinds (C8). */
  align?: 'start' | 'center';
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
  'inbox-zero': <CheckCircle2 className="h-6 w-6" aria-hidden="true" />,
  error: <TriangleAlert className="h-6 w-6" aria-hidden="true" />,
  permission: <Lock className="h-6 w-6" aria-hidden="true" />,
};

const KIND_CHIP: Record<EmptyStateKind | 'legacy', string> = {
  legacy: 'bg-primary/10 text-primary ring-1 ring-primary/20',
  'first-use': 'bg-primary-subtle text-primary',
  'no-results': 'bg-neutral-subtle text-neutral',
  'inbox-zero': 'bg-primary-subtle text-primary',
  error: 'bg-danger-subtle text-danger',
  permission: 'bg-neutral-subtle text-neutral',
};

/**
 * Empty / zero state. A typed `kind` says WHY it's empty — not set up
 * (`first-use`), hidden by a filter (`no-results`, offer "נקה סינון"), earned
 * calm (`inbox-zero`, say what was handled), `error` or `permission` — so users
 * can tell "nothing to do" from "hidden" from "broken". TypeScript requires an
 * `action` for `first-use` and `no-results`.
 */
export function EmptyState(props: EmptyStateProps) {
  const { icon, title, description, action, className, kind } = props;
  const align = props.align ?? (kind ? 'start' : 'center');
  const chip = icon ?? (kind ? KIND_ICON[kind] : undefined);
  return (
    <div
      data-empty-kind={kind}
      className={cn(
        'flex flex-col rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-12',
        align === 'center' ? 'items-center text-center' : 'items-start text-start',
        className,
      )}
    >
      {chip ? (
        <div className={cn('mb-4 flex h-12 w-12 items-center justify-center rounded-2xl', KIND_CHIP[kind ?? 'legacy'])}>
          {chip}
        </div>
      ) : null}
      <p className="text-base font-bold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
