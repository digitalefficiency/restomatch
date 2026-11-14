import { cn } from '@/lib/components';
import type { AbsentOn, SettingsScope } from '../_index/sections';

/**
 * Where a row is absent, in CSS (so the first HTML is already right): the
 * same predicates as lib/prefs COARSE_QUERY / NARROW_QUERY / PHONE_QUERY.
 * Literal class strings, so Tailwind generates them.
 */
const ABSENT_CLASS: Record<AbsentOn, string> = {
  coarse: '[@media(pointer:coarse)]:hidden',
  narrow: '[@media(max-width:1023.98px)]:hidden',
  phone: '[@media(max-width:1023.98px)_and_(pointer:coarse)]:hidden',
};

/**
 * The settings building blocks in the clean finish (reference ex4 `.set-*`):
 * a section head with its scope chip, a white card of rows separated by
 * hairlines, and rows of label · hint · control. Server-safe (no hooks); the
 * interactive controls live in their own client files.
 * Promote to shared (DS3-01): SettingsRows/SettingRow and the scope chip.
 */

export function ScopeChip({ label, scope }: { label: string; scope: SettingsScope }) {
  return (
    <span
      data-scope={scope}
      className="inline-flex h-6 items-center whitespace-nowrap rounded-pill bg-surface-2 px-2.5 text-caption font-medium text-muted"
    >
      {label}
    </span>
  );
}

/** h2 + scope chip + one-line subtitle. The page's single h1 ("הגדרות") is in the frame. */
export function SectionHead({
  title,
  subtitle,
  scope,
  scopeLabel,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  scope: SettingsScope;
  scopeLabel: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-title-md text-ink">{title}</h2>
          <ScopeChip label={scopeLabel} scope={scope} />
        </div>
        {subtitle ? <p className="mt-0.5 max-w-prose text-body-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A small heading inside a section ("ספי סבילות"). */
export function SubHead({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-2 mt-6 text-body-sm font-semibold text-muted first:mt-0">
      {children}
    </h3>
  );
}

/** The white card that holds a section's rows. */
export function SettingsRows({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('rounded-card border border-line bg-surface shadow-e1', className)}>
      {children}
    </div>
  );
}

/**
 * One setting: label (with chips), a one-line hint, the control at the end.
 * `id` is the anchor the search and the palette link to (`#<id>`); the frame
 * highlights it on arrival. `absentOn` hides a row where it does nothing
 * (density on touch, the side menu below 1024 px, shortcuts on a phone).
 */
export function SettingRow({
  id,
  label,
  hint,
  control,
  absentOn,
  className,
  stack,
  onClick,
}: {
  id?: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  control?: React.ReactNode;
  absentOn?: AbsentOn;
  className?: string;
  /** Put the control under the text at every width (wide forms). */
  stack?: boolean;
  /** Pointer convenience: the whole row toggles (a switch row); the control stays the accessible target. */
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      id={id}
      onClick={onClick}
      data-setting-row={id}
      tabIndex={id ? -1 : undefined}
      className={cn(
        'grid scroll-mt-24 items-center gap-x-6 gap-y-2 border-t border-line-rule px-4 py-3 transition-colors duration-medium first:rounded-t-card first:border-t-0 last:rounded-b-card focus:outline-none data-[hit=true]:bg-info-subtle',
        stack ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]',
        absentOn && ABSENT_CLASS[absentOn],
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-medium text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-caption text-muted">{hint}</div> : null}
      </div>
      {control ? <div className="flex min-w-0 flex-wrap items-center gap-2">{control}</div> : null}
    </div>
  );
}

/** The anchor block around a whole form (several settings share it): the search lands and highlights here. */
export function SettingAnchor({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      id={id}
      data-setting-row={id}
      tabIndex={-1}
      className={cn('scroll-mt-24 rounded-card transition-colors duration-medium focus:outline-none data-[hit=true]:bg-info-subtle', className)}
    >
      {children}
    </div>
  );
}

/** A key cap inside running text (`<kbd>`), LTR-isolated. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      dir="ltr"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-surface-2 px-1 font-sans text-kbd text-ink"
    >
      {children}
    </kbd>
  );
}

/** A section's quiet footer line (notes on the start side, a link action on the end side). */
export function SectionFoot({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">{children}</div>;
}
