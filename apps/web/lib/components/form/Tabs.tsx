import Link from 'next/link';
import { cnMerge as cn } from '../cn';
import { CountBadge } from '../feedback/StatusChip';

export interface TabItem {
  href: string;
  label: React.ReactNode;
  count?: number;
  current?: boolean;
}

/**
 * In-page navigation tabs (links, so each view has a URL): a 2 px primary
 * underline on the current one, `aria-current="page"`, counts as CountBadge.
 * Scrolls sideways on narrow screens instead of wrapping.
 */
export function Tabs({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('border-b border-line', className)}>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((it) => (
          <li key={it.href} className="shrink-0">
            <Link
              href={it.href}
              aria-current={it.current ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-body-sm font-semibold transition-colors duration-micro',
                it.current ? 'border-primary text-ink' : 'border-transparent text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {it.label}
              {typeof it.count === 'number' ? <CountBadge count={it.count} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
