import { useId } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from './cn';
import { Spinner } from './Spinner';

/**
 * v2 variants: `primary | secondary | tertiary | danger`. `ghost` is the quiet
 * toolbar action. `accent` (= primary) and `gold` are deprecated aliases kept
 * until W4 — gold is a money state, not a button colour. One primary per region.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost' | 'accent' | 'gold';
/** Heights: sm 32 (desk tables) · md 40 (default) · lg 48 (mobile primary) · xl 56 full width (field primary). */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

// Focus is the global :focus-visible outline (globals.css) — no per-variant rings.
const base =
  'relative inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold transition-colors duration-micro ease-standard disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary-bold text-on-bold hover:bg-primary-bold-hover active:bg-primary-bold-hover aria-pressed:bg-primary-bold-hover',
  accent: 'bg-primary-bold text-on-bold hover:bg-primary-bold-hover active:bg-primary-bold-hover aria-pressed:bg-primary-bold-hover',
  gold: 'bg-gold-bold text-on-bold hover:bg-gold-bold-hover active:bg-gold-bold-hover',
  danger: 'bg-danger-bold text-on-bold hover:bg-danger-bold-hover active:bg-danger-bold-hover',
  secondary:
    'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-neutral-subtle-hover aria-pressed:border-primary aria-pressed:bg-primary-subtle aria-pressed:text-primary',
  tertiary: 'text-primary underline-offset-2 hover:underline active:text-primary-bold-hover aria-pressed:underline',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink active:bg-neutral-subtle-hover aria-pressed:bg-primary-subtle aria-pressed:text-primary',
};

/** Disabled is its own token set (never an opacity), applied only when truly disabled (not loading). */
const disabledLook: Record<ButtonVariant, string> = {
  primary: 'bg-surface-2 text-subtle hover:bg-surface-2',
  accent: 'bg-surface-2 text-subtle hover:bg-surface-2',
  gold: 'bg-surface-2 text-subtle hover:bg-surface-2',
  danger: 'bg-surface-2 text-subtle hover:bg-surface-2',
  secondary: 'border-line bg-surface-2 text-subtle hover:bg-surface-2',
  tertiary: 'text-subtle hover:no-underline',
  ghost: 'text-subtle hover:bg-transparent hover:text-subtle',
};

// Coarse pointers keep the 44 px floor even for sm/md (the utility would otherwise beat the base rule).
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1 text-body-sm [@media(pointer:coarse)]:min-h-11',
  md: 'min-h-10 px-4 py-2 text-body-sm [@media(pointer:coarse)]:min-h-11',
  lg: 'min-h-12 px-5 py-2 text-body',
  xl: 'min-h-14 w-full px-6 py-3 text-body',
};

const iconSize: Record<ButtonSize, string> = { sm: 'h-4 w-4', md: 'h-4 w-4', lg: 'h-5 w-5', xl: 'h-5 w-5' };

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. While loading, the spinner takes its place. */
  icon?: React.ReactNode;
  iconEnd?: React.ReactNode;
  fullWidth?: boolean;
}

interface ButtonProps extends CommonProps, React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** In flight: disabled (the double-post guard), width locked, spinner instead of the icon. */
  loading?: boolean;
  /** Just succeeded: ✓ + `successLabel` (callers clear it after ~1.5 s). */
  success?: boolean;
  successLabel?: React.ReactNode;
  /** Toggle buttons: sets `aria-pressed` and the pressed look. */
  pressed?: boolean;
  /** Why it is disabled — shown under the button and linked by `aria-describedby` (C12). */
  disabledReason?: React.ReactNode;
  children: React.ReactNode;
}

function Content({
  size,
  icon,
  iconEnd,
  loading,
  success,
  successLabel,
  children,
}: Pick<ButtonProps, 'icon' | 'iconEnd' | 'loading' | 'success' | 'successLabel' | 'children'> & { size: ButtonSize }) {
  if (success) {
    return (
      <>
        <Check className={iconSize[size]} aria-hidden="true" />
        {successLabel ?? children}
      </>
    );
  }
  if (loading && icon) {
    // The spinner takes the icon's slot: same width, label stays.
    return (
      <>
        <Spinner decorative className={iconSize[size]} />
        {children}
        {iconEnd}
      </>
    );
  }
  if (loading) {
    // No icon slot: keep the label in layout (width locked), spinner on top.
    return (
      <>
        <span className="inline-flex items-center gap-2 opacity-0">{children}{iconEnd}</span>
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner decorative className={iconSize[size]} />
        </span>
      </>
    );
  }
  return (
    <>
      {icon}
      {children}
      {iconEnd}
    </>
  );
}

/**
 * Button v2 (design-system-08). Server- and client-safe (no state). Focus is
 * the global outline; hover/pressed are colour state layers (≤100 ms).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  success = false,
  successLabel,
  pressed,
  disabledReason,
  icon,
  iconEnd,
  fullWidth = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const isDisabled = Boolean(disabled) && !loading;
  const describedBy = [rest['aria-describedby'], isDisabled && disabledReason ? reasonId : null].filter(Boolean).join(' ') || undefined;
  const button = (
    <button
      className={cn(
        base,
        variants[variant],
        sizes[size],
        isDisabled && disabledLook[variant],
        loading && 'cursor-wait',
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      {...rest}
      aria-describedby={describedBy}
    >
      <Content size={size} icon={icon} iconEnd={iconEnd} loading={loading} success={success} successLabel={successLabel}>
        {children}
      </Content>
    </button>
  );
  if (!(isDisabled && disabledReason)) return button;
  return (
    <span className={cn('inline-flex flex-col items-start gap-1', fullWidth && 'w-full')}>
      {button}
      <span id={reasonId} className="text-caption text-muted">
        {disabledReason}
      </span>
    </span>
  );
}

/**
 * A navigation link styled as a Button. Use instead of `<Link><Button/></Link>`
 * (a button nested in a link is two interactive elements — invalid HTML and a
 * double tab stop for keyboard users).
 */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  icon,
  iconEnd,
  fullWidth = false,
  className,
  children,
  ...rest
}: CommonProps & {
  href: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)} {...rest}>
      {icon}
      {children}
      {iconEnd}
    </Link>
  );
}

/**
 * Icon-only button. `label` is required: it is the accessible name and the
 * tooltip. Hit area 32 on desk, 44 on coarse pointers, 48 in field mode.
 */
export function IconButton({
  label,
  icon,
  size = 'md',
  tone = 'neutral',
  className,
  ...rest
}: {
  label: string;
  icon: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'danger';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-micro ease-standard disabled:cursor-not-allowed disabled:text-subtle',
        size === 'sm' ? 'h-8 w-8' : size === 'md' ? 'h-10 w-10' : 'h-12 w-12',
        '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [[data-mode=field]_&]:min-h-12 [[data-mode=field]_&]:min-w-12',
        tone === 'danger' ? 'text-danger hover:bg-danger-subtle' : 'text-muted hover:bg-surface-2 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
