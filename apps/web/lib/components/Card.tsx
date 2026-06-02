import { cn } from './cn';

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  className?: string;
  /** Premium warm shadow + hairline border. */
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
 * Surface container ("Ledger" language): crisp white surface on the warm-paper
 * canvas, warm hairline border; `elevated` adds the soft warm shadow.
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
        elevated ? 'border border-stone-200/80 shadow-card' : 'border border-stone-200',
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
