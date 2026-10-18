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
  return <Tag className={cn(levelStyles[level], 'text-ink', className)}>{children}</Tag>;
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
    <div
      className={cn(
        'mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="mb-2 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
        <Heading level={level}>{title}</Heading>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {/* Stacks under the title on phones so wide action rows never scroll sideways. */}
      {action ? <div className="sm:shrink-0">{action}</div> : null}
    </div>
  );
}
