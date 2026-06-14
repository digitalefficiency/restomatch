import { cn } from './cn';

const levelStyles: Record<1 | 2 | 3 | 4, string> = {
  1: 'text-3xl sm:text-4xl font-extrabold tracking-tight',
  2: 'text-2xl font-bold tracking-tight',
  3: 'text-lg font-bold',
  4: 'text-base font-semibold',
};

/** Typed heading that enforces a consistent size/weight scale across screens. */
export function Heading({
  level = 2,
  children,
  className,
}: {
  level?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const Tag = `h${level}` as React.ElementType;
  return <Tag className={cn(levelStyles[level], 'text-ink')}>{children}</Tag>;
}

/** Section title + optional subtitle + optional trailing action, with the
 *  money-flow signature accent above the title (RTL-aware). */
export function SectionHeader({
  title,
  subtitle,
  action,
  level = 2,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  level?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div>
        <div className="mb-2 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
        <Heading level={level}>{title}</Heading>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
