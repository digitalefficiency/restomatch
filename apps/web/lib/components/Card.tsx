import { cn } from './cn';

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  className?: string;
  /** Premium soft shadow + hairline border (matches showcase). */
  elevated?: boolean;
  /** Inner padding shorthand. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: React.ElementType;
}

const paddings = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
} as const;

/**
 * Surface container used across the dashboard. Default = hairline border;
 * `elevated` adds the cinematic soft shadow used in the showcase.
 */
export function Card({
  children,
  className,
  elevated = false,
  padding = 'md',
  as: Tag = 'div',
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-2xl bg-white',
        elevated
          ? 'border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.06)]'
          : 'border border-slate-200',
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
