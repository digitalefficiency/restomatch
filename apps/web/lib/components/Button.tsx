import { cn } from './cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  // text-white explicit on filled variants — guarantees contrast.
  primary: 'bg-primary text-white hover:bg-primary-hover focus-visible:ring-primary',
  accent: 'bg-accent text-white hover:bg-accent/90 focus-visible:ring-accent',
  danger: 'bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger',
  secondary:
    'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-ink focus-visible:ring-stone-300',
  ghost: 'text-stone-500 hover:bg-stone-100 hover:text-ink focus-visible:ring-stone-300',
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
 * Consistent focus ring + disabled + loading state.
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
