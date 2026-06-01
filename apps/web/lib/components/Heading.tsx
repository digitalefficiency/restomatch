import { cn } from './cn';

const levelStyles: Record<1 | 2 | 3 | 4, string> = {
  1: 'text-3xl sm:text-4xl font-bold tracking-tight',
  2: 'text-2xl font-bold tracking-tight',
  3: 'text-lg font-semibold',
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
  return <Tag className={cn(levelStyles[level], 'text-slate-900', className)}>{children}</Tag>;
}

/** Section title + optional subtitle + optional trailing action (RTL-aware). */
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
        <Heading level={level}>{title}</Heading>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
