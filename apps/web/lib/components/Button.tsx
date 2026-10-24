import Link from 'next/link';
import { cn } from './cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost' | 'gold';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none';

const variants: Record<Variant, string> = {
  // Deep money-green primary with white text — the hero action.
  primary:
    'bg-primary text-on-primary hover:brightness-90 shadow-glow-primary focus-visible:ring-primary',
  // `accent` kept as an alias of primary (positive action) for back-compat.
  accent:
    'bg-primary text-on-primary hover:brightness-90 shadow-glow-primary focus-visible:ring-primary',
  // Gold action — money recovered / savings emphasis.
  gold: 'bg-gold text-on-primary hover:brightness-90 shadow-glow-gold focus-visible:ring-gold',
  // Danger — leak / block / destructive.
  danger:
    'bg-danger text-on-primary hover:brightness-90 shadow-glow-danger focus-visible:ring-danger',
  // Secondary — white control with a ≥3:1 border.
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-primary/40 hover:text-primary focus-visible:ring-primary/60',
  // Ghost — quietest action.
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink focus-visible:ring-line',
};

const sizes: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

/**
 * Presentational button — no client hooks, usable from server + client.
 * Consistent focus ring + disabled + loading state, dark "command center" look.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
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
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}
